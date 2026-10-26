import type { RunEvent, RunStatus } from "@skillhub/shared";
import { asRecord, formatJson, numberValue, outcomeLabel, runStatusLabels, stringValue } from "../utils";

export type TimelineEntry = {
  key: string;
  seq: number;
  createdAt: string;
  kind: "message" | "command" | "file" | "diff" | "phase" | "status" | "approval" | "warning" | "notice";
  title: string;
  text: string;
  command: string;
  output: string;
  diff: string;
  meta: string[];
  status: string | null;
  streaming: boolean;
  payload: unknown;
  showPayload: boolean;
  state: "running" | "success" | "error" | "pending" | "interrupted" | "info";
};

function entry(event: RunEvent, key: string, kind: TimelineEntry["kind"], title: string): TimelineEntry {
  return {
    key,
    seq: event.seq,
    createdAt: event.createdAt,
    kind,
    title,
    text: "",
    command: "",
    output: "",
    diff: "",
    meta: [],
    status: null,
    streaming: false,
    payload: event.payload,
    showPayload: false,
    state: "info",
  };
}

function statusText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(runStatusLabels, value)) {
    return runStatusLabels[value as RunStatus];
  }
  const codexStatuses: Record<string, string> = {
    inProgress: "进行中",
    notStarted: "未开始",
    idle: "空闲",
    active: "活动中",
    unknown: "未知",
  };
  return codexStatuses[value] ?? value;
}

function decisionText(value: unknown): string {
  if (value === "accept") return "已批准一次";
  if (value === "acceptForSession") return "已本次会话批准";
  if (value === "decline") return "已拒绝";
  if (value === "cancel") return "已取消";
  return "已处理";
}

function itemTitle(type: string): string {
  if (type === "agentMessage") return "Codex 回复";
  if (type === "commandExecution") return "命令执行";
  if (type === "fileChange") return "文件修改";
  if (type === "plan") return "执行计划";
  if (type === "reasoning") return "推理摘要";
  if (type === "userMessage") return "用户任务";
  if (type === "mcpToolCall" || type === "dynamicToolCall") return "工具调用";
  if (type === "webSearch") return "网络搜索";
  return `工作项目：${type}`;
}

function notificationTitle(method: string): string {
  if (method === "thread/started") return "Codex 会话已建立";
  if (method === "thread/status/changed") return "Codex 会话状态更新";
  if (method === "thread/tokenUsage/updated") return "令牌用量更新";
  if (method === "account/updated") return "Codex 账号状态更新";
  if (method === "account/rateLimits/updated") return "Codex 额度状态更新";
  if (method === "mcpServer/startupStatus/updated") return "工具服务启动状态更新";
  if (method === "hook/started") return "钩子开始执行";
  if (method === "hook/completed") return "钩子执行完成";
  if (method === "warning") return "Codex 警告";
  if (method === "remoteControl/status/changed") return "远程控制状态更新";
  if (method === "serverRequest/resolved") return "审批请求已关闭";
  return "Codex 通知";
}

function updateItem(entries: Map<string, TimelineEntry>, event: RunEvent) {
  const payload = asRecord(event.payload);
  if (event.method === "item/agentMessage/delta" || event.method === "item/commandExecution/outputDelta") {
    const isMessage = event.method === "item/agentMessage/delta";
    const itemId = stringValue(payload?.itemId) ?? `event-${event.seq}`;
    const key = `item:${itemId}`;
    const kind = isMessage ? "message" : "command";
    const current = entries.get(key) ?? entry(event, key, kind, itemTitle(isMessage ? "agentMessage" : "commandExecution"));
    current.createdAt = event.createdAt;
    current.streaming = true;
    current.state = "running";
    if (isMessage) current.text += stringValue(payload?.delta) ?? "";
    else current.output += stringValue(payload?.delta) ?? "";
    entries.set(key, current);
    return;
  }

  const item = asRecord(payload?.item);
  if (!item) return;
  const type = stringValue(item.type) ?? "unknown";
  const itemId = stringValue(item.id) ?? `event-${event.seq}`;
  const key = `item:${itemId}`;
  const kind: TimelineEntry["kind"] = type === "agentMessage"
    ? "message"
    : type === "commandExecution"
      ? "command"
      : type === "fileChange"
        ? "file"
        : "notice";
  const current = entries.get(key) ?? entry(event, key, kind, itemTitle(type));
  current.kind = kind;
  current.title = itemTitle(type);
  current.createdAt = event.createdAt;
  current.showPayload = false;
  const completed = event.method === "item/completed";
  current.streaming = !completed;
  current.state = completed ? "success" : "running";
  current.payload = event.payload;
  current.status = completed ? "已完成" : "进行中";
  if (type === "agentMessage") {
    const text = stringValue(item.text);
    if (completed) current.text = text ?? current.text;
    else if (text !== null && current.text.length === 0) current.text = text;
  } else if (type === "commandExecution") {
    current.command = stringValue(item.command) ?? current.command;
    const cwd = stringValue(item.cwd);
    const exitCode = numberValue(item.exitCode);
    const duration = numberValue(item.durationMs);
    current.meta = [
      cwd ? `目录：${cwd}` : "",
      exitCode !== null ? `退出码：${exitCode}` : "",
      duration !== null ? `耗时：${(duration / 1000).toFixed(1)} 秒` : "",
    ].filter(Boolean);
    const output = stringValue(item.aggregatedOutput);
    if (completed) current.output = output ?? current.output;
    else if (output !== null) current.output = output;
    const commandStatus = stringValue(item.status);
    if (commandStatus) current.status = commandStatus === "completed" ? "已完成" : commandStatus === "failed" ? "失败" : commandStatus;
    if (commandStatus === "failed" || commandStatus === "declined" || (exitCode !== null && exitCode !== 0)) current.state = "error";
  } else if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const descriptions: string[] = [];
    const diffs: string[] = [];
    for (const change of changes) {
      const record = asRecord(change);
      const path = stringValue(record?.path) ?? "未知路径";
      const changeKind = stringValue(record?.kind) ?? "修改";
      descriptions.push(`${path}（${changeKind}）`);
      const diff = stringValue(record?.diff);
      if (diff) diffs.push(diff);
    }
    current.text = descriptions.join("\n");
    current.diff = diffs.join("\n\n");
    current.status = stringValue(item.status) ?? current.status;
    if (item.status === "failed" || item.status === "declined") current.state = "error";
  } else {
    current.text = stringValue(item.text) ?? "";
    if (type === "reasoning") {
      const summary = Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === "string") : [];
      current.text = summary.join("\n");
    }
    if (type === "mcpToolCall" || type === "dynamicToolCall") {
      current.title = `${stringValue(item.server) ?? ""} ${stringValue(item.tool) ?? "工具调用"}`.trim();
      if (item.status === "failed" || item.success === false || item.error) current.state = "error";
      current.output = JSON.stringify(item.result ?? item.contentItems ?? item.error ?? {}, null, 2);
      current.text = JSON.stringify(item.arguments ?? {}, null, 2);
    }
    // Only the backend's summary is displayable; never expose raw reasoning.
    current.showPayload = type !== "reasoning" && current.text.length === 0;
  }
  entries.set(key, current);
}

export function buildTimeline(events: RunEvent[]): TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>();
  const seen = new Set<number>();
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    const method = event.method ?? "";
    if (method === "item/reasoning/textDelta" || method === "item/reasoning/rawContentDelta") continue;
    if (method === "item/reasoning/summaryTextDelta" || method === "item/plan/delta") {
      const payload = asRecord(event.payload);
      const key = `item:${stringValue(payload?.itemId) ?? event.seq}`;
      const current = entries.get(key) ?? entry(event, key, "notice", method.includes("reasoning") ? "思考摘要" : "执行计划");
      current.text += stringValue(payload?.delta) ?? "";
      current.streaming = true;
      current.state = "running";
      entries.set(key, current);
      continue;
    }
    if (method === "turn/plan/updated") {
      const payload = asRecord(event.payload);
      const key = `plan:${stringValue(payload?.turnId) ?? "current"}`;
      const current = entries.get(key) ?? entry(event, key, "notice", "执行计划");
      const plan = Array.isArray(payload?.plan) ? payload.plan : [];
      current.text = plan.map((step) => {
        const row = asRecord(step);
        const label = row?.status === "completed" ? "已完成" : row?.status === "inProgress" ? "进行中" : "待执行";
        return `${label}：${stringValue(row?.step) ?? ""}`;
      }).join("\n");
      current.state = plan.some((step) => asRecord(step)?.status !== "completed") ? "running" : "success";
      current.streaming = current.state === "running";
      entries.set(key, current);
      continue;
    }
    if (event.kind === "notification" && (
      method.startsWith("item/") && (
        method === "item/agentMessage/delta"
        || method === "item/commandExecution/outputDelta"
        || method === "item/started"
        || method === "item/completed"
      )
    )) {
      updateItem(entries, event);
      continue;
    }
    if (event.kind === "notification" && method === "turn/diff/updated") {
      const payload = asRecord(event.payload);
      const turnId = stringValue(payload?.turnId) ?? "current";
      const key = `turn-diff:${turnId}`;
      const current = entries.get(key) ?? entry(event, key, "diff", "工作区差异");
      current.diff = stringValue(payload?.diff) ?? "";
      current.createdAt = event.createdAt;
      current.status = "已更新";
      entries.set(key, current);
      continue;
    }

    let current: TimelineEntry;
    if (event.kind === "phase") {
      const payload = asRecord(event.payload);
      const phase = stringValue(payload?.phase);
      const title = phase === "workspaceSnapshot"
        ? "记录工作区初始状态"
        : phase === "collectArtifacts"
          ? "收集结果文件"
          : "运行阶段更新";
      current = entry(event, `event:${event.seq}`, "phase", title);
      current.text = phase && !["workspaceSnapshot", "collectArtifacts"].includes(phase) ? phase : "";
    } else if (event.kind === "status") {
      const payload = asRecord(event.payload);
      current = entry(event, `event:${event.seq}`, "status", "运行状态更新");
      current.status = statusText(payload?.status);
      current.text = stringValue(payload?.error) ?? "";
      current.state = payload?.status === "failed" ? "error" : payload?.status === "completed" ? "success" : payload?.status === "interrupted" ? "interrupted" : "info";
      if (["failed", "completed", "interrupted"].includes(String(payload?.status))) {
        for (const pending of entries.values()) {
          if (!pending.streaming) continue;
          pending.streaming = false;
          pending.state = payload?.status === "failed" ? "error" : "interrupted";
          pending.status = payload?.status === "failed" ? "失败" : "未收到完成事件";
        }
      }
    } else if (event.kind === "outcome") {
      const payload = asRecord(event.payload);
      current = entry(event, `event:${event.seq}`, "status", "人工验收已记录");
      const outcome = payload?.outcome === "passed" || payload?.outcome === "failed" ? payload.outcome : null;
      current.status = outcomeLabel(outcome);
      current.text = stringValue(payload?.outcomeNote) ?? "";
    } else if (event.kind === "meta") {
      const payload = asRecord(event.payload);
      current = entry(event, `event:${event.seq}`, "phase", "运行标识已更新");
      current.meta = [
        stringValue(payload?.threadId) ? `线程：${stringValue(payload?.threadId)}` : "",
        stringValue(payload?.turnId) ? `轮次：${stringValue(payload?.turnId)}` : "",
      ].filter(Boolean);
    } else if (event.kind === "approval") {
      current = entry(event, `event:${event.seq}`, "approval", "需要人工审批");
      current.text = event.method ?? "Codex 请求操作许可";
      current.showPayload = true;
    } else if (event.kind === "approvalDecision") {
      const payload = asRecord(event.payload);
      current = entry(event, `event:${event.seq}`, "approval", "审批已处理");
      current.status = decisionText(payload?.decision);
      current.text = event.method ?? "";
    } else if (event.kind === "files") {
      const payload = asRecord(event.payload);
      const count = Array.isArray(payload?.files) ? payload.files.length : 0;
      current = entry(event, `event:${event.seq}`, "file", "结果文件已更新");
      current.text = `已记录 ${count} 个结果文件，可在下方查看、预览或下载。`;
    } else if (event.kind === "warning" || event.kind === "codexStderr") {
      const payload = asRecord(event.payload);
      current = entry(event, `event:${event.seq}`, "warning", event.kind === "warning" ? "运行警告" : "Codex 错误输出");
      current.text = stringValue(payload?.message) ?? formatJson(event.payload);
    } else if (event.kind === "notification" && (method === "turn/started" || method === "turn/completed")) {
      const payload = asRecord(event.payload);
      const turn = asRecord(payload?.turn);
      current = entry(event, `event:${event.seq}`, "phase", method === "turn/started" ? "Codex 轮次已开始" : "Codex 轮次已结束");
      current.status = statusText(turn?.status) ?? (method === "turn/started" ? "进行中" : null);
      current.text = stringValue(asRecord(turn?.error)?.message) ?? "";
    } else {
      current = entry(
        event,
        `event:${event.seq}`,
        "notice",
        event.kind === "notification" ? notificationTitle(method) : `事件：${event.kind}`,
      );
      if (event.method) current.meta = [event.method];
      current.showPayload = true;
    }
    entries.set(current.key, current);
  }
  return [...entries.values()].sort((left, right) => left.seq - right.seq);
}

