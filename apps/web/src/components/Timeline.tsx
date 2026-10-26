import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import type { RunEvent } from "@skillhub/shared";
import { Markdown } from "./Markdown";
import { formatDate, formatJson } from "../utils";
import { buildTimeline } from "../chat/timeline";

export function Timeline({ events }: { events: RunEvent[] }) {
  const entries = useMemo(() => buildTimeline(events), [events]);
  return (
    <Card className="content-panel timeline-panel" aria-labelledby="timeline-title">
      <CardHeader>
        <div><span className="eyebrow">实时过程</span><h2 id="timeline-title">运行时间线</h2></div>
        <span className="muted">{events.length} 个事件</span>
      </CardHeader>
      <CardContent>
      {entries.length === 0 ? <p className="muted timeline-empty">等待 Codex 产生运行事件。</p> : (
        <ol className="timeline">
          {entries.map((item) => (
            <li className={`timeline-item timeline-${item.kind}`} key={item.key} data-seq={item.seq}>
              <span className="timeline-marker" aria-hidden="true" />
              <div className="timeline-content">
                <div className="timeline-heading">
                  <strong>{item.title}</strong>
                  <div>
                    {item.streaming ? <Badge variant="secondary">正在生成</Badge> : null}
                    {item.status ? <Badge variant="secondary">{item.status}</Badge> : null}
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </div>
                </div>
                {item.meta.length > 0 ? <div className="timeline-meta">{item.meta.map((text) => <span key={text}>{text}</span>)}</div> : null}
                {item.command ? <pre className="command-block">{item.command}</pre> : null}
                {item.text ? (
                  item.kind === "message" ? <Markdown className="timeline-markdown">{item.text}</Markdown> : <p className="pre-wrap">{item.text}</p>
                ) : null}
                {item.output ? (
                  <Collapsible className="collapsible-output">
                    <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>查看命令输出（{item.output.length} 字）</CollapsibleTrigger><CollapsibleContent>
                    <pre>{item.output}</pre>
                  </CollapsibleContent></Collapsible>
                ) : null}
                {item.diff ? (
                  <Collapsible className="collapsible-output">
                    <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>查看差异（{item.diff.length} 字）</CollapsibleTrigger><CollapsibleContent>
                    <pre>{item.diff}</pre>
                  </CollapsibleContent></Collapsible>
                ) : null}
                {item.showPayload ? (
                  <Collapsible className="collapsible-output">
                    <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>查看结构化详情</CollapsibleTrigger><CollapsibleContent>
                    <pre>{formatJson(item.payload)}</pre>
                  </CollapsibleContent></Collapsible>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      </CardContent>
    </Card>
  );
}
