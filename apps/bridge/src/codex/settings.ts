import type { v2 } from "@skillhub/codex-protocol";
import {
  codexApprovalPolicySchema,
  codexConfigResponseSchema,
  codexSandboxModeSchema,
  codexWebSearchModeSchema,
  type CodexApprovalPolicy,
  type CodexConfigChanges,
  type CodexConfigResponse,
  type CodexConfigUpdate,
  type CodexModelOption,
  type CodexSandboxMode,
  type CodexSettings,
  type CodexWebSearchMode,
  type SystemStatus,
} from "@skillhub/shared";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { AppServerClient, CodexRpcError } from "./app-server-client.js";
import { getCodexStatus } from "./service.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法完成 Codex 配置操作";
}

function approvalPolicy(value: unknown): CodexApprovalPolicy | null {
  const result = codexApprovalPolicySchema.safeParse(value);
  return result.success ? result.data : null;
}

function sandboxMode(value: unknown): CodexSandboxMode | null {
  const result = codexSandboxModeSchema.safeParse(value);
  return result.success ? result.data : null;
}

function webSearchMode(value: unknown): CodexWebSearchMode | null {
  const result = codexWebSearchModeSchema.safeParse(value);
  return result.success ? result.data : null;
}

function assertReady(codex: SystemStatus["codex"]): void {
  if (!codex.available || !codex.compatible) {
    throw new HttpError(503, "CODEX_NOT_READY", codex.error ?? "Codex 不可用");
  }
}

export class CodexSettingsService {
  constructor(private readonly getActiveRunId: () => string | null) {}

  async read(): Promise<CodexConfigResponse> {
    const codex = await getCodexStatus();
    const cliPath = codex.executablePath;
    if (!codex.available || !codex.compatible) {
      return codexConfigResponseSchema.parse({
        codex,
        cliCommand: cliPath ?? config.codexPath ?? "codex",
        cliPath,
        configFilePath: null,
        configVersion: null,
        settings: null,
        models: [],
        allowedApprovalPolicies: null,
        allowedSandboxModes: null,
        allowedWebSearchModes: null,
        warnings: [codex.error ?? "Codex 不可用"],
      });
    }
    return this.withClient((client) => this.readWithClient(client, codex, cliPath), cliPath);
  }

  async update(input: CodexConfigUpdate): Promise<CodexConfigResponse> {
    this.assertNoActiveRun();
    const codex = await getCodexStatus();
    const cliPath = codex.executablePath;
    assertReady(codex);

    return this.withClient(async (client) => {
      const before = await this.readWithClient(client, codex, cliPath);
      if (!before.settings) throw new HttpError(503, "CODEX_CONFIG_UNAVAILABLE", "无法读取 Codex 配置");
      if (input.expectedVersion !== before.configVersion) {
        throw new HttpError(409, "CODEX_CONFIG_CONFLICT", "配置已被其他程序修改，请重新读取后再保存");
      }
      this.validateChanges(input, before);
      this.assertNoActiveRun();

      let result: v2.ConfigWriteResponse;
      try {
        result = await client.call<v2.ConfigWriteResponse>("config/batchWrite", {
          edits: this.createEdits(input.changes),
          filePath: before.configFilePath,
          expectedVersion: before.configVersion,
          reloadUserConfig: true,
        }, 30_000);
      } catch (error) {
        const message = errorMessage(error);
        if (error instanceof CodexRpcError && /version|conflict|modified|stale/i.test(message)) {
          throw new HttpError(409, "CODEX_CONFIG_CONFLICT", `配置版本冲突，请重新读取后再保存：${message}`);
        }
        throw new HttpError(400, "CODEX_CONFIG_WRITE_FAILED", message);
      }

      const updated = await this.readWithClient(client, codex, cliPath);
      if (result.status === "okOverridden") {
        updated.warnings.push(
          result.overriddenMetadata?.message
            ?? "配置已写入，但被更高优先级的配置覆盖；页面显示实际生效值",
        );
      }
      return codexConfigResponseSchema.parse(updated);
    }, cliPath);
  }

  private async withClient<T>(operation: (client: AppServerClient) => Promise<T>, codexPath: string | null): Promise<T> {
    let client: AppServerClient;
    try {
      client = await AppServerClient.start({}, codexPath ?? undefined);
    } catch (error) {
      throw new HttpError(503, "CODEX_UNAVAILABLE", errorMessage(error));
    }
    try {
      return await operation(client);
    } finally {
      await client.stop();
    }
  }

  private async readWithClient(
    client: AppServerClient,
    codex: SystemStatus["codex"],
    cliPath: string | null,
  ): Promise<CodexConfigResponse> {
    const [configuration, requirements, modelResult] = await Promise.all([
      client.call<v2.ConfigReadResponse>("config/read", { includeLayers: true }),
      this.readRequirements(client),
      this.readModels(client),
    ]);
    const warnings = [...requirements.warnings, ...modelResult.warnings];
    const models = modelResult.models;
    const userLayer = configuration.layers?.find(
      (layer: v2.ConfigLayer) => layer.name.type === "user" && layer.name.profile === null,
    );
    if (userLayer?.disabledReason) warnings.push(`用户配置层不可用：${userLayer.disabledReason}`);
    if (!codex.loggedIn) warnings.push("Codex 尚未登录；可以修改配置，但执行测试前需要先登录");

    const configuredModel = typeof configuration.config.model === "string"
      ? configuration.config.model
      : "";
    const model = configuredModel || models.find((candidate: CodexModelOption) => candidate.isDefault)?.model || "";
    const selectedModel = models.find((candidate: CodexModelOption) => candidate.model === model);
    if (configuredModel && models.length > 0 && !selectedModel) {
      warnings.push("当前模型不在可用列表中；保存其他设置不会改变它");
    }

    const approval = approvalPolicy(configuration.config.approval_policy);
    const sandbox = sandboxMode(configuration.config.sandbox_mode);
    const webSearch = webSearchMode(configuration.config.web_search);
    if (configuration.config.approval_policy !== null && !approval) {
      warnings.push("当前使用细粒度审批配置，本页不会自动改写它");
    }
    if (configuration.config.sandbox_mode !== null && !sandbox) {
      warnings.push("当前沙箱配置无法在本页表示，本页不会自动改写它");
    }

    let webSearchSetting: CodexSettings["webSearch"];
    if (configuration.config.web_search === null) {
      const legacyWebSearch: unknown = configuration.config.tools?.web_search;
      if (legacyWebSearch === true) webSearchSetting = "live";
      else if (legacyWebSearch === false || legacyWebSearch == null) webSearchSetting = "disabled";
      else {
        webSearchSetting = "custom";
        warnings.push("当前包含高级网页搜索配置，本页仅保留，不自动转换");
      }
    } else {
      webSearchSetting = webSearch ?? "custom";
      if (!webSearch) warnings.push("当前网页搜索模式无法在本页表示，本页不会自动改写它");
    }

    const settings: CodexSettings = {
      model,
      reasoningEffort: configuration.config.model_reasoning_effort
        ?? selectedModel?.defaultReasoningEffort
        ?? "",
      approvalPolicy: approval ?? (configuration.config.approval_policy === null ? "default" : "custom"),
      sandboxMode: sandbox ?? (configuration.config.sandbox_mode === null ? "default" : "custom"),
      networkAccess: configuration.config.sandbox_workspace_write?.network_access ?? false,
      webSearch: webSearchSetting,
    };
    if (selectedModel && settings.reasoningEffort
      && !selectedModel.supportedReasoningEfforts.includes(settings.reasoningEffort)) {
      warnings.push("当前推理级别不在所选模型的支持列表中；保存其他设置不会改变它");
    }

    const allowedApprovalPolicies = requirements.value?.allowedApprovalPolicies
      ?.map(approvalPolicy).filter((value: CodexApprovalPolicy | null): value is CodexApprovalPolicy => value !== null) ?? null;
    const allowedSandboxModes = requirements.value?.allowedSandboxModes
      ?.map(sandboxMode).filter((value: CodexSandboxMode | null): value is CodexSandboxMode => value !== null) ?? null;
    const allowedWebSearchModes = requirements.value?.allowedWebSearchModes
      ?.map(webSearchMode).filter((value: CodexWebSearchMode | null): value is CodexWebSearchMode => value !== null) ?? null;

    return codexConfigResponseSchema.parse({
      codex,
      cliCommand: cliPath ?? config.codexPath ?? "codex",
      cliPath,
      configFilePath: userLayer?.name.type === "user" ? userLayer.name.file : null,
      configVersion: userLayer?.version ?? null,
      settings,
      models,
      allowedApprovalPolicies,
      allowedSandboxModes,
      allowedWebSearchModes,
      warnings,
    });
  }

  private async readRequirements(client: AppServerClient): Promise<{
    value: v2.ConfigRequirements | null;
    warnings: string[];
  }> {
    try {
      const result = await client.call<v2.ConfigRequirementsReadResponse>("configRequirements/read", undefined);
      return { value: result.requirements, warnings: [] };
    } catch (error) {
      return {
        value: null,
        warnings: [`无法读取配置限制，Codex 将在保存时继续校验：${errorMessage(error)}`],
      };
    }
  }

  private async readModels(client: AppServerClient): Promise<{
    models: CodexModelOption[];
    warnings: string[];
  }> {
    try {
      const models: CodexModelOption[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5 && models.length < 100; page += 1) {
        const response: v2.ModelListResponse = await client.call<v2.ModelListResponse>("model/list", {
          cursor,
          limit: 100,
          includeHidden: false,
        });
        models.push(...response.data.filter((model: v2.Model) => !model.hidden).map((model: v2.Model) => ({
          id: model.id,
          model: model.model,
          displayName: model.displayName,
          description: model.description,
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts.map(
            (option: v2.ReasoningEffortOption) => option.reasoningEffort,
          ),
          isDefault: model.isDefault,
        })));
        cursor = response.nextCursor;
        if (!cursor) break;
      }
      return { models: models.slice(0, 100), warnings: [] };
    } catch (error) {
      return {
        models: [],
        warnings: [`模型列表不可用，模型和推理级别暂不可编辑：${errorMessage(error)}`],
      };
    }
  }

  private assertNoActiveRun(): void {
    if (this.getActiveRunId()) {
      throw new HttpError(409, "CODEX_RUN_ACTIVE", "测试运行期间不能修改 Codex 配置，请先完成或停止测试");
    }
  }

  private validateChanges(input: CodexConfigUpdate, current: CodexConfigResponse): void {
    const { changes } = input;
    if (!current.settings) throw new HttpError(503, "CODEX_CONFIG_UNAVAILABLE", "配置不可用");
    if (changes.sandboxMode === "danger-full-access" && input.confirmDangerFullAccess !== true) {
      throw new HttpError(400, "DANGEROUS_SANDBOX_CONFIRMATION_REQUIRED", "启用完全访问前必须明确确认风险");
    }
    if (changes.approvalPolicy && current.allowedApprovalPolicies
      && !current.allowedApprovalPolicies.includes(changes.approvalPolicy)) {
      throw new HttpError(400, "CODEX_CONFIG_NOT_ALLOWED", "该审批策略已被管理员限制");
    }
    if (changes.sandboxMode && current.allowedSandboxModes
      && !current.allowedSandboxModes.includes(changes.sandboxMode)) {
      throw new HttpError(400, "CODEX_CONFIG_NOT_ALLOWED", "该沙箱模式已被管理员限制");
    }
    if (changes.webSearch && current.allowedWebSearchModes
      && !current.allowedWebSearchModes.includes(changes.webSearch)) {
      throw new HttpError(400, "CODEX_CONFIG_NOT_ALLOWED", "该网页搜索模式已被管理员限制");
    }

    if (changes.model !== undefined) {
      const model = current.models.find((candidate) => candidate.model === changes.model);
      if (!model) throw new HttpError(400, "CODEX_MODEL_UNAVAILABLE", "所选模型不在本机可用列表中");
      const effort = changes.reasoningEffort ?? model.defaultReasoningEffort;
      if (!model.supportedReasoningEfforts.includes(effort)) {
        throw new HttpError(400, "CODEX_REASONING_UNAVAILABLE", "该模型不支持所选推理级别");
      }
    } else if (changes.reasoningEffort !== undefined) {
      const model = current.models.find((candidate) => candidate.model === current.settings?.model);
      if (!model || !model.supportedReasoningEfforts.includes(changes.reasoningEffort)) {
        throw new HttpError(400, "CODEX_REASONING_UNAVAILABLE", "当前模型不支持所选推理级别");
      }
    }
  }

  private createEdits(changes: CodexConfigChanges): v2.ConfigEdit[] {
    const edits: v2.ConfigEdit[] = [];
    if (changes.model !== undefined) {
      edits.push({ keyPath: "model", value: changes.model, mergeStrategy: "replace" });
    }
    if (changes.reasoningEffort !== undefined) {
      edits.push({ keyPath: "model_reasoning_effort", value: changes.reasoningEffort, mergeStrategy: "replace" });
    }
    if (changes.approvalPolicy !== undefined) {
      edits.push({ keyPath: "approval_policy", value: changes.approvalPolicy, mergeStrategy: "replace" });
    }
    if (changes.sandboxMode !== undefined) {
      edits.push({ keyPath: "sandbox_mode", value: changes.sandboxMode, mergeStrategy: "replace" });
    }
    if (changes.networkAccess !== undefined) {
      edits.push({ keyPath: "sandbox_workspace_write.network_access", value: changes.networkAccess, mergeStrategy: "replace" });
    }
    if (changes.webSearch !== undefined) {
      edits.push({ keyPath: "web_search", value: changes.webSearch, mergeStrategy: "replace" });
    }
    return edits;
  }
}
