import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalRequest, RunDetail, RunEvent, TestOutcome } from "@skillhub/shared";
import { api, initializeSession } from "../api";
import { Approvals } from "../components/Approvals";
import { Link } from "../components/Link";
import { Markdown } from "../components/Markdown";
import { RunFiles } from "../components/RunFiles";
import { Timeline } from "../components/Timeline";
import { Definition, EmptyState, ErrorBanner, LoadingState, Notice, OutcomeBadge, PageHeader, RunStatusBadge } from "../components/UI";
import { navigate } from "../router";
import { asRecord, errorMessage, formatBytes, formatDate, isActiveStatus, isRunEvent } from "../utils";

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

type ConnectionState = "connecting" | "connected" | "reconnecting";

export function RunDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [stopping, setStopping] = useState(false);
  const [outcomePending, setOutcomePending] = useState(false);
  const [outcomeNote, setOutcomeNote] = useState("");

  const refreshDetail = useCallback(async () => {
    try {
      const data = await api.run(id);
      setDetail(data);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [id]);

  const refreshApprovals = useCallback(async () => {
    try {
      const data = await api.approvals(id);
      setApprovals(data.approvals);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setDetail(null);
    try {
      const [runData, approvalData] = await Promise.all([api.run(id), api.approvals(id)]);
      setDetail(runData);
      setApprovals(approvalData.approvals);
      setOutcomeNote(runData.outcomeNote ?? "");
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    const seen = new Set<number>();
    setEvents([]);
    setConnection("connecting");

    const receive = (event: Event) => {
      const message = event as MessageEvent<string>;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!isRunEvent(parsed) || parsed.runId !== id || seen.has(parsed.seq)) return;
      seen.add(parsed.seq);
      setEvents((current) => [...current, parsed]);

      if (parsed.kind === "status" || parsed.kind === "meta" || parsed.kind === "outcome") {
        const payload = asRecord(parsed.payload);
        if (payload) {
          setDetail((current) => {
            if (current) return { ...current, ...payload } as RunDetail;
            return Array.isArray(payload.files) && Array.isArray(payload.inputFiles)
              ? parsed.payload as RunDetail
              : current;
          });
        }
      }
      if (parsed.kind === "files") void refreshDetail();
      if (parsed.kind === "approval" || parsed.kind === "approvalDecision") void refreshApprovals();
      if (parsed.kind === "notification" && parsed.method === "serverRequest/resolved") void refreshApprovals();
    };

    async function connect() {
      try {
        await initializeSession();
        if (disposed) return;
        source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`, { withCredentials: true });
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
    const poll = window.setInterval(() => {
      void refreshDetail();
      void refreshApprovals();
    }, 20000);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      source?.close();
    };
  }, [id, refreshApprovals, refreshDetail]);

  async function stop() {
    if (!detail || stopping || !window.confirm("确认停止当前测试？Codex 将收到中断请求，已产生的文件和记录会保留。")) return;
    setStopping(true);
    setActionError(null);
    setMessage(null);
    try {
      const data = await api.stopRun(id);
      setDetail(data);
      setMessage("停止请求已提交，运行状态将在 Codex 确认后更新");
      await refreshApprovals();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStopping(false);
    }
  }

  async function submitOutcome(outcome: TestOutcome) {
    if (!detail || detail.status !== "completed" || outcomePending) return;
    setOutcomePending(true);
    setActionError(null);
    setMessage(null);
    try {
      const data = await api.setOutcome(id, outcome, outcomeNote.trim());
      setDetail(data);
      setOutcomeNote(data.outcomeNote ?? "");
      setMessage(outcome === "passed" ? "已记录：测试结果达到预期" : "已记录：测试结果未达到预期");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setOutcomePending(false);
    }
  }

  const chatPath = detail?.kind === "chat" && detail.agent
    ? `/trainings/${encodeURIComponent(detail.agent.id)}`
    : null;

  useEffect(() => {
    if (chatPath) navigate(chatPath, true);
  }, [chatPath]);

  if (chatPath) return <LoadingState label="正在返回自由试用会话" />;
  if (detail?.kind === "chat") return <EmptyState title="无法定位聊天会话" description="这条聊天记录缺少有效的角色或会话信息。" />;
  if (loading && !detail) return <LoadingState label="正在读取运行详情" />;
  if (!detail) {
    return (
      <div>
        <Link className="back-link" to="/runs">返回测试记录</Link>
        {loadError ? <ErrorBanner message={loadError} onRetry={() => void load()} /> : null}
        {!loadError ? <EmptyState title="测试记录不存在" description="该记录可能已被移除，或链接不完整。" /> : null}
      </div>
    );
  }

  const feedbackQuery = new URLSearchParams({
    skillId: detail.skillId,
    skillCommit: detail.skillCommit,
    runId: detail.id,
  });
  if (detail.outcome) feedbackQuery.set("outcome", detail.outcome);

  return (
    <div className="run-detail-page">
      <Link className="back-link" to="/runs">返回测试记录</Link>
      <PageHeader
        eyebrow={`测试 ${detail.id}`}
        title={detail.agent?.name ?? detail.skillName}
        description={detail.task}
        actions={(
          <div className="button-row">
            <RunStatusBadge status={detail.status} />
            {detail.agent && !isActiveStatus(detail.status) ? <Button variant="outline" nativeButton={false} render={<Link to={`/agents/${encodeURIComponent(detail.agent.id)}/test`} />}>再次调试</Button> : null}
            {isActiveStatus(detail.status) ? <Button variant="destructive" type="button" onClick={() => void stop()} disabled={stopping}>{stopping ? "正在停止…" : "停止测试"}</Button> : null}
          </div>
        )}
      />

      {loadError ? <ErrorBanner message={loadError} onRetry={() => void load()} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {detail.error ? <Notice tone="warning"><strong>运行错误</strong><p>{detail.error}</p></Notice> : null}

      <Approvals runId={id} approvals={approvals} onChange={setApprovals} onRunUpdated={refreshDetail} />

      <Card className="content-panel" aria-labelledby="run-summary-title">
        <CardHeader>
          <div><span className="eyebrow">固定上下文</span><h2 id="run-summary-title">运行信息</h2></div>
          <OutcomeBadge outcome={detail.outcome} />
        </CardHeader>
        <CardContent>
        <dl className="definition-grid">
          <Definition label="任务" wide><p className="pre-wrap">{detail.task}</p></Definition>
          <Definition label="工作目录" wide><code className="break-all">{detail.workspace}</code></Definition>
          {detail.agent ? (
            <>
              <Definition label="角色"><span>{detail.agent.name}</span><code>{detail.agent.id}</code></Definition>
              <Definition label="角色 revision"><code>{detail.agent.revision}</code></Definition>
            </>
          ) : (
            <>
              <Definition label="Skill"><span>{detail.skillName}</span><code>{detail.skillId}</code></Definition>
              <Definition label="固定提交"><code className="break-all">{detail.skillCommit}</code></Definition>
            </>
          )}
          <Definition label="线程 ID"><code className="break-all">{detail.threadId ?? "尚未分配"}</code></Definition>
          <Definition label="轮次 ID"><code className="break-all">{detail.turnId ?? "尚未分配"}</code></Definition>
          <Definition label="创建时间">{formatDate(detail.createdAt)}</Definition>
          <Definition label="开始时间">{formatDate(detail.startedAt)}</Definition>
          <Definition label="完成时间">{formatDate(detail.completedAt)}</Definition>
        </dl>
        {detail.inputFiles.length > 0 ? (
          <div className="input-files">
            <h3>上传材料</h3>
            <ul className="plain-list">
              {detail.inputFiles.map((file) => <li key={`${file.path}-${file.name}`}><span>{file.name}</span><span>{formatBytes(file.size)}</span></li>)}
            </ul>
          </div>
        ) : null}
        </CardContent>
      </Card>

      {detail.finalText ? (
        <Card className="content-panel" aria-labelledby="final-answer-title">
          <CardHeader><div><span className="eyebrow">Codex 最终输出</span><h2 id="final-answer-title">最终回复</h2></div></CardHeader>
          <CardContent>
          <Markdown>{detail.finalText}</Markdown>
          </CardContent>
        </Card>
      ) : null}

      {detail.status === "completed" ? (
        <Card className="content-panel outcome-panel" aria-labelledby="outcome-title">
          <CardHeader>
            <div><span className="eyebrow">人工验收</span><h2 id="outcome-title">结果是否符合预期</h2></div>
            <OutcomeBadge outcome={detail.outcome} />
          </CardHeader>
          <CardContent>
          <p>请结合实际工作区文件和 Codex 回复判断。这个结论由你明确提交，不会自动推断。</p>
          <Field className="field">
            <FieldLabel htmlFor="outcome-note">验收备注</FieldLabel>
            <Textarea id="outcome-note" value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} rows={3} maxLength={2000} placeholder="记录验证依据、偏差或后续建议" disabled={outcomePending} />
          </Field>
          <div className="form-footer">
            <Button variant="outline" nativeButton={false} render={<Link to={`/feedback?${feedbackQuery.toString()}`} />}>反馈此结果</Button>
            <div className="button-row">
              <Button variant="outline" type="button" onClick={() => void submitOutcome("failed")} disabled={outcomePending}>未达到预期</Button>
              <Button variant="default" type="button" onClick={() => void submitOutcome("passed")} disabled={outcomePending}>{outcomePending ? "正在提交…" : "达到预期"}</Button>
            </div>
          </div>
          </CardContent>
        </Card>
      ) : null}

      <RunFiles runId={id} files={detail.files} />

      <div className="event-connection" role="status">
        <span className={`status-dot ${connection === "connected" ? "is-ok" : "is-pending"}`} aria-hidden="true" />
        事件流：{connection === "connected" ? "已连接" : connection === "connecting" ? "正在连接" : "连接中断，浏览器正在自动续传；同时保留慢速刷新"}
      </div>
      <Timeline events={events} />
    </div>
  );
}
