import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, SkillSummary, TrainedAgent } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { EmptyState, ErrorBanner, LoadingState, Notice, PageHeader } from "../components/UI";
import { navigate } from "../router";
import { errorMessage, formatDate, shortCommit } from "../utils";

function nextCopyId(sourceId: string, existingIds: Set<string>): string {
  const base = `${sourceId}-copy`.slice(0, 64).replace(/-+$/, "");
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    const ending = `-${suffix}`;
    candidate = `${base.slice(0, 64 - ending.length)}${ending}`;
    suffix += 1;
  }
  return candidate;
}

export function AgentDetailPage({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [training, setTraining] = useState<TrainedAgent | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"copy" | "train" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentData, trainingData, catalogData] = await Promise.all([
        api.agent(id),
        api.trainings(),
        api.catalog().catch(() => null),
      ]);
      setAgent(agentData.agent);
      setTraining(trainingData.trainings.find((item) => item.agentId === id) ?? null);
      setSkills(catalogData?.skills ?? []);
      setCatalogWarning(catalogData ? null : "Skill 目录暂时不可用，所选 Skill 将以标识显示。");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const hasUpdate = agent !== null && training !== null && (
    training.revision < agent.revision
    || training.skills.some((trained) => {
      const latest = skillById.get(trained.skillId)?.latestVersion.commit;
      return latest !== undefined && latest !== trained.commit;
    })
  );

  async function copyAgent() {
    if (!agent || operation) return;
    setOperation("copy");
    setError(null);
    setMessage(null);
    try {
      const existing = await api.agents();
      const copyId = nextCopyId(agent.id, new Set(existing.agents.map((item) => item.id)));
      const result = await api.duplicateAgent(agent.id, {
        id: copyId,
        name: `${agent.name} 副本`.slice(0, 100),
      });
      setOperation(null);
      navigate(`/agents/${encodeURIComponent(result.agent.id)}`);
    } catch (copyError) {
      setError(errorMessage(copyError));
      setOperation(null);
    }
  }

  async function train() {
    if (!agent || operation || training?.locallyModified) return;
    setOperation("train");
    setError(null);
    setMessage(null);
    setCodexError(null);
    try {
      const result = await api.trainAgent(agent.id);
      setTraining(result.training);
      setCodexError(result.codexError);
      setMessage(hasUpdate ? "培训已更新到当前角色 revision" : "角色培训已完成");
    } catch (trainError) {
      setError(errorMessage(trainError));
    } finally {
      setOperation(null);
    }
  }

  async function remove() {
    if (!agent || operation) return;
    setOperation("delete");
    setError(null);
    setMessage(null);
    try {
      await api.deleteAgent(agent.id);
      navigate("/");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
      setOperation(null);
    }
  }

  if (loading && !agent) return <LoadingState label="正在读取角色与培训信息" />;
  if (!agent) {
    return (
      <div className="agent-page">
        <Link className="back-link" to="/">返回学习中心</Link>
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {!error ? <EmptyState title="角色不存在" description="该角色可能已从本机删除。" /> : null}
      </div>
    );
  }

  return (
    <div className="agent-page agent-detail-page">
      <Link className="back-link" to="/">返回学习中心</Link>
      <PageHeader
        eyebrow={agent.id}
        title={agent.name}
        description={agent.description}
        actions={(
          <div className="agent-header-actions">
            <Link className="button button-secondary" to={`/agents/${encodeURIComponent(agent.id)}/edit`}>编辑</Link>
            <button type="button" className="button button-secondary" onClick={() => void copyAgent()} disabled={operation !== null}>
              {operation === "copy" ? "正在复制…" : "复制"}
            </button>
            {(!training || hasUpdate) ? (
              <button type="button" className="button button-primary" onClick={() => void train()} disabled={operation !== null || training?.locallyModified}>
                {operation === "train" ? "正在培训…" : hasUpdate ? "更新培训" : "开始培训"}
              </button>
            ) : null}
            {training ? (
              <Link className="button button-secondary" to={`/agents/${encodeURIComponent(agent.id)}/test`}>测试调试</Link>
            ) : <button type="button" className="button button-secondary" disabled>测试调试</button>}
          </div>
        )}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {codexError ? <Notice tone="warning">培训文件已生成，但 Codex 同步未完成：{codexError}</Notice> : null}
      {catalogWarning ? <Notice tone="warning">{catalogWarning}</Notice> : null}
      {hasUpdate && training ? (
        <Notice tone="warning">角色指令或 Skills 已有新版本。当前培训为 revision {training.revision}，角色配置为 revision {agent.revision}；请更新培训后再测试最新内容。</Notice>
      ) : null}
      {training?.locallyModified ? <Notice tone="warning">培训目录存在本地修改，更新培训已被阻止。请先备份并处理这些修改。</Notice> : null}

      <div className="agent-detail-layout">
        <main className="agent-detail-main">
          <section className="panel agent-document" aria-labelledby="agent-document-title">
            <div className="section-heading">
              <div><span className="eyebrow">角色工作指令</span><h2 id="agent-document-title">AGENTS.md</h2></div>
              <span className="muted">revision {agent.revision}</span>
            </div>
            <Markdown>{agent.instructions}</Markdown>
          </section>
        </main>

        <aside className="agent-detail-sidebar">
          <section className="panel agent-skills" aria-labelledby="agent-skills-title">
            <div className="section-heading"><h2 id="agent-skills-title">所选 Skills</h2><span className="muted">{agent.skillIds.length} 个</span></div>
            <ul className="agent-skill-list">
              {agent.skillIds.map((skillId) => {
                const skill = skillById.get(skillId);
                return (
                  <li key={skillId}>
                    <strong>{skill?.displayName ?? skillId}</strong>
                    <code>{skillId}</code>
                    {skill ? <p>{skill.description}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel agent-training" aria-labelledby="agent-training-title">
            <div className="section-heading"><h2 id="agent-training-title">本机培训</h2>{training ? <span className="agent-status agent-status-trained">已培训</span> : null}</div>
            {training ? (
              <div className="agent-training-details">
                <dl>
                  <div><dt>培训路径</dt><dd><code>{training.projectPath}</code></dd></div>
                  <div><dt>培训 revision</dt><dd>{training.revision}</dd></div>
                  <div><dt>最近培训</dt><dd>{formatDate(training.updatedAt)}</dd></div>
                </dl>
                <h3>固定 Skill commits</h3>
                <ul className="agent-commit-list">
                  {training.skills.map((skill) => (
                    <li key={skill.skillId}>
                      <div><strong>{skillById.get(skill.skillId)?.displayName ?? skill.skillId}</strong><code title={skill.commit}>{shortCommit(skill.commit)}</code></div>
                      <code>{skill.path}</code>
                      <code className="agent-full-commit">{skill.commit}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="muted">尚未生成本机培训项目。完成培训后，这里会显示固定路径与 Skill commits。</p>}
          </section>

          <section className="panel agent-management" aria-labelledby="agent-management-title">
            <h2 id="agent-management-title">角色管理</h2>
            {training ? <p className="muted">已培训角色保留在本机，不能删除角色配置。</p> : confirmDelete ? (
              <div className="agent-delete-confirm" role="alert">
                <strong>确认删除“{agent.name}”？</strong>
                <p>删除后无法撤销，请确认不再需要此角色。</p>
                <div className="button-row">
                  <button type="button" className="button button-danger button-small" onClick={() => void remove()} disabled={operation !== null}>{operation === "delete" ? "正在删除…" : "确认删除"}</button>
                  <button type="button" className="button button-secondary button-small" onClick={() => setConfirmDelete(false)} disabled={operation !== null}>取消</button>
                </div>
              </div>
            ) : <button type="button" className="text-button button-danger-text" onClick={() => setConfirmDelete(true)} disabled={operation !== null}>删除角色</button>}
          </section>
        </aside>
      </div>
    </div>
  );
}
