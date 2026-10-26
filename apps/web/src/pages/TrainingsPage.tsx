import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, TrainedAgent } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { navigate } from "../router";
import { agentAvatar, errorMessage, formatDate } from "../utils";
import { AgentChatPage } from "./AgentChatPage";

type ConfigTab = "role" | "capabilities" | "training";
type CapabilityTab = "skills" | "mcp" | "connectors";

export function TrainingsPage({ agentId }: { agentId?: string | undefined }) {
  const [trainings, setTrainings] = useState<TrainedAgent[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>("role");
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>("skills");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trainingData, agentData] = await Promise.all([api.trainings(), api.agents()]);
      setTrainings(trainingData.trainings);
      setAgents(agentData.agents);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const employees = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    return trainings.flatMap((training) => {
      const agent = agentById.get(training.agentId);
      return agent ? [{ agent, training }] : [];
    });
  }, [agents, trainings]);
  const selected = employees.find(({ agent }) => agent.id === agentId) ?? employees[0] ?? null;
  const selectedId = selected?.agent.id;

  useEffect(() => {
    if (selectedId && selectedId !== agentId) {
      navigate(`/trainings/${encodeURIComponent(selectedId)}`, true);
    }
  }, [agentId, selectedId]);

  useEffect(() => {
    setConfigTab("role");
    setCapabilityTab("skills");
    setEditingProfile(false);
    setProfileSaving(false);
    setProfileError(null);
  }, [selectedId]);

  async function update(training: TrainedAgent) {
    if (updatingId || training.locallyModified) return;
    setUpdatingId(training.agentId);
    setError(null);
    setMessage(null);
    setWarning(null);
    try {
      const result = await api.trainAgent(training.agentId);
      setTrainings((current) => current.map((item) => item.agentId === training.agentId ? result.training : item));
      setMessage(`${result.training.agentName} 已更新到 revision ${result.training.revision}。历史聊天保留，新回复使用最新培训上下文。`);
      if (result.codexError) setWarning(`培训文件已更新，但 Codex 同步未完成：${result.codexError}`);
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setUpdatingId(null);
    }
  }

  function editProfile() {
    if (!selected) return;
    setProfileName(selected.agent.name);
    setProfileAvatar(agentAvatar(selected.agent));
    setProfileError(null);
    setEditingProfile(true);
  }

  async function saveProfile() {
    if (!selected || profileSaving) return;
    const name = profileName.trim();
    const avatar = profileAvatar.trim();
    if (!name || !avatar) {
      setProfileError("名字和 emoji 头像不能为空");
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    setMessage(null);
    try {
      const result = await api.updateAgentProfile(selected.agent.id, { name, avatar });
      setAgents((current) => current.map((agent) => agent.id === result.agent.id ? result.agent : agent));
      setTrainings((current) => current.map((training) => training.agentId === result.agent.id
        ? { ...training, agentName: result.agent.name }
        : training));
      setProfileName(result.agent.name);
      setProfileAvatar(agentAvatar(result.agent));
      setEditingProfile(false);
      setMessage(`${result.agent.name} 的资料已更新`);
    } catch (saveError) {
      setProfileError(errorMessage(saveError));
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="employee-page">
      <PageHeader
        eyebrow="Agent School"
        title="我的员工"
        description="选择已培训员工，直接在固定项目中协作；角色配置与培训版本可随时查看。"
        actions={(
          <div className="button-row">
            <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>重新检查</button>
            <Link className="button button-primary" to="/">新增员工</Link>
          </div>
        )}
      />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
      {loading ? <LoadingState label="正在读取员工与培训项目" /> : null}

      {!loading && employees.length === 0 ? (
        <EmptyState
          title="还没有可工作的员工"
          description="前往学习中心创建或选择角色，完成首次培训后即可在这里开始协作。"
          action={<Link className="button button-primary" to="/">前往学习中心</Link>}
        />
      ) : null}

      {!loading && selected ? (
        <div className={`employee-workspace${configOpen ? "" : " is-config-closed"}`}>
          <aside className="employee-sidebar" aria-label="员工列表">
            <div className="employee-sidebar-heading"><strong>员工</strong><span>{employees.length}</span></div>
            <nav className="employee-list" aria-label="选择员工">
              {employees.map(({ agent }) => {
                const current = agent.id === selected.agent.id;
                return (
                  <Link
                    key={agent.id}
                    to={`/trainings/${encodeURIComponent(agent.id)}`}
                    className={`employee-list-item${current ? " is-selected" : ""}`}
                    aria-current={current ? "page" : undefined}
                  >
                    <span className="employee-avatar" aria-hidden="true">{agentAvatar(agent)}</span>
                    <span className="employee-list-copy"><strong>{agent.name}</strong></span>
                  </Link>
                );
              })}
            </nav>
          </aside>

          <div className="employee-chat-column">
            <AgentChatPage
              key={selected.agent.id}
              agent={selected.agent}
              training={selected.training}
              configOpen={configOpen}
              onAvatarClick={() => setConfigOpen((current) => !current)}
            />
          </div>

          {configOpen ? (
            <aside className="employee-config" id="employee-config" aria-label="员工配置">
              <div className="employee-profile-heading">
                <span className="employee-avatar employee-profile-avatar" aria-hidden="true">{agentAvatar(selected.agent)}</span>
                <div><h2>{selected.agent.name}</h2><p>{selected.agent.description}</p></div>
              </div>
              {!editingProfile ? <button type="button" className="button button-small button-secondary button-block" onClick={editProfile}>编辑资料</button> : null}
              {editingProfile ? (
                <form className="employee-profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
                  <div className="field">
                    <label htmlFor="employee-profile-name">员工名字</label>
                    <input id="employee-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} required disabled={profileSaving} />
                  </div>
                  <div className="field">
                    <label htmlFor="employee-profile-avatar">Emoji 头像</label>
                    <input id="employee-profile-avatar" value={profileAvatar} onChange={(event) => setProfileAvatar(event.target.value)} maxLength={16} required disabled={profileSaving} />
                    <p className="field-help">输入一个或一组 emoji，最多 16 个字符。</p>
                  </div>
                  {profileError ? <ErrorBanner message={profileError} /> : null}
                  <div className="button-row">
                    <button type="submit" className="button button-primary" disabled={profileSaving}>{profileSaving ? "正在保存…" : "保存"}</button>
                    <button type="button" className="button button-secondary" onClick={() => { setEditingProfile(false); setProfileError(null); }} disabled={profileSaving}>取消</button>
                  </div>
                </form>
              ) : null}

              <div className="employee-config-tabs" role="tablist" aria-label="员工配置分类">
                <button type="button" role="tab" aria-selected={configTab === "role"} onClick={() => setConfigTab("role")}>角色设定</button>
                <button type="button" role="tab" aria-selected={configTab === "capabilities"} onClick={() => setConfigTab("capabilities")}>能力</button>
                <button type="button" role="tab" aria-selected={configTab === "training"} onClick={() => setConfigTab("training")}>培训状态</button>
              </div>

              <div className="employee-config-panel" role="tabpanel">
                {configTab === "role" ? (
                  <section className="employee-instructions" aria-label="角色设定">
                    <Markdown>{selected.agent.instructions}</Markdown>
                  </section>
                ) : null}
                {configTab === "capabilities" ? (
                  <section aria-label="员工能力">
                    <div className="employee-config-subtabs" role="tablist" aria-label="能力分类">
                      <button type="button" role="tab" aria-selected={capabilityTab === "skills"} onClick={() => setCapabilityTab("skills")}>Skills</button>
                      <button type="button" role="tab" aria-selected={capabilityTab === "mcp"} onClick={() => setCapabilityTab("mcp")}>MCP</button>
                      <button type="button" role="tab" aria-selected={capabilityTab === "connectors"} onClick={() => setCapabilityTab("connectors")}>连接器</button>
                    </div>
                    {capabilityTab === "skills" ? (
                      <ul className="employee-skill-list">
                        {selected.training.skills.map((skill) => (
                          <li key={skill.skillId}><strong>{skill.skillId}</strong><code>{skill.commit}</code><span>{skill.path}</span></li>
                        ))}
                      </ul>
                    ) : null}
                    {capabilityTab === "mcp" ? <div className="employee-config-empty"><strong>MCP 未开放</strong><p>当前员工没有可配置的 MCP 服务。</p></div> : null}
                    {capabilityTab === "connectors" ? <div className="employee-config-empty"><strong>连接器未开放</strong><p>当前员工没有可配置的外部连接器。</p></div> : null}
                  </section>
                ) : null}
                {configTab === "training" ? (
                  <section aria-label="培训状态">
                    <dl className="employee-config-meta">
                      <div><dt>培训 revision</dt><dd>{selected.training.revision}</dd></div>
                      <div><dt>角色 revision</dt><dd>{selected.agent.revision}</dd></div>
                      <div><dt>项目路径</dt><dd><code>{selected.training.projectPath}</code></dd></div>
                      <div><dt>最近培训</dt><dd>{formatDate(selected.training.updatedAt)}</dd></div>
                    </dl>
                    {selected.training.locallyModified ? <p className="training-local-warning" role="alert">检测到本地修改，更新培训已阻止。请先备份并处理这些修改。</p> : null}
                    <button
                      type="button"
                      className="button button-primary button-block"
                      onClick={() => void update(selected.training)}
                      disabled={updatingId !== null || selected.training.locallyModified}
                    >
                      {updatingId === selected.agent.id ? "正在更新培训…" : "更新培训"}
                    </button>
                  </section>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
