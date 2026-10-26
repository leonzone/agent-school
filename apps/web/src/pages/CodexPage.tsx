import { useCallback, useEffect, useState } from "react";
import type {
  CodexApprovalPolicy,
  CodexConfigChanges,
  CodexConfigResponse,
  CodexSandboxMode,
  CodexSettings,
  CodexWebSearchMode,
} from "@skillhub/shared";
import { api } from "../api";
import { useSystemStatus } from "../components/SystemStatus";
import { Definition, EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { errorMessage } from "../utils";

const settingKeys: Array<keyof CodexSettings> = [
  "model",
  "reasoningEffort",
  "approvalPolicy",
  "sandboxMode",
  "networkAccess",
  "webSearch",
];

const approvalLabels: Record<CodexApprovalPolicy, string> = {
  untrusted: "仅可信命令免确认",
  "on-request": "由 Codex 请求审批",
  never: "不请求审批",
};

const sandboxLabels: Record<CodexSandboxMode, string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问（高风险）",
};

const webSearchLabels: Record<CodexWebSearchMode, string> = {
  disabled: "禁用",
  cached: "仅缓存搜索",
  indexed: "索引搜索",
  live: "实时网页搜索",
};

const reasoningLabels: Record<string, string> = {
  none: "无推理",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "Ultra",
};

export function CodexPage() {
  const { status, refresh: refreshSystemStatus } = useSystemStatus();
  const [data, setData] = useState<CodexConfigResponse | null>(null);
  const [draft, setDraft] = useState<CodexSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dangerConfirmed, setDangerConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.codexConfig();
      setData(result);
      setDraft(result.settings);
      setDangerConfirmed(false);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = data?.settings ?? null;
  const dirty = current !== null && draft !== null
    && settingKeys.some((key) => current[key] !== draft[key]);
  const busy = loading || saving;
  const selectedModel = data?.models.find((model) => model.model === draft?.model) ?? null;
  const efforts = selectedModel?.supportedReasoningEfforts
    ?? (draft?.reasoningEffort ? [draft.reasoningEffort] : []);
  const dangerConfirmationRequired = current?.sandboxMode !== "danger-full-access"
    && draft?.sandboxMode === "danger-full-access";

  function reload() {
    if (dirty && !window.confirm("重新读取会放弃尚未保存的修改，是否继续？")) return;
    void load();
  }

  function updateSetting<K extends keyof CodexSettings>(key: K, value: CodexSettings[K]) {
    setDraft((previous) => previous ? { ...previous, [key]: value } : previous);
    setMessage(null);
    setError(null);
  }

  function updateModel(modelName: string) {
    const model = data?.models.find((candidate) => candidate.model === modelName);
    setDraft((previous) => previous ? {
      ...previous,
      model: modelName,
      reasoningEffort: model?.defaultReasoningEffort ?? previous.reasoningEffort,
    } : previous);
    setMessage(null);
    setError(null);
  }

  function reset() {
    setDraft(current);
    setDangerConfirmed(false);
    setError(null);
    setMessage(null);
  }

  function changes(): CodexConfigChanges {
    const result: CodexConfigChanges = {};
    if (!current || !draft) return result;
    if (draft.model !== current.model) result.model = draft.model;
    if (draft.reasoningEffort !== current.reasoningEffort) result.reasoningEffort = draft.reasoningEffort;
    if (draft.approvalPolicy !== current.approvalPolicy && draft.approvalPolicy !== "default" && draft.approvalPolicy !== "custom") {
      result.approvalPolicy = draft.approvalPolicy;
    }
    if (draft.sandboxMode !== current.sandboxMode && draft.sandboxMode !== "default" && draft.sandboxMode !== "custom") {
      result.sandboxMode = draft.sandboxMode;
    }
    if (draft.networkAccess !== current.networkAccess) result.networkAccess = draft.networkAccess;
    if (draft.webSearch !== current.webSearch && draft.webSearch !== "custom") {
      result.webSearch = draft.webSearch;
    }
    return result;
  }

  async function save() {
    if (!data || !dirty || busy) return;
    if (dangerConfirmationRequired && !dangerConfirmed) {
      setError("启用完全访问前，请先确认你理解其风险");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateCodexConfig({
        expectedVersion: data.configVersion,
        changes: changes(),
        confirmDangerFullAccess: dangerConfirmed,
      });
      setData(result);
      setDraft(result.settings);
      setDangerConfirmed(false);
      setMessage("Codex 配置已保存，并重新读取了实际生效值");
      await refreshSystemStatus();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const codex = data?.codex ?? status?.codex ?? null;
  const ready = (codex?.available && codex.compatible && codex.loggedIn) ?? false;

  return (
    <div className="narrow-page codex-page">
      <PageHeader
        eyebrow="本地运行环境"
        title="Codex 管理"
        description="查看本机 Codex 状态，并配置新会话使用的模型、推理和默认权限。"
        actions={(
          <button type="button" className="button button-secondary" onClick={reload} disabled={busy}>
            {loading ? "正在读取…" : "重新检测"}
          </button>
        )}
      />

      <Notice>
        <strong>配置范围</strong>
        <p>此处修改 Codex 用户级默认配置。模型与推理对新会话生效；Agent School 测试仍固定使用 on-request、workspace-write，且工作区命令联网保持关闭。</p>
      </Notice>

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <section className="panel" aria-labelledby="codex-status-title">
        <div className="section-heading">
          <div><span className="eyebrow">Local Codex</span><h2 id="codex-status-title">运行诊断</h2></div>
          <span className={`badge ${ready ? "status-completed" : "status-failed"}`}>{ready ? "已就绪" : "需要检查"}</span>
        </div>
        <dl className="definition-grid">
          <Definition label="Codex 版本"><code>{codex?.version ?? "未知"}</code></Definition>
          <Definition label="登录状态"><span>{codex?.loggedIn ? `已登录（${codex.accountType ?? "账号"}）` : "未登录"}</span></Definition>
          <Definition label="CLI 命令"><code>{data?.cliCommand ?? "等待检测"}</code></Definition>
          <Definition label="CLI 路径"><code className="break-all">{data?.cliPath ?? "未解析"}</code></Definition>
          <Definition label="用户配置文件" wide><code className="break-all">{data?.configFilePath ?? "尚未读取"}</code></Definition>
        </dl>
        {codex?.error ? <p className="field-help">{codex.error}</p> : null}
        <p className="field-help">CLI 命令由 Bridge 启动环境决定。需要更换时，请设置 SKILLHUB_CODEX_PATH 并重启 Bridge。</p>
      </section>

      {data && data.warnings.length > 0 ? (
        <Notice>
          <strong>配置提示</strong>
          <ul className="settings-warning-list">
            {[...new Set(data.warnings)].map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </Notice>
      ) : null}

      {loading && !data ? <LoadingState label="正在读取 Codex 配置与模型" /> : null}
      {data && !data.settings ? (
        <EmptyState
          title="Codex 配置暂不可用"
          description="请先检查上方 CLI 版本和运行状态，再重新检测。"
          action={<button type="button" className="button button-secondary" onClick={reload} disabled={busy}>重新检测</button>}
        />
      ) : null}

      {data && current && draft ? (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <section className="panel" aria-labelledby="codex-model-title">
            <div className="section-heading">
              <div><span className="eyebrow">新会话默认值</span><h2 id="codex-model-title">模型与推理</h2></div>
            </div>
            <div className="form-two-columns">
              <div className="field">
                <label htmlFor="codex-model">默认模型</label>
                <select id="codex-model" value={draft.model} onChange={(event) => updateModel(event.target.value)} disabled={busy || data.models.length === 0}>
                  {!draft.model ? <option value="" disabled>Codex 默认</option> : null}
                  {draft.model && !selectedModel ? <option value={draft.model} disabled>{draft.model}（当前自定义）</option> : null}
                  {data.models.map((model) => <option value={model.model} key={model.id}>{model.displayName} · {model.model}</option>)}
                </select>
                <p className="field-help">选项直接来自本机 Codex，不修改模型服务商。</p>
              </div>
              <div className="field">
                <label htmlFor="codex-reasoning">推理级别</label>
                <select id="codex-reasoning" value={draft.reasoningEffort} onChange={(event) => updateSetting("reasoningEffort", event.target.value)} disabled={busy || !selectedModel}>
                  {!draft.reasoningEffort ? <option value="" disabled>模型默认</option> : null}
                  {efforts.map((effort) => <option value={effort} key={effort}>{reasoningLabels[effort] ?? effort} · {effort}</option>)}
                </select>
                <p className="field-help">切换模型时会采用新模型的默认推理级别。</p>
              </div>
            </div>
            {selectedModel?.description ? <p className="model-description">{selectedModel.description}</p> : null}
          </section>

          <section className="panel" aria-labelledby="codex-permissions-title">
            <div className="section-heading">
              <div><span className="eyebrow">Codex 全局默认</span><h2 id="codex-permissions-title">权限与网络</h2></div>
            </div>
            <div className="form-two-columns">
              <div className="field">
                <label htmlFor="codex-approval">审批策略</label>
                <select id="codex-approval" value={draft.approvalPolicy} onChange={(event) => updateSetting("approvalPolicy", event.target.value as CodexSettings["approvalPolicy"])} disabled={busy || draft.approvalPolicy === "custom"}>
                  {draft.approvalPolicy === "default" ? <option value="default" disabled>跟随 Codex 默认</option> : null}
                  {draft.approvalPolicy === "custom" ? <option value="custom" disabled>细粒度配置（保留）</option> : null}
                  {(Object.keys(approvalLabels) as CodexApprovalPolicy[]).map((policy) => (
                    <option value={policy} key={policy} disabled={data.allowedApprovalPolicies !== null && !data.allowedApprovalPolicies.includes(policy)}>{approvalLabels[policy]} · {policy}</option>
                  ))}
                </select>
                <p className="field-help">不会降低 Agent School 测试现有的人工审批要求。</p>
              </div>
              <div className="field">
                <label htmlFor="codex-sandbox">沙箱模式</label>
                <select id="codex-sandbox" value={draft.sandboxMode} onChange={(event) => { updateSetting("sandboxMode", event.target.value as CodexSettings["sandboxMode"]); setDangerConfirmed(false); }} disabled={busy || draft.sandboxMode === "custom"}>
                  {draft.sandboxMode === "default" ? <option value="default" disabled>跟随 Codex 默认</option> : null}
                  {draft.sandboxMode === "custom" ? <option value="custom" disabled>自定义配置（保留）</option> : null}
                  {(Object.keys(sandboxLabels) as CodexSandboxMode[]).map((mode) => (
                    <option value={mode} key={mode} disabled={data.allowedSandboxModes !== null && !data.allowedSandboxModes.includes(mode)}>{sandboxLabels[mode]} · {mode}</option>
                  ))}
                </select>
                <p className="field-help">Agent School 测试仍固定为 workspace-write。</p>
              </div>
            </div>
            <div className="field checkbox-field">
              <label htmlFor="codex-network">
                <input
                  id="codex-network"
                  type="checkbox"
                  checked={draft.networkAccess}
                  onChange={(event) => updateSetting("networkAccess", event.target.checked)}
                  disabled={busy}
                />
                <span>允许工作区命令联网</span>
              </label>
              <p className="field-help">对应 sandbox_workspace_write.network_access，仅影响 Codex 的 workspace-write 默认配置。</p>
            </div>
            <div className="field">
              <label htmlFor="codex-web-search">网页搜索</label>
              <select id="codex-web-search" value={draft.webSearch} onChange={(event) => updateSetting("webSearch", event.target.value as CodexSettings["webSearch"])} disabled={busy || draft.webSearch === "custom"}>
                {draft.webSearch === "custom" ? <option value="custom" disabled>自定义搜索配置（保留）</option> : null}
                {(Object.keys(webSearchLabels) as CodexWebSearchMode[]).map((mode) => (
                  <option value={mode} key={mode} disabled={data.allowedWebSearchModes !== null && !data.allowedWebSearchModes.includes(mode)}>{webSearchLabels[mode]} · {mode}</option>
                ))}
              </select>
            </div>
          </section>

          {draft.sandboxMode === "danger-full-access" ? (
            <Notice tone="warning">
              <strong>完全访问会移除命令的沙箱限制</strong>
              <p>Codex 执行的错误或恶意命令可能影响本机文件和系统。请只在理解风险后启用。</p>
              {dangerConfirmationRequired ? (
                <label className="danger-confirmation" htmlFor="codex-danger-confirm">
                  <input id="codex-danger-confirm" type="checkbox" checked={dangerConfirmed} onChange={(event) => setDangerConfirmed(event.target.checked)} disabled={busy} />
                  <span>我确认允许 Codex 使用 danger-full-access</span>
                </label>
              ) : null}
            </Notice>
          ) : null}

          <div className="form-footer settings-footer">
            <p>仅保存本次修改的字段。检测到版本冲突时，不会自动覆盖其他程序的修改。</p>
            <div className="button-row">
              <button type="button" className="button button-secondary" onClick={reset} disabled={!dirty || busy}>放弃修改</button>
              <button type="submit" className="button button-primary" disabled={!dirty || busy || (dangerConfirmationRequired && !dangerConfirmed)}>
                {saving ? "正在保存…" : "保存配置"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
