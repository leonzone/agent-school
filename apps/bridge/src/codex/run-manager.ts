import path from "node:path";
import type {
  RequestId,
  ServerNotification,
  ServerRequest,
  v2,
} from "@skillhub/codex-protocol";
import {
  approvalDecisionSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type ConversationSummary,
  type RunComposerOptions,
  type RunDetail,
  type RunSummary,
  type UploadedFile,
} from "@skillhub/shared";
import { getCodexStatus } from "./service.js";
import { AppServerClient } from "./app-server-client.js";
import type { ConversationService } from "../conversations.js";
import { HttpError } from "../errors.js";
import type { InstallationService, InstalledSkillRecord } from "../installations.js";
import type { RunStore } from "../runs.js";
import type { StoredTrainingRecord, TrainingService } from "../training.js";
import {
  captureWorkspaceSnapshot,
  collectRunArtifacts,
  type WorkspaceSnapshot,
} from "../workspace-files.js";

type PendingApproval = {
  request: ApprovalRequest;
  resolve: (result: unknown) => void;
};

type ComposerOptionsInput = Omit<RunComposerOptions, "skillIds"> & {
  skillIds?: string[];
};

type PermissionSettings = {
  approvalPolicy: v2.AskForApproval;
  sandbox: v2.SandboxMode;
  sandboxPolicy: v2.SandboxPolicy;
};

type ActiveRun = {
  id: string;
  skill: InstalledSkillRecord;
  agent: StoredTrainingRecord | null;
  conversation: ConversationSummary | null;
  options: RunComposerOptions | null;
  workspace: string;
  task: string;
  before: WorkspaceSnapshot | null;
  client: AppServerClient | null;
  threadId: string | null;
  turnId: string | null;
  finalText: string | null;
  stopping: boolean;
  finalized: boolean;
  pending: Map<string, PendingApproval>;
  done: Promise<void>;
  resolveDone: () => void;
};

function approvalKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Codex 测试执行失败";
}

function primarySkill(agent: StoredTrainingRecord): InstalledSkillRecord {
  const skill = agent.skills[0];
  if (!skill) throw new Error("Agent 未包含 Skill");
  return {
    skillId: skill.skillId,
    skillName: skill.skillId,
    commit: skill.commit,
    path: skill.path,
    files: skill.files,
    installedAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function isImage(file: UploadedFile): boolean {
  return file.mime !== null && imageMimeTypes.has(file.mime);
}

function permissionSettings(
  mode: RunComposerOptions["permissionMode"],
  workspace: string,
): PermissionSettings {
  if (mode === "strict") {
    return {
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    };
  }
  if (mode === "full") {
    return {
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  return {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [workspace],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

export class RunManager {
  private active: ActiveRun | null = null;

  constructor(
    private readonly store: RunStore,
    private readonly installations: InstallationService,
    private readonly training: TrainingService,
    private readonly conversations: ConversationService,
  ) {}

  get activeRunId(): string | null {
    return this.active?.id ?? null;
  }

  async start(options: {
    id: string;
    skillId?: string;
    agentId?: string;
    conversationId?: string;
    workspace: string;
    task: string;
    inputFiles: UploadedFile[];
    composerOptions?: ComposerOptionsInput;
    confirmFullAccess?: boolean;
  }): Promise<RunDetail> {
    const isChat = options.conversationId !== undefined;
    if (isChat
      ? options.skillId !== undefined || options.agentId !== undefined
      : (options.skillId === undefined) === (options.agentId === undefined)) {
      throw new HttpError(400, "INVALID_RUN_TARGET", "运行必须指定一个 Skill、Agent 或会话");
    }
    if (isChat && !options.composerOptions) {
      throw new HttpError(400, "RUN_OPTIONS_REQUIRED", "聊天必须指定模型和思考强度");
    }
    if (isChat && options.composerOptions?.permissionMode === "full" && !options.confirmFullAccess) {
      throw new HttpError(400, "FULL_ACCESS_CONFIRMATION_REQUIRED", "完全权限需要逐次明确确认");
    }
    if (this.active) {
      throw new HttpError(409, "RUN_ALREADY_ACTIVE", "已有一个测试在运行，请先完成或停止它");
    }
    const conversation = isChat ? this.conversations.require(options.conversationId as string) : null;
    const agentId = conversation?.agentId ?? options.agentId;
    const agent = agentId === undefined ? null : this.training.require(agentId);
    const skill = agent ? primarySkill(agent) : this.installations.require(options.skillId as string);
    let resolveDone = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const active: ActiveRun = {
      id: options.id,
      skill,
      agent,
      conversation,
      options: null,
      workspace: conversation?.projectPath ?? agent?.projectPath ?? options.workspace,
      task: options.task,
      before: null,
      client: null,
      threadId: conversation?.threadId ?? null,
      turnId: null,
      finalText: null,
      stopping: false,
      finalized: false,
      pending: new Map<string, PendingApproval>(),
      done,
      resolveDone,
    };
    this.active = active;
    let runBegun = false;

    try {
      const codex = await getCodexStatus();
      if (!codex.available || !codex.compatible || !codex.loggedIn) {
        throw new HttpError(400, "CODEX_NOT_READY", codex.error ?? "Codex 尚未就绪");
      }
      if (agentId !== undefined && active.agent) {
        active.agent = await this.training.assertUsable(agentId, active.agent.revision);
        active.skill = primarySkill(active.agent);
        if (active.conversation && active.conversation.revision !== active.agent.revision) {
          active.conversation = this.conversations.rebindToTraining(active.conversation.id, active.agent);
          active.threadId = null;
        }
        active.workspace = active.conversation?.projectPath ?? active.agent.projectPath;
        if (isChat && options.composerOptions) {
          active.options = {
            skillIds: options.composerOptions.skillIds ?? active.agent.skills.map((skill) => skill.skillId),
            permissionMode: options.composerOptions.permissionMode,
            model: options.composerOptions.model,
            effort: options.composerOptions.effort,
          };
        }
        this.training.beginRun(agentId);
      } else if (options.skillId !== undefined) {
        active.skill = await this.installations.assertUsable(options.skillId, skill.commit);
        this.installations.beginRun(options.skillId);
      }
      runBegun = true;
      this.store.create({
        id: options.id,
        skill: active.skill,
        ...(active.agent ? { agent: active.agent } : {}),
        workspace: active.workspace,
        task: options.task,
        inputFiles: options.inputFiles,
        kind: isChat ? "chat" : "automated",
        options: active.options,
        ...(active.conversation ? { conversationId: active.conversation.id } : {}),
      });
      if (active.conversation) {
        active.conversation = this.conversations.recordRun(active.conversation.id, options.task);
      }
    } catch (error) {
      if (runBegun) this.endRun(active);
      this.active = null;
      active.resolveDone();
      throw error;
    }

    void this.execute(active);
    return this.store.get(options.id);
  }

  list(): RunSummary[] {
    return this.store.list();
  }

  pendingApprovals(runId: string): ApprovalRequest[] {
    if (this.active?.id !== runId) return [];
    return [...this.active.pending.values()].map((pending) => pending.request);
  }

  resolveApproval(runId: string, requestId: RequestId, decisionInput: ApprovalDecision): void {
    const active = this.active;
    if (!active || active.id !== runId || active.finalized) {
      throw new HttpError(404, "APPROVAL_NOT_FOUND", "审批请求已失效");
    }
    const decision = approvalDecisionSchema.parse(decisionInput);
    const key = approvalKey(requestId);
    const pending = active.pending.get(key);
    if (!pending) throw new HttpError(404, "APPROVAL_NOT_FOUND", "审批请求已失效");
    const available = pending.request.params.availableDecisions;
    if (Array.isArray(available) && !available.includes(decision)) {
      throw new HttpError(400, "DECISION_NOT_AVAILABLE", "Codex 未为当前审批提供该决定");
    }
    active.pending.delete(key);
    pending.resolve(this.approvalResult(pending.request, decision));
    this.store.appendEvent(runId, "approvalDecision", pending.request.method, {
      requestId,
      decision,
    });
    if (active.pending.size === 0 && !active.stopping) this.store.setStatus(runId, "running");
  }

  async stop(runId: string): Promise<void> {
    const active = this.active;
    if (!active || active.id !== runId) {
      const run = this.store.find(runId);
      if (run && ["completed", "failed", "interrupted"].includes(run.status)) return;
      throw new HttpError(409, "RUN_NOT_ACTIVE", "该测试没有可停止的活动进程");
    }
    active.stopping = true;
    this.cancelPending(active);
    if (active.finalized) {
      await active.done;
      return;
    }
    if (active.client && active.threadId && active.turnId) {
      try {
        await active.client.call("turn/interrupt", {
          threadId: active.threadId,
          turnId: active.turnId,
        }, 5_000);
      } catch (error) {
        this.store.appendEvent(runId, "warning", null, {
          message: `停止请求未确认: ${errorMessage(error)}`,
        });
      }
      const timeout = setTimeout(() => {
        void this.finalize(active, "interrupted", "停止测试超时");
      }, 8_000);
      timeout.unref();
      await active.done;
      clearTimeout(timeout);
      return;
    }
    await this.finalize(active, "interrupted", null);
  }

  async close(): Promise<void> {
    if (this.active) await this.stop(this.active.id);
  }

  private async execute(active: ActiveRun): Promise<void> {
    try {
      this.store.appendEvent(active.id, "phase", null, { phase: "workspaceSnapshot" });
      active.before = await captureWorkspaceSnapshot(active.workspace);
      this.ensureRunning(active);
      this.store.setStatus(active.id, "running");

      const client = await AppServerClient.start({
        onNotification: (notification) => this.handleNotification(active, notification),
        onServerRequest: (request) => this.handleServerRequest(active, request),
        onExit: (error) => {
          if (!active.finalized) {
            void this.finalize(
              active,
              active.stopping ? "interrupted" : "failed",
              error?.message ?? (active.stopping ? null : "Codex app-server 已关闭"),
            );
          }
        },
        onStderr: (message) => {
          this.store.appendEvent(active.id, "codexStderr", null, { message });
        },
      });
      active.client = client;
      this.ensureRunning(active);

      const materials = this.store.get(active.id).inputFiles;
      const permission = permissionSettings(active.options?.permissionMode ?? "workspace", active.workspace);
      if (active.options) {
        if (!active.agent) throw new Error("聊天 Run 缺少固定培训角色");
        const allowedSkillIds = new Set(active.agent.skills.map((skill) => skill.skillId));
        const unauthorized = active.options.skillIds.filter((skillId) => !allowedSkillIds.has(skillId));
        if (unauthorized.length) {
          throw new Error(`不能选择不属于该员工的 Skills：${unauthorized.join("、")}`);
        }
        const unsupportedImage = materials.find(
          (file) => file.mime?.startsWith("image/") && !imageMimeTypes.has(file.mime),
        );
        if (unsupportedImage) {
          throw new Error(`不支持的图片 MIME：${unsupportedImage.mime}`);
        }

        let selectedModel: v2.Model | null = null;
        let cursor: string | null = null;
        do {
          const models: v2.ModelListResponse = await client.call<v2.ModelListResponse>("model/list", {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          selectedModel = models.data.find((model: v2.Model) => model.model === active.options?.model) ?? null;
          cursor = models.nextCursor;
        } while (!selectedModel && cursor);
        if (!selectedModel) throw new Error(`Codex 不支持所选模型：${active.options.model}`);
        if (!selectedModel.supportedReasoningEfforts.some(
          (option: v2.ReasoningEffortOption) => option.reasoningEffort === active.options?.effort,
        )) {
          throw new Error(`模型 ${active.options.model} 不支持思考强度 ${active.options.effort}`);
        }
        const imageFiles = materials.filter(isImage);
        if (imageFiles.length && !selectedModel.inputModalities.includes("image")) {
          throw new Error(`模型 ${active.options.model} 不支持图片输入`);
        }

        const config = await client.call<v2.ConfigRequirementsReadResponse>(
          "configRequirements/read",
          undefined,
        );
        const allowedApprovals = config.requirements?.allowedApprovalPolicies;
        if (allowedApprovals && !allowedApprovals.includes(permission.approvalPolicy)) {
          throw new Error(`Codex 管理员策略不允许审批模式 ${String(permission.approvalPolicy)}`);
        }
        const allowedSandboxes = config.requirements?.allowedSandboxModes;
        if (allowedSandboxes && !allowedSandboxes.includes(permission.sandbox)) {
          throw new Error(`Codex 管理员策略不允许沙箱模式 ${permission.sandbox}`);
        }
      }

      const fixedSkills = active.agent
        ? active.agent.skills.filter(
          (skill) => !active.options || active.options.skillIds.includes(skill.skillId),
        ).map((skill) => ({
          name: skill.skillId,
          path: path.join(skill.path, "SKILL.md"),
        }))
        : [{ name: active.skill.skillName, path: path.join(active.skill.path, "SKILL.md") }];
      const skills = await client.call<v2.SkillsListResponse>("skills/list", {
        cwds: [active.workspace],
        forceReload: true,
      });
      const installed = skills.data.flatMap((entry: v2.SkillsListEntry) => entry.skills);
      const allEnabled = fixedSkills.every((fixed) => installed.some(
        (skill: v2.SkillMetadata) => path.resolve(skill.path) === path.resolve(fixed.path) && skill.enabled,
      ));
      if (!allEnabled) {
        throw new Error(active.agent
          ? active.options
            ? "Codex 未能启用本轮选择的固定版本 Skills"
            : "Codex 未能启用 Agent 的全部固定版本 Skills"
          : "Codex 未能启用本次固定版本的 Skill");
      }

      const thread = active.threadId
        ? await client.call<v2.ThreadResumeResponse>("thread/resume", {
          threadId: active.threadId,
          cwd: active.workspace,
          approvalPolicy: permission.approvalPolicy,
          sandbox: permission.sandbox,
        }, 60_000)
        : await client.call<v2.ThreadStartResponse>("thread/start", {
          cwd: active.workspace,
          approvalPolicy: permission.approvalPolicy,
          sandbox: permission.sandbox,
          serviceName: "skillhub",
        }, 60_000);
      const threadId = thread.thread.id;
      active.threadId = threadId;
      this.store.setThread(active.id, threadId);
      if (active.conversation) this.conversations.setThread(active.conversation.id, threadId);
      this.ensureRunning(active);

      const regularMaterials = active.options ? materials.filter((file) => !isImage(file)) : materials;
      const materialText = regularMaterials.length
        ? regularMaterials.map((file) => `- ${file.path}`).join("\n")
        : active.options ? "本次未提供普通文件附件。" : "本次未提供附件。";
      const requirements = `用户测试任务：\n${active.task}\n\n本次测试材料的本地绝对路径：\n${materialText}\n\n测试事实只能来自用户任务和上述材料，不得编造；Skill 自身的说明和参考文件仍应按要求读取。默认在指定工作目录内完成任务；如果用户明确要求写入其他位置或使用额外权限，必须先发起审批，由用户决定，不得自行绕过。最终在回复中列出生成或修改的文件。`;
      const selectedSkillsText = active.options?.skillIds.length
        ? `本轮选择的 Skills：${active.options.skillIds.join("、")}。它们都是该 Agent 的固定依赖，应按要求使用。`
        : "本轮未选择 Skills，本轮不要调用任何 Skill。";
      const permissionText = active.options?.permissionMode === "strict"
        ? "本轮权限为始终请求批准：readOnly 沙箱，写入或提权必须审批。"
        : active.options?.permissionMode === "full"
          ? "本轮权限为用户已逐次明确确认的完全权限：dangerFullAccess，审批策略为 never。只执行用户明确请求的操作。"
          : "本轮权限为必要时请求批准：仅工作区可写，网络关闭，额外权限必须审批。";
      const text = active.conversation && active.agent && active.options
        ? `你正在通过 Agent School 与 Agent「${active.agent.agentName}」自由对话（ID：${active.agent.agentId}，固定 revision：${active.agent.revision}）。当前工作目录固定为该会话绑定的 Agent 项目目录。请先阅读并遵循项目中的 AGENTS.md，以该文件定义的角色和项目要求开展工作。${selectedSkillsText}\n\n本轮模型：${active.options.model}；思考强度：${active.options.effort}。${permissionText}\n\n用户消息：\n${active.task}\n\n本轮普通文件附件的本地绝对路径：\n${materialText}\n\n请按任务需要读取上述普通文件，不得编造附件内容；图片附件（如有）已作为图像输入提供。最终在回复中列出生成或修改的文件。`
        : active.agent
          ? `你正在以 Agent「${active.agent.agentName}」的角色执行测试（ID：${active.agent.agentId}，固定 revision：${active.agent.revision}）。当前工作目录是该 Agent 的项目目录。请先阅读并遵循项目中的 AGENTS.md，以该文件定义的角色和项目要求开展工作；本次传入的全部 Skill 都是该 Agent 的固定依赖，应按要求使用。\n\n${requirements}`
          : `$${active.skill.skillName}\n\n${requirements}`;
      const skillInputs: v2.UserInput[] = fixedSkills.map((skill) => ({
        type: "skill",
        name: skill.name,
        path: skill.path,
      }));
      const imageInputs: v2.UserInput[] = active.options
        ? materials.filter(isImage).map((file) => ({ type: "localImage", path: file.path }))
        : [];
      const turn = await client.call<v2.TurnStartResponse>("turn/start", {
        threadId,
        input: [
          { type: "text", text, text_elements: [] },
          ...skillInputs,
          ...imageInputs,
        ],
        cwd: active.workspace,
        approvalPolicy: permission.approvalPolicy,
        sandboxPolicy: permission.sandboxPolicy,
        ...(active.options ? { model: active.options.model, effort: active.options.effort } : {}),
      }, 60_000);
      const turnId = turn.turn.id;
      active.turnId = turnId;
      this.store.setTurn(active.id, turnId);
    } catch (error) {
      await this.finalize(
        active,
        active.stopping ? "interrupted" : "failed",
        active.stopping ? null : errorMessage(error),
      );
    }
  }

  private handleNotification(active: ActiveRun, notification: ServerNotification): void {
    if (this.active !== active || active.finalized) return;
    this.store.appendEvent(active.id, "notification", notification.method, notification.params);

    if (notification.method === "turn/started") {
      const turnId = notification.params.turn.id;
      active.turnId = turnId;
      this.store.setTurn(active.id, turnId);
      return;
    }
    if (notification.method === "item/completed" && notification.params.item.type === "agentMessage") {
      active.finalText = notification.params.item.text;
      return;
    }
    if (notification.method === "serverRequest/resolved") {
      const key = approvalKey(notification.params.requestId);
      const pending = active.pending.get(key);
      if (pending) {
        active.pending.delete(key);
        pending.resolve(this.approvalResult(pending.request, "cancel"));
        if (active.pending.size === 0 && !active.stopping) this.store.setStatus(active.id, "running");
      }
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = notification.params.turn;
      const agentMessages = turn.items.filter(
        (item: v2.ThreadItem): item is Extract<v2.ThreadItem, { type: "agentMessage" }> => item.type === "agentMessage",
      );
      const finalMessage = [...agentMessages].reverse().find((item) => item.phase === "final_answer")
        ?? agentMessages.at(-1);
      if (finalMessage?.type === "agentMessage") active.finalText = finalMessage.text;
      const status = turn.status === "completed"
        ? "completed"
        : turn.status === "interrupted"
          ? "interrupted"
          : "failed";
      void this.finalize(active, status, turn.error?.message ?? null);
    }
  }

  private handleServerRequest(active: ActiveRun, request: ServerRequest): Promise<unknown> {
    if (this.active !== active || active.finalized || active.stopping) {
      if (request.method === "item/permissions/requestApproval") {
        return Promise.resolve({ permissions: {}, scope: "turn" });
      }
      return Promise.resolve({ decision: "cancel" });
    }
    if (![
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
    ].includes(request.method)) {
      throw new Error(`Agent School 暂不支持该 Codex 请求: ${request.method}`);
    }
    if (active.stopping) return Promise.resolve(this.approvalResult(request, "cancel"));

    return new Promise((resolve) => {
      const approval: ApprovalRequest = {
        id: request.id,
        runId: active.id,
        method: request.method,
        params: request.params as unknown as Record<string, unknown>,
        createdAt: new Date().toISOString(),
      };
      active.pending.set(approvalKey(request.id), { request: approval, resolve });
      this.store.appendEvent(active.id, "approval", request.method, request.params);
      this.store.setStatus(active.id, "waitingApproval");
    });
  }

  private approvalResult(
    request: ApprovalRequest | ServerRequest,
    decision: ApprovalDecision,
  ): unknown {
    if (request.method === "item/permissions/requestApproval") {
      const granted = decision === "accept" || decision === "acceptForSession"
        ? (request.params as unknown as v2.PermissionsRequestApprovalParams).permissions
        : {};
      return {
        permissions: granted,
        scope: decision === "acceptForSession" ? "session" : "turn",
      };
    }
    return { decision };
  }

  private cancelPending(active: ActiveRun): void {
    for (const pending of active.pending.values()) {
      pending.resolve(this.approvalResult(pending.request, "cancel"));
    }
    active.pending.clear();
  }

  private ensureRunning(active: ActiveRun): void {
    if (active.stopping || active.finalized || this.active !== active) {
      throw new Error("测试已停止");
    }
  }

  private endRun(active: ActiveRun): void {
    if (active.agent) this.training.endRun(active.agent.agentId);
    else this.installations.endRun(active.skill.skillId);
  }

  private async finalize(
    active: ActiveRun,
    status: "completed" | "failed" | "interrupted",
    error: string | null,
  ): Promise<void> {
    if (active.finalized) return;
    active.finalized = true;
    this.cancelPending(active);
    let finalStatus = status;
    let finalError = error;
    try {
      if (active.before) {
        this.store.appendEvent(active.id, "phase", null, { phase: "collectArtifacts" });
        try {
          const files = await collectRunArtifacts({
            runId: active.id,
            workspace: active.workspace,
            before: active.before,
          });
          this.store.replaceFiles(active.id, files);
          this.store.appendEvent(active.id, "files", null, { files: this.store.get(active.id).files });
        } catch (artifactError) {
          if (finalStatus === "completed") finalStatus = "failed";
          finalError = `结果文件收集失败: ${errorMessage(artifactError)}`;
          this.store.appendEvent(active.id, "warning", null, { message: finalError });
        }
      }
      this.store.complete({
        id: active.id,
        status: finalStatus,
        finalText: active.finalText,
        error: finalError,
      });
    } catch (completionError) {
      try {
        this.store.complete({
          id: active.id,
          status: "failed",
          finalText: active.finalText,
          error: errorMessage(completionError),
        });
      } catch {
      }
    } finally {
      try {
        if (active.client) await active.client.stop();
      } finally {
        try {
          this.endRun(active);
        } finally {
          if (this.active === active) this.active = null;
          active.resolveDone();
        }
      }
    }
  }
}
