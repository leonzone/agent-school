import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, TrainedAgent } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { CardSkeletons, EmptyState, ErrorBanner, PageHeader } from "../components/UI";
import { errorMessage, formatDate } from "../utils";

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [trainings, setTrainings] = useState<TrainedAgent[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentData, trainingData] = await Promise.all([api.agents(), api.trainings()]);
      setAgents(agentData.agents);
      setTrainings(trainingData.trainings);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trainingByAgent = useMemo(
    () => new Map(trainings.map((training) => [training.agentId, training])),
    [trainings],
  );
  const visibleAgents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return agents;
    return agents.filter((agent) => (
      `${agent.name} ${agent.id} ${agent.description}`.toLocaleLowerCase().includes(keyword)
    ));
  }, [agents, query]);

  return (
    <div className="agent-page">
      <PageHeader
        eyebrow="Agent School"
        title="学习中心"
        description="组合本机 AGENTS.md 指令与团队 Skills，培训、测试并持续更新适合实际工作的角色。"
        actions={<Link className="button button-primary" to="/agents/new">创建角色</Link>}
      />

      <div className="agent-toolbar">
        <form className="agent-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="agent-search">搜索本机角色</label>
          <input
            id="agent-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色名称、标识或描述"
          />
          {query ? <button type="button" className="button button-ghost" onClick={() => setQuery("")}>清空</button> : null}
        </form>
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>刷新</button>
      </div>

      <div className="agent-list-meta" aria-live="polite">
        <span>{loading ? "正在读取角色" : `${visibleAgents.length} 个角色`}</span>
        <span>角色与培训项目仅保存在本机</span>
      </div>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <CardSkeletons count={4} /> : null}

      {!loading && agents.length === 0 ? (
        <EmptyState
          title="还没有本机角色"
          description="创建角色，选择完成任务所需的 Skills，并编写它的工作指令。"
          action={<Link className="button button-primary" to="/agents/new">创建第一个角色</Link>}
        />
      ) : null}
      {!loading && agents.length > 0 && visibleAgents.length === 0 ? (
        <EmptyState
          title="没有匹配的角色"
          description="试试其他关键词，或清空搜索查看全部本机角色。"
          action={<button type="button" className="button button-secondary" onClick={() => setQuery("")}>清空搜索</button>}
        />
      ) : null}

      {!loading && visibleAgents.length > 0 ? (
        <div className="agent-grid">
          {visibleAgents.map((agent) => {
            const training = trainingByAgent.get(agent.id);
            const hasUpdate = training !== undefined && training.revision < agent.revision;
            return (
              <article className="agent-card" key={agent.id}>
                <Link className="agent-card-link" to={`/agents/${encodeURIComponent(agent.id)}`}>
                  <div className="agent-card-topline">
                    <code>{agent.id}</code>
                    <span className={`agent-status${training ? " agent-status-trained" : ""}`}>
                      {hasUpdate ? "培训待更新" : training ? "已培训" : "未培训"}
                    </span>
                  </div>
                  <h2>{agent.name}</h2>
                  <p className="agent-card-description">{agent.description}</p>
                  <div className="agent-card-meta">
                    <span>{agent.skillIds.length} 个 Skills</span>
                    <span>revision {agent.revision}</span>
                  </div>
                  <time dateTime={agent.updatedAt}>更新于 {formatDate(agent.updatedAt)}</time>
                </Link>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
