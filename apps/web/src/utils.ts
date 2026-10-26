import type { RunStatus, TestOutcome } from "@skillhub/shared";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作未完成，请稍后重试";
}

export function agentAvatar(agent: { name: string; avatar?: string }): string {
  return agent.avatar?.trim() || "🤖";
}

export function formatDate(value: string | null): string {
  if (!value) return "尚未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatBytes(value: number | null): string {
  if (value === null) return "无文件内容";
  if (value < 1024) return `${value} 字节`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const runStatusLabels: Record<RunStatus, string> = {
  queued: "等待执行",
  running: "正在运行",
  waitingApproval: "等待审批",
  completed: "已完成",
  failed: "运行失败",
  interrupted: "已中断",
};

export function outcomeLabel(outcome: TestOutcome | null): string {
  if (outcome === "passed") return "达到预期";
  if (outcome === "failed") return "未达到预期";
  return "尚未确认";
}

export function isActiveStatus(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "waitingApproval";
}

export function isRunEvent(value: unknown): value is import("@skillhub/shared").RunEvent {
  const event = asRecord(value);
  return event !== null
    && typeof event.seq === "number"
    && Number.isInteger(event.seq)
    && event.seq > 0
    && typeof event.runId === "string"
    && typeof event.kind === "string"
    && (typeof event.method === "string" || event.method === null)
    && typeof event.createdAt === "string";
}

export function readRecentWorkspace(): string {
  try {
    return window.localStorage.getItem("skillhub.recentWorkspace") ?? "";
  } catch {
    return "";
  }
}

export function rememberWorkspace(workspace: string): void {
  try {
    window.localStorage.setItem("skillhub.recentWorkspace", workspace);
  } catch {
  }
}
