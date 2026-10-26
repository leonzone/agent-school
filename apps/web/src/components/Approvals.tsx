import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@skillhub/shared";
import { api } from "../api";
import { errorMessage, formatDate, formatJson } from "../utils";
import { ErrorBanner } from "./UI";

import { Button } from "./ui/button";
import { Item, ItemContent, ItemActions } from "./ui/item";

const decisionLabels: Record<ApprovalDecision, string> = {
  accept: "批准",
  acceptForSession: "本次会话批准",
  decline: "拒绝",
  cancel: "取消",
};

function approvalTitle(method: string): string {
  if (method.includes("commandExecution")) return "命令执行审批";
  if (method.includes("fileChange")) return "文件修改审批";
  if (method.includes("permissions")) return "权限申请审批";
  return "Codex 操作审批";
}

const friendlyFields: Array<[string, string]> = [
  ["command", "准备执行的命令"],
  ["cwd", "工作目录"],
  ["reason", "申请原因"],
  ["grantRoot", "申请授权目录"],
  ["network", "网络访问"],
  ["networkApprovalContext", "网络访问"],
  ["permissions", "申请权限"],
];

function FriendlyValue({ name, value }: { name: string; value: unknown }) {
  if (name === "command") return <pre className="command-block">{typeof value === "string" ? value : formatJson(value)}</pre>;
  if (name === "cwd" || name === "grantRoot") return <code className="break-all">{typeof value === "string" ? value : formatJson(value)}</code>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;
  return <Collapsible className="collapsible-output" defaultOpen><CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>查看{name === "permissions" ? "权限" : "网络"}详情</CollapsibleTrigger><CollapsibleContent><pre>{formatJson(value)}</pre></CollapsibleContent></Collapsible>;
}

export function Approvals({ runId, approvals, onChange, onRunUpdated }: {
  runId: string;
  approvals: ApprovalRequest[];
  onChange: (approvals: ApprovalRequest[]) => void;
  onRunUpdated: () => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(approval: ApprovalRequest, decision: ApprovalDecision) {
    const key = `${typeof approval.id}:${String(approval.id)}`;
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      const result = await api.resolveApproval(runId, approval.id, decision);
      onChange(result.approvals);
      await onRunUpdated();
    } catch (resolveError) {
      setError(errorMessage(resolveError));
    } finally {
      setPending(null);
    }
  }

  if (approvals.length === 0) return null;
  const decisionOptions: ApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];

  return (
    <section className="approval-area" aria-labelledby="approvals-title">
      <div className="section-heading">
        <div><span className="eyebrow">必须人工决定</span><h2 id="approvals-title">待处理审批</h2></div>
        <Badge variant="secondary">{approvals.length} 项待处理</Badge>
      </div>
      <p>请核对命令、目录和权限影响。系统不会自动批准任何请求。</p>
      {error ? <ErrorBanner message={error} /> : null}
      {approvals.map((approval) => {
        const key = `${typeof approval.id}:${String(approval.id)}`;
        const available = approval.params.availableDecisions;
        const decisions = Array.isArray(available)
          ? decisionOptions.filter((decision) => available.includes(decision))
          : decisionOptions;
        const friendly = friendlyFields.filter(([name]) => {
          const value = approval.params[name];
          return value !== undefined && value !== null && value !== "";
        });
        return (
          <Item variant="outline" key={key}><ItemContent>
            <div className="approval-card-heading">
              <div><span className="eyebrow">{approval.method}</span><h3>{approvalTitle(approval.method)}</h3></div>
              <time dateTime={approval.createdAt}>{formatDate(approval.createdAt)}</time>
            </div>
            {friendly.length > 0 ? (
              <dl className="approval-fields">
                {friendly.map(([name, label]) => (
                  <div key={name}><dt>{label}</dt><dd><FriendlyValue name={name ?? ""} value={approval.params[name ?? ""]} /></dd></div>
                ))}
              </dl>
            ) : <p>此请求没有可提取的友好字段，请查看完整参数后再决定。</p>}
            <Collapsible className="approval-json">
              <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>查看完整请求参数</CollapsibleTrigger><CollapsibleContent>
              <pre>{formatJson(approval.params)}</pre>
            </CollapsibleContent></Collapsible>
            <ItemActions className="flex-wrap">
              {decisions.length === 0 ? <p>Codex 未提供可提交的决定，请停止当前测试。</p> : null}
              {decisions.map((decision) => (
                <Button
                  type="button"
                  key={decision}
                  variant={decision === "accept" ? "default" : decision === "decline" ? "destructive" : "outline"}
                  onClick={() => void resolve(approval, decision)}
                  disabled={pending !== null}
                >
                  {pending === key ? "正在提交…" : decisionLabels[decision]}
                </Button>
              ))}
            </ItemActions>
          </ItemContent></Item>
        );
      })}
    </section>
  );
}
