import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import type {
  Agent,
  ApprovalRequest,
  CodexConfigResponse,
  ConversationDetail,
  RunDetail,
  RunEvent,
  RunSummary,
  TrainedAgent,
} from "@skillhub/shared";
import { api, ApiError, initializeSession } from "../api";
import { Approvals } from "../components/Approvals";
import { ChatComposerEditor, type ChatComposerEditorHandle } from "../components/ChatComposerEditor";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { RunFiles } from "../components/RunFiles";
import { Timeline } from "../components/Timeline";
import { ErrorBanner, LoadingState, Notice, RunStatusBadge } from "../components/UI";
import { agentAvatar, asRecord, errorMessage, formatBytes, isActiveStatus, isRunEvent } from "../utils";

const eventKinds = [
  "status",
  "meta",
  "outcome",
  "notification",
  "approval",
  "approvalDecision",
  "files",
  "phase",
  "warning",
  "codexStderr",
];

const supportedImageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxAttachmentCount = 10;
const maxAttachmentSize = 10 * 1024 * 1024;
const permissionLabels = {
  strict: "始终请求批准",
  workspace: "必要时请求批准",
  full: "完全权限",
} as const;
const permissionBadgeLabels = {
  strict: "严格权限",
  workspace: "工作区权限",
  full: "完全权限",
} as const;

type ConnectionState = "connecting" | "connected" | "reconnecting";
type PermissionMode = keyof typeof permissionLabels;
type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};
type ComposerOptions = {
  skillIds: string[];
  permissionMode: PermissionMode;
  model: string;
  effort: string;
};

function runOptions(run: RunSummary): ComposerOptions | null {
  if (!("options" in run)) return null;
  const options = asRecord(run.options);
  if (!options || !Array.isArray(options.skillIds)) return null;
  const permissionMode = options.permissionMode;
  if (
    (permissionMode !== "strict" && permissionMode !== "workspace" && permissionMode !== "full")
    || typeof options.model !== "string"
    || typeof options.effort !== "string"
  ) return null;
  return {
    skillIds: options.skillIds.filter((skillId): skillId is string => typeof skillId === "string"),
    permissionMode,
    model: options.model,
    effort: options.effort,
  };
}

export function AgentChatPage({ agent, training, onAvatarClick, configOpen = false }: {
  agent: Agent;
  training: TrainedAgent;
  onAvatarClick?: (() => void) | undefined;
  configOpen?: boolean | undefined;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [task, setTask] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [codexConfig, setCodexConfig] = useState<CodexConfigResponse | null>(null);
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("workspace");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerEditor = useRef<ChatComposerEditorHandle>(null);
  const skillsMenu = useRef<HTMLDivElement>(null);
  const skillsPopover = useRef<HTMLDivElement>(null);
  const attachmentSequence = useRef(0);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const currentAgentId = useRef(agent.id);
  const currentRunId = useRef(activeRunId);
  const mounted = useRef(true);
  currentAgentId.current = agent.id;
  currentRunId.current = activeRunId;
  attachmentsRef.current = attachments;

  const visibleDetail = detail?.conversation.agentId === agent.id ? detail : null;
  const activeSummary = visibleDetail?.runs.find((run) => run.id === activeRunId) ?? null;
  const activeRun = activeRunId ? runDetails[activeRunId] ?? null : null;
  const active = activeRun
    ? isActiveStatus(activeRun.status)
    : activeSummary !== null && isActiveStatus(activeSummary.status);
  const revisionUpdated = visibleDetail !== null && visibleDetail.conversation.revision !== training.revision;
  const selectedModel = codexConfig?.models.find((candidate) => candidate.model === model) ?? null;
  const composerDisabled = !visibleDetail || sending || active;
  const settingsDisabled = composerDisabled || codexLoading;

  const replaceAttachments = useCallback((next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const clearAttachments = useCallback(() => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    replaceAttachments([]);
    if (fileInput.current) fileInput.current.value = "";
  }, [replaceAttachments]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      attachmentsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!skillsOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!skillsMenu.current?.contains(target) && !skillsPopover.current?.contains(target)) setSkillsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSkillsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [skillsOpen]);

  useEffect(() => {
    if (settingsDisabled) setSkillsOpen(false);
  }, [settingsDisabled]);

  const loadCodexConfig = useCallback(async () => {
    const requestedAgentId = agent.id;
    setCodexLoading(true);
    setCodexError(null);
    try {
      const data = await api.codexConfig();
      if (!mounted.current || currentAgentId.current !== requestedAgentId) return;
      setCodexConfig(data);
      const configuredModel = data.models.find((candidate) => candidate.model === data.settings?.model);
      const initialModel = configuredModel ?? data.models.find((candidate) => candidate.isDefault) ?? data.models[0] ?? null;
      setModel(initialModel?.model ?? "");
      setEffort(initialModel?.defaultReasoningEffort ?? "");
      if (!initialModel) setCodexError("当前没有可用模型，请检查 Codex 配置");
    } catch (error) {
      if (mounted.current && currentAgentId.current === requestedAgentId) setCodexError(errorMessage(error));
    } finally {
      if (mounted.current && currentAgentId.current === requestedAgentId) setCodexLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadCodexConfig();
  }, [loadCodexConfig]);

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const data = await api.run(runId);
      if (mounted.current && data.agent?.id === currentAgentId.current) {
        setRunDetails((current) => ({ ...current, [runId]: data }));
      }
      return data;
    } catch (error) {
      if (mounted.current && currentRunId.current === runId) setActionError(errorMessage(error));
      return null;
    }
  }, []);

  const refreshApprovals = useCallback(async (runId: string) => {
    try {
      const data = await api.approvals(runId);
      if (mounted.current && currentRunId.current === runId) setApprovals(data.approvals);
    } catch (error) {
      if (mounted.current && currentRunId.current === runId) setActionError(errorMessage(error));
    }
  }, []);

  const refreshConversation = useCallback(async (initial = false) => {
    const requestedAgentId = agent.id;
    if (initial) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const data = await api.ensureConversation(requestedAgentId);
      const details = await Promise.all(data.runs.map(async (run) => {
        try {
          return await api.run(run.id);
        } catch {
          return null;
        }
      }));
      if (!mounted.current || currentAgentId.current !== requestedAgentId) return null;
      setDetail(data);
      setRunDetails((current) => {
        const next = { ...current };
        for (const run of details) {
          if (run) next[run.id] = run;
        }
        return next;
      });
      const latestActive = data.runs.find((run) => isActiveStatus(run.status));
      setActiveRunId((current) => {
        const currentRun = details.find((run) => run?.id === current);
        return currentRun && isActiveStatus(currentRun.status) ? current : latestActive?.id ?? null;
      });
      setDetailError(null);
      return data;
    } catch (error) {
      if (mounted.current && currentAgentId.current === requestedAgentId) setDetailError(errorMessage(error));
      return null;
    } finally {
      if (mounted.current && currentAgentId.current === requestedAgentId) setDetailLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    setDetail(null);
    setRunDetails({});
    setActiveRunId(null);
    setApprovals([]);
    setEvents([]);
    setActionError(null);
    setComposerError(null);
    setDetailError(null);
    setSending(false);
    setStopping(false);
    setTask("");
    setPermissionMode("workspace");
    setSkillsOpen(false);
    clearAttachments();
    void refreshConversation(true);
  }, [agent.id, clearAttachments, refreshConversation]);

  useEffect(() => {
    if (!activeRunId) {
      setEvents([]);
      setApprovals([]);
      return;
    }
    const runId = activeRunId;
    let disposed = false;
    let finishing = false;
    let source: EventSource | null = null;
    const seen = new Set<number>();
    setEvents([]);
    setApprovals([]);
    setConnection("connecting");

    const finish = async () => {
      if (finishing) return;
      finishing = true;
      await Promise.all([
        refreshConversation(),
        refreshRun(runId),
        refreshApprovals(runId),
      ]);
    };

    const receive = (event: Event) => {
      const message = event as MessageEvent<string>;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!isRunEvent(parsed) || parsed.runId !== runId || seen.has(parsed.seq)) return;
      seen.add(parsed.seq);
      setEvents((current) => [...current, parsed]);

      if (parsed.kind === "status" || parsed.kind === "meta" || parsed.kind === "outcome") {
        const payload = asRecord(parsed.payload);
        if (payload) {
          setRunDetails((current) => {
            const run = current[runId];
            return run ? { ...current, [runId]: { ...run, ...payload } as RunDetail } : current;
          });
        }
      }
      if (parsed.kind === "files") void refreshRun(runId);
      if (parsed.kind === "approval" || parsed.kind === "approvalDecision") void refreshApprovals(runId);
      if (parsed.kind === "notification" && parsed.method === "serverRequest/resolved") void refreshApprovals(runId);
      if (parsed.kind === "status") {
        const status = asRecord(parsed.payload)?.status;
        if (typeof status === "string" && ["completed", "failed", "interrupted"].includes(status)) void finish();
      }
    };

    async function connect() {
      try {
        await initializeSession();
        if (disposed) return;
        source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
        source.onopen = () => {
          if (!disposed) setConnection("connected");
        };
        source.onerror = () => {
          if (!disposed) setConnection("reconnecting");
        };
        for (const kind of eventKinds) source.addEventListener(kind, receive);
      } catch (error) {
        if (!disposed) {
          setConnection("reconnecting");
          setActionError(errorMessage(error));
        }
      }
    }

    void connect();
    void refreshApprovals(runId);
    const poll = window.setInterval(() => {
      void refreshRun(runId);
      void refreshApprovals(runId);
    }, 20000);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      source?.close();
    };
  }, [activeRunId, refreshApprovals, refreshConversation, refreshRun]);

  function addFiles(incoming: File[]) {
    if (composerDisabled || incoming.length === 0) return;
    const remaining = maxAttachmentCount - attachmentsRef.current.length;
    const accepted = incoming.slice(0, Math.max(0, remaining));
    const next: ComposerAttachment[] = [];
    let validationError = incoming.length > remaining ? `最多添加 ${maxAttachmentCount} 个附件` : null;
    for (const file of accepted) {
      if (file.size > maxAttachmentSize) {
        validationError = `${file.name} 超过 10 MB，未添加`;
        continue;
      }
      if (file.type.startsWith("image/") && !supportedImageMimes.has(file.type)) {
        validationError = `${file.name} 的图片格式不支持，仅支持 PNG、JPEG、WebP、GIF`;
        continue;
      }
      const image = supportedImageMimes.has(file.type);
      attachmentSequence.current += 1;
      next.push({
        id: `${Date.now()}-${attachmentSequence.current}`,
        file,
        previewUrl: image ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length > 0) replaceAttachments([...attachmentsRef.current, ...next]);
    setComposerError(validationError);
  }

  function removeAttachment(id: string) {
    const target = attachmentsRef.current.find((attachment) => attachment.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    replaceAttachments(attachmentsRef.current.filter((attachment) => attachment.id !== id));
    setComposerError(null);
  }

  function pasteFiles(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length === 0 || composerDisabled) return;
    event.preventDefault();
    addFiles(pasted);
  }

  async function send() {
    if (!visibleDetail || sending || active) return;
    const normalizedTask = task.trim();
    if (!normalizedTask) {
      setComposerError("请输入要发送给员工的消息");
      return;
    }
    if (!selectedModel) {
      setComposerError(codexLoading ? "模型配置仍在加载，请稍候" : "没有可用模型，请检查 Codex 配置");
      return;
    }
    if (permissionMode === "full" && !window.confirm("完全权限将不审批且可访问工作区外文件。确认本轮以完全权限发送吗？")) return;
    const options: ComposerOptions = {
      skillIds: [...selectedSkillIds],
      permissionMode,
      model: selectedModel.model,
      effort: effort || selectedModel.defaultReasoningEffort,
    };
    setSending(true);
    setComposerError(null);
    setSkillsOpen(false);
    try {
      const run = await api.sendConversationMessage(
        visibleDetail.conversation.id,
        normalizedTask,
        attachmentsRef.current.map((attachment) => attachment.file),
        options,
      );
      setRunDetails((current) => ({ ...current, [run.id]: run }));
      setActiveRunId(run.id);
      setTask("");
      clearAttachments();
      await refreshConversation();
    } catch (error) {
      setComposerError(error instanceof ApiError && error.status === 409
        ? "当前有其他 Run 正在执行，请等待它完成或停止后再发送。"
        : errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!activeRunId || stopping || !window.confirm("确认停止当前回复？已产生的文件和聊天记录会保留。")) return;
    setStopping(true);
    setActionError(null);
    try {
      const run = await api.stopRun(activeRunId);
      setRunDetails((current) => ({ ...current, [run.id]: run }));
      await refreshApprovals(run.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStopping(false);
    }
  }

  return (
    <section className="chat-main employee-chat-main" aria-label={`${agent.name} 的员工对话`}>
      <header className="chat-context">
        <div className="chat-agent-identity">
          {onAvatarClick ? (
            <button
              type="button"
              className="employee-avatar employee-avatar-button chat-agent-avatar"
              onClick={onAvatarClick}
              aria-expanded={configOpen}
              aria-controls="employee-config"
              aria-label={`${configOpen ? "隐藏" : "显示"}${agent.name}的员工配置`}
            >
              <span aria-hidden="true">{agentAvatar(agent)}</span>
            </button>
          ) : <span className="employee-avatar chat-agent-avatar" aria-hidden="true">{agentAvatar(agent)}</span>}
          <h2>{agent.name}</h2>
        </div>
      </header>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {revisionUpdated ? <Notice><span>历史聊天保留，新回复使用最新培训上下文</span></Notice> : null}

      <div className="chat-transcript">
        {detailLoading && !visibleDetail ? <LoadingState label="正在进入员工会话" /> : null}
        {detailError ? <ErrorBanner message={detailError} onRetry={() => void refreshConversation(true)} /> : null}
        {visibleDetail && visibleDetail.runs.length === 0 ? (
          <div className="chat-welcome"><strong>向 {agent.name} 发送第一条消息</strong><p>可以描述工作任务，也可以附上文档、数据或示例文件。</p></div>
        ) : null}
        {visibleDetail?.runs.map((summary, index) => {
          const run = runDetails[summary.id] ?? null;
          const isCurrent = activeRunId === summary.id && active;
          const finalText = run?.finalText ?? summary.finalText;
          const runError = run?.error ?? summary.error;
          const options = runOptions(run ?? summary);
          return (
            <article className="chat-turn" key={summary.id}>
              <div className="chat-user-message">
                <span>你 · 第 {index + 1} 轮</span>
                <p>{summary.task}</p>
                {run && run.inputFiles.length > 0 ? <small>材料：{run.inputFiles.map((file) => file.name).join("、")}</small> : null}
              </div>
              {options ? (
                <div className="chat-turn-options" aria-label="本轮设置">
                  <span>Skills {options.skillIds.length}</span>
                  <span>{permissionBadgeLabels[options.permissionMode]}</span>
                  <span>{options.model}</span>
                  <span>effort {options.effort}</span>
                </div>
              ) : null}
              <div className="chat-assistant-message">
                <div className="chat-turn-heading">
                  <div><strong>Codex</strong><RunStatusBadge status={run?.status ?? summary.status} /></div>
                  <Link className="text-link" to={`/runs/${encodeURIComponent(summary.id)}`}>运行详情</Link>
                </div>
                {isCurrent ? (
                  <div className="chat-live-run">
                    <Approvals runId={summary.id} approvals={approvals} onChange={setApprovals} onRunUpdated={async () => { await refreshRun(summary.id); }} />
                    {activeRun ? (
                      <div className="chat-live-actions">
                        <span className={`chat-connection ${connection}`} role="status">{connection === "connected" ? "实时连接正常" : connection === "connecting" ? "正在连接实时过程" : "连接中断，浏览器正在按 Last-Event-ID 自动续传"}</span>
                        <button type="button" className="button button-small button-danger" onClick={() => void stop()} disabled={stopping}>{stopping ? "正在停止…" : "停止"}</button>
                      </div>
                    ) : <LoadingState label="正在读取当前运行" />}
                    <Timeline events={events} />
                  </div>
                ) : (
                  <>
                    {finalText ? <Markdown className="chat-final-text">{finalText}</Markdown> : null}
                    {!finalText && !runError && summary.status === "completed" ? <p className="muted">本轮没有文字回复。</p> : null}
                    {runError ? <Notice tone="warning"><strong>本轮运行错误</strong><p>{runError}</p></Notice> : null}
                  </>
                )}
                {run && (run.files.length > 0 || isCurrent) ? <RunFiles runId={summary.id} files={run.files} /> : null}
              </div>
            </article>
          );
        })}
      </div>

      {visibleDetail ? (
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {active ? <p className="composer-disabled-reason">Codex 正在回复，本轮完成或停止后即可继续。</p> : null}
          {composerError ? <ErrorBanner message={composerError} /> : null}
          {codexError ? <ErrorBanner message={codexError} onRetry={() => void loadCodexConfig()} /> : null}
          {permissionMode === "full" ? <p className="composer-full-warning" role="alert">完全权限：不审批且可访问工作区外文件，请仅在可信隔离项目中使用。</p> : null}
          {attachments.length > 0 ? (
            <div className="composer-attachment-grid" aria-label="已选附件">
              {attachments.map((attachment) => (
                <div className={`composer-attachment${attachment.previewUrl ? " is-image" : ""}`} key={attachment.id}>
                  {attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.file.name} /> : <span className="composer-file-mark" aria-hidden="true">文</span>}
                  <span className="composer-attachment-copy"><strong>{attachment.file.name}</strong><small>{formatBytes(attachment.file.size)}</small></span>
                  <button type="button" aria-label={`移除 ${attachment.file.name}`} onClick={() => removeAttachment(attachment.id)} disabled={composerDisabled}>×</button>
                </div>
              ))}
              <button type="button" className="text-button composer-clear-files" onClick={clearAttachments} disabled={composerDisabled}>清除全部</button>
            </div>
          ) : null}
          <ChatComposerEditor
            ref={composerEditor}
            value={task}
            skills={training.skills}
            disabled={composerDisabled}
            onChange={setTask}
            onSkillIdsChange={setSelectedSkillIds}
            onSend={() => void send()}
            onPaste={pasteFiles}
          />
          <div className="composer-settings-row">
            <div className="composer-attachments">
              <input
                ref={fileInput}
                id="chat-materials"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,*/*"
                multiple
                onChange={(event) => {
                  addFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
                disabled={composerDisabled}
              />
              <label htmlFor="chat-materials">附件 {attachments.length > 0 ? attachments.length : ""}</label>
            </div>
            <div className="composer-skills" ref={skillsMenu}>
              <button type="button" className="composer-control" aria-expanded={skillsOpen} aria-haspopup="dialog" onMouseDown={(event) => event.preventDefault()} onClick={() => setSkillsOpen((current) => !current)} disabled={settingsDisabled}>
                @ Skills{selectedSkillIds.length > 0 ? ` ${selectedSkillIds.length}` : ""}
              </button>
            </div>
            <label className="composer-select"><span>权限</span><select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as PermissionMode)} disabled={settingsDisabled}>{Object.entries(permissionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="composer-select"><span>模型</span><select value={model} onChange={(event) => { setModel(event.target.value); setEffort(""); }} disabled={settingsDisabled || !codexConfig}>{codexConfig?.models.map((option) => <option key={option.id} value={option.model}>{option.displayName}</option>)}</select></label>
            <label className="composer-select"><span>思考</span><select value={effort} onChange={(event) => setEffort(event.target.value)} disabled={settingsDisabled || !selectedModel}><option value="">跟随模型{selectedModel ? `（${selectedModel.defaultReasoningEffort}）` : ""}</option>{selectedModel?.supportedReasoningEfforts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <button type="submit" className="button button-primary composer-send" disabled={composerDisabled || !task.trim() || !selectedModel}>{sending ? "正在发送…" : "发送"}</button>
          </div>
          {skillsOpen ? (
            <div ref={skillsPopover} className="composer-skills-popover composer-skills-toolbar-popover" role="dialog" aria-label="调用本轮 Skills">
              <div className="composer-skills-heading"><strong>调用 Skill</strong><span>插入到输入框</span></div>
              <div className="composer-skill-options">
                {training.skills.map((skill) => (
                  <button
                    type="button"
                    key={skill.skillId}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      composerEditor.current?.insertSkill(skill.skillId);
                      setSkillsOpen(false);
                    }}
                  >
                    <span><strong>@{skill.skillId}</strong><small>{skill.path}</small></span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="composer-limits">输入 @ 或点击 Skills 调用能力；最多 10 个附件，每个不超过 10 MB；设置仅用于本轮</p>
        </form>
      ) : null}
    </section>
  );
}
