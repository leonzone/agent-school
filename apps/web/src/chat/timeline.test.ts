import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent } from "@skillhub/shared";
import { buildTimeline } from "./timeline";
const event = (seq: number, method: string | null, payload: unknown, kind = "notification"): RunEvent => ({ seq, method, payload, kind, runId: "test-run", createdAt: "2026-10-26T00:00:00Z" });
test("reconnect replay is deduplicated and missing completion text preserves deltas", () => {
  const delta = event(2, "item/agentMessage/delta", { itemId: "a", delta: "你好" });
  const result = buildTimeline([event(3, "item/completed", { item: { id: "a", type: "agentMessage" } }), delta, delta]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.text, "你好");
  assert.equal(result[0]?.state, "success");
});
test("nonzero command exit and tool failures cannot appear successful", () => {
  const result = buildTimeline([
    event(1, "item/completed", { item: { id: "c", type: "commandExecution", status: "completed", command: "test", exitCode: 1 } }),
    event(2, "item/completed", { item: { id: "t", type: "mcpToolCall", status: "failed", error: "denied" } }),
    event(3, "item/completed", { item: { id: "denied", type: "commandExecution", status: "declined" } }),
  ]);
  assert.ok(result.every((entry) => entry.state === "error"));
});
test("stop settles running entries without inventing success", () => {
  const result = buildTimeline([event(1, "item/started", { item: { id: "c", type: "commandExecution" } }), event(2, null, { status: "interrupted" }, "status")]);
  assert.equal(result[0]?.state, "interrupted");
  assert.equal(result[0]?.streaming, false);
});
test("only explicit reasoning summaries are displayed", () => {
  const result = buildTimeline([
    event(1, "item/reasoning/textDelta", { itemId: "r", delta: "private" }),
    event(2, "item/started", { item: { id: "r", type: "reasoning", content: ["private"] } }),
    event(3, "item/reasoning/summaryTextDelta", { itemId: "r", delta: "正在检查项目" }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.text, "正在检查项目");
  assert.equal(result[0]?.showPayload, false);
});
