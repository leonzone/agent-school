import { useEffect, useMemo, useState } from "react";
import type { RunEvent } from "@skillhub/shared";
import { CheckIcon, CircleIcon, FileIcon, LoaderCircleIcon, TerminalIcon, WrenchIcon, XIcon } from "lucide-react";
import { buildTimeline, type TimelineEntry } from "../../chat/timeline";
import { initializeSession } from "../../api";
import { asRecord, errorMessage, formatJson, isRunEvent } from "../../utils";
import { Markdown } from "../Markdown";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "../ui/trace";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "../ui/code-block";
import { Button } from "../ui/button";

export const eventKinds = ["status", "meta", "outcome", "notification", "approval", "approvalDecision", "files", "phase", "warning", "codexStderr"];

export function OutputBlock({ text, title, failed = false }: { text: string; title: string; failed?: boolean }) {
  return <CodeBlock size="sm" variant={failed ? "destructive" : "default"}>
    <CodeBlockHeader><CodeBlockTitle>{title}</CodeBlockTitle><CodeBlockActions><CodeBlockCopyButton value={text} aria-label={`复制${title}`} /></CodeBlockActions></CodeBlockHeader>
    <CodeBlockContent wrap className="max-h-64">{text}</CodeBlockContent>
  </CodeBlock>;
}

function ActivityLine({ item, running }: { item: TimelineEntry; running: boolean }) {
  const [expanded, setExpanded] = useState<boolean | undefined>();
  const state = item.state === "running" && !running ? "interrupted" : item.state;
  const status = state === "running" ? "running" : state === "error" ? "error" : state === "pending" ? "pending" : undefined;
  const Icon = state === "running" ? LoaderCircleIcon : state === "error" ? XIcon : item.kind === "command" ? TerminalIcon : item.kind === "file" ? FileIcon : state === "success" ? CheckIcon : WrenchIcon;
  const labels = { running: "执行中", success: "已完成", error: "失败", pending: "待执行", interrupted: "已停止", info: "" };
  const body = item.text || item.command || item.output || item.diff || item.showPayload;
  const line = <TraceLine {...(status ? { status } : {})}>
    <TraceIcon><Icon className={state === "running" ? "animate-spin" : undefined} /></TraceIcon>
    <TraceTitle>{item.command || item.title}</TraceTitle>
    <TraceDescription>{labels[state] || item.status}</TraceDescription>
  </TraceLine>;
  if (!body) return line;
  return <TraceCollapsible open={expanded ?? (state === "running" && item.output.length > 0 && item.output.length < 2000 && item.output.split("\n").length <= 12)} onOpenChange={setExpanded}>
    <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
    <TraceCollapsibleContent className="flex flex-col gap-2">
      {item.meta.length > 0 ? <p className="activity-meta">{item.meta.join(" · ")}</p> : null}
      {item.text ? <p className="activity-text">{item.text}</p> : null}
      {item.command ? <OutputBlock title="Shell 命令" text={item.command} /> : null}
      {item.output ? <OutputBlock title="执行输出" text={item.output} failed={state === "error"} /> : null}
      {item.diff ? <OutputBlock title="文件差异" text={item.diff} /> : null}
      {item.showPayload ? <OutputBlock title="事件详情" text={formatJson(item.payload)} /> : null}
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

export function AgentActivity({ events, running = false, includeMessages = true }: { events: RunEvent[]; running?: boolean; includeMessages?: boolean }) {
  const entries = useMemo(() => buildTimeline(events).filter((entry) => !["meta", "thread/tokenUsage/updated"].includes(entry.meta[0] ?? "") && entry.title !== "运行标识已更新"), [events]);
  const groups: Array<{ key: string; message?: TimelineEntry; steps?: TimelineEntry[] }> = [];
  for (const item of entries) {
    if (item.kind === "message") {
      if (includeMessages) groups.push({ key: item.key, message: item });
    } else {
      const last = groups.at(-1);
      if (last?.steps) last.steps.push(item);
      else groups.push({ key: item.key, steps: [item] });
    }
  }
  return <div className="agent-activity" aria-label="Agent 执行过程">
    {groups.map((group) => group.message
      ? <Markdown key={group.key}>{group.message.text}</Markdown>
      : <Trace key={group.key}>{group.steps?.map((item) => <ActivityLine key={item.key} item={item} running={running} />)}</Trace>)}
    {entries.length === 0 && running ? <Trace><TraceLine status="running"><TraceIcon><CircleIcon /></TraceIcon><TraceTitle>等待 Agent 返回执行事件</TraceTitle></TraceLine></Trace> : null}
  </div>;
}

export function RunHistory({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let source: EventSource | null = null;
    const seen = new Set<number>();
    setEvents([]);
    setError(null);
    void initializeSession().then(() => {
      if (disposed) return;
      source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
      const receive = (event: Event) => {
        try {
          const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (!isRunEvent(parsed) || parsed.runId !== runId || seen.has(parsed.seq)) return;
          seen.add(parsed.seq);
          setEvents((current) => [...current, parsed]);
          if (parsed.kind === "status" && ["completed", "failed", "interrupted"].includes(String(asRecord(parsed.payload)?.status))) source?.close();
        } catch { setError("运行事件格式无效，请重试。"); source?.close(); }
      };
      for (const kind of eventKinds) source.addEventListener(kind, receive);
      source.onerror = () => { setError("历史过程读取中断，请重试。"); source?.close(); };
    }).catch((reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; source?.close(); };
  }, [open, runId, attempt]);
  return <Trace><TraceCollapsible open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger><TraceLine><TraceIcon><WrenchIcon /></TraceIcon><TraceTitle>查看执行过程</TraceTitle></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      {error ? <p role="alert">{error}<Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button></p> : null}
      <AgentActivity events={events} includeMessages={false} />
    </TraceCollapsibleContent>
  </TraceCollapsible></Trace>;
}
