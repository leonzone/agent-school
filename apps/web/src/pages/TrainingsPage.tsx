import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, TrainedAgent } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { EmptyState, ErrorBanner, LoadingState, Notice } from "../components/UI";
import { navigate } from "../router";
import { agentAvatar, errorMessage, formatDate } from "../utils";
import { AgentChatPage } from "./AgentChatPage";

import { PencilIcon, CheckIcon, XIcon, RefreshCwIcon, PlusIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Field, FieldLabel, FieldGroup } from "../components/ui/field";

type ConfigTab = "role" | "capabilities" | "training";
type CapabilityTab = "skills" | "mcp" | "connectors";

function previewText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

export function TrainingsPage({ agentId }: { agentId?: string | undefined }) {
  const [trainings, setTrainings] = useState<TrainedAgent[]>([]);
  const [skillDescriptions, setSkillDescriptions] = useState<Record<string, string> | null>(null);
  const [skillDescriptionsError, setSkillDescriptionsError] = useState<string | null>(null);
  const [messagePreviews, setMessagePreviews] = useState<Record<string, string>>({});
  const updateMessagePreview = useCallback((id: string, text: string) => {
    setMessagePreviews((current) => current[id] === text ? current : { ...current, [id]: text });
  }, []);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(true);
  const [configTab, setConfigTab] = useState<ConfigTab>("role");
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>("skills");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadSkillDescriptions = useCallback(async () => {
    setSkillDescriptionsError(null);
    try {
      const catalog = await api.catalog();
      setSkillDescriptions(Object.fromEntries(catalog.skills.map((skill) => [skill.id, skill.description])));
    } catch (error) {
      setSkillDescriptionsError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadSkillDescriptions();
  }, [loadSkillDescriptions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trainingData, agentData] = await Promise.all([api.trainings(), api.agents()]);
      setTrainings(trainingData.trainings);
      setAgents(agentData.agents);
      const previews = await Promise.all(trainingData.trainings.map(async (training) => {
        try {
          const { conversations } = await api.conversations(training.agentId);
          const conversation = conversations[0];
          if (!conversation) return [training.agentId, "暂无消息"] as const;
          const detail = await api.conversation(conversation.id);
          const latest = detail.runs.at(-1);
          return [training.agentId, latest?.finalText || latest?.task || "暂无消息"] as const;
        } catch { return [training.agentId, "消息暂不可用"] as const; }
      }));
      setMessagePreviews(Object.fromEntries(previews));
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
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
      {loading ? <LoadingState label="正在读取员工与培训项目" /> : null}

      {!loading && employees.length === 0 ? (
        <EmptyState
          title="还没有可工作的员工"
          description="前往学习中心创建或选择角色，完成首次培训后即可在这里开始协作。"
          action={<Button render={<Link to="/">前往学习中心</Link>} nativeButton={false} />}
        />
      ) : null}

      {!loading && selected ? (
        <div className={`employee-workspace${configOpen ? "" : " is-config-closed"}`}>
          <aside className="employee-sidebar" aria-label="员工列表">
            <div className="employee-sidebar-actions">
              <Button type="button" variant="ghost" size="icon" aria-label="重新检查" title="重新检查" onClick={() => void load()} disabled={loading}><RefreshCwIcon /></Button>
              <Button variant="outline" size="icon" render={<Link to="/" aria-label="新增员工" title="新增员工"><PlusIcon /></Link>} nativeButton={false} />
            </div>
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
                    <span className="employee-list-copy"><strong>{agent.name}</strong><span className="employee-message-preview" title={previewText(messagePreviews[agent.id] ?? "")}>{previewText(messagePreviews[agent.id] ?? "正在读取消息…")}</span></span>
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
              onMessagePreview={updateMessagePreview}
              configOpen={configOpen}
              onAvatarClick={() => setConfigOpen((current) => !current)}
            />
          </div>

          {configOpen ? (
            <aside className="employee-config" id="employee-config" aria-label="员工配置">
              <div className="employee-profile-heading">
                {editingProfile ? (
                  <form className="employee-profile-inline-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} onKeyDown={(event) => { if (event.key === "Escape" && !profileSaving) { setEditingProfile(false); setProfileError(null); } }}>
                    <FieldGroup>
                      <Field><FieldLabel className="sr-only" htmlFor="employee-profile-avatar">Emoji 头像</FieldLabel><Input id="employee-profile-avatar" aria-label="Emoji 头像" value={profileAvatar} onChange={(event) => setProfileAvatar(event.target.value)} maxLength={16} required disabled={profileSaving} /></Field>
                      <Field><FieldLabel className="sr-only" htmlFor="employee-profile-name">员工名字</FieldLabel><Input id="employee-profile-name" aria-label="员工名字" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} required disabled={profileSaving} autoFocus /></Field>
                    </FieldGroup>
                    {profileError ? <ErrorBanner message={profileError} /> : null}
                    <div className="employee-profile-inline-actions"><Button type="submit" size="icon-sm" variant="ghost" aria-label="保存资料" disabled={profileSaving}><CheckIcon /></Button><Button type="button" size="icon-sm" variant="ghost" aria-label="取消编辑" onClick={() => { setEditingProfile(false); setProfileError(null); }} disabled={profileSaving}><XIcon /></Button></div>
                  </form>
                ) : <>
                  <Button type="button" variant="ghost" className="employee-profile-avatar-edit" onClick={editProfile} aria-label="编辑员工头像"><span className="employee-avatar employee-profile-avatar" aria-hidden="true">{agentAvatar(selected.agent)}</span><PencilIcon className="profile-edit-icon" /></Button>
                  <Button type="button" variant="ghost" className="employee-profile-name-edit" onClick={editProfile} aria-label="编辑员工名字"><h2>{selected.agent.name}</h2><PencilIcon className="profile-edit-icon" /></Button>
                </>}
                <p>{selected.agent.description}</p>
              </div>

              <Tabs value={configTab} onValueChange={(value) => setConfigTab(value as ConfigTab)}>
                <TabsList aria-label="员工配置分类" className="w-full">
                  <TabsTrigger value="role">角色设定</TabsTrigger>
                  <TabsTrigger value="capabilities">能力</TabsTrigger>
                  <TabsTrigger value="training">培训状态</TabsTrigger>
                </TabsList>
                <TabsContent value={configTab} className="employee-config-panel">
                {configTab === "role" ? (
                  <section className="employee-instructions" aria-label="角色设定">
                    <Markdown>{selected.agent.instructions}</Markdown>
                  </section>
                ) : null}
                {configTab === "capabilities" ? (
                  <section aria-label="员工能力">
                    <Tabs value={capabilityTab} onValueChange={(value) => setCapabilityTab(value as CapabilityTab)}>
                      <TabsList aria-label="能力分类" className="w-full">
                        <TabsTrigger value="skills">Skills</TabsTrigger>
                        <TabsTrigger value="mcp">MCP</TabsTrigger>
                        <TabsTrigger value="connectors">连接器</TabsTrigger>
                      </TabsList>
                      <TabsContent value={capabilityTab}>
                    {capabilityTab === "skills" ? (
                      <>
                      {skillDescriptionsError ? <ErrorBanner message={skillDescriptionsError} onRetry={() => void loadSkillDescriptions()} /> : null}
                      <ul className="employee-skill-list">
                        {selected.training.skills.map((skill) => (
                          <li key={skill.skillId}><strong>{skill.skillId}</strong><span className="employee-skill-description">{skillDescriptions?.[skill.skillId] || (skillDescriptions ? "暂无描述" : skillDescriptionsError ? "描述暂不可用" : "正在读取描述…")}</span></li>
                        ))}
                      </ul>
                      </>
                    ) : null}
                    {capabilityTab === "mcp" ? <div className="employee-config-empty"><strong>MCP 未开放</strong><p>当前员工没有可配置的 MCP 服务。</p></div> : null}
                    {capabilityTab === "connectors" ? <div className="employee-config-empty"><strong>连接器未开放</strong><p>当前员工没有可配置的外部连接器。</p></div> : null}
                      </TabsContent>
                    </Tabs>
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
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => void update(selected.training)}
                      disabled={updatingId !== null || selected.training.locallyModified}
                    >
                      {updatingId === selected.agent.id ? "正在更新培训…" : "更新培训"}
                    </Button>
                  </section>
                ) : null}
                </TabsContent>
              </Tabs>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
