import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { useCallback, useEffect, useState } from "react";
import type { RunSummary } from "@skillhub/shared";
import { api } from "../api";
import { Link } from "../components/Link";
import { EmptyState, ErrorBanner, LoadingState, OutcomeBadge, PageHeader, RunStatusBadge } from "../components/UI";
import { errorMessage, formatDate, isActiveStatus, shortCommit } from "../utils";

export function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasActive = runs.some((run) => isActiveStatus(run.status));

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await api.runs();
      setRuns(data.runs.filter((run) => !("kind" in run) || run.kind !== "chat"));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

  return (
    <div>
      <PageHeader
        eyebrow="验证与结果"
        title="测试记录"
        description="查看每次角色或 Skill 测试的固定版本、运行状态、最终结果和人工验收结论。"
        actions={(
          <div className="button-row">
            <Button variant="outline" type="button" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? "正在刷新…" : "刷新记录"}</Button>
            <Button variant="default" nativeButton={false} render={<Link to="/trainings" />}>新建测试</Button>
          </div>
        )}
      />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <LoadingState label="正在读取测试记录" /> : null}
      {!loading && runs.length === 0 ? (
        <EmptyState
          title="还没有测试记录"
          description="从已培训角色发起一次测试，运行过程和结果会保存在这里。"
          action={<Button variant="default" nativeButton={false} render={<Link to="/trainings" />}>选择培训角色</Button>}
        />
      ) : null}

      <div className="run-list">
        {runs.map((run) => (
          <Card key={run.id}>
            <CardHeader>
              <div className="card-topline">
                <CardTitle><Link to={`/runs/${encodeURIComponent(run.id)}`}>{run.agent?.name ?? run.skillName}</Link></CardTitle>
                <RunStatusBadge status={run.status} />
                <OutcomeBadge outcome={run.outcome} />
              </div>
              <CardDescription>{run.task}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="run-card-meta">
                <span>{run.agent ? `角色 revision ${run.agent.revision}` : <>提交 <code>{shortCommit(run.skillCommit)}</code></>}</span>
                <span>创建：{formatDate(run.createdAt)}</span>
                {run.completedAt ? <span>结束：{formatDate(run.completedAt)}</span> : null}
              </div>
              {run.finalText ? <p className="run-result"><strong>最终回复：</strong>{run.finalText}</p> : null}
              {run.error ? <p className="run-error"><strong>错误：</strong>{run.error}</p> : null}
            </CardContent>
            <CardFooter className="justify-end">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/runs/${encodeURIComponent(run.id)}`} />}>查看详情</Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
