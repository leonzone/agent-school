import { z } from "zod";
import { agentIdSchema } from "./agents.js";
import { commitSchema, skillIdSchema } from "./catalog.js";

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "waitingApproval",
  "completed",
  "failed",
  "interrupted",
]);

export const testOutcomeSchema = z.enum(["passed", "failed"]);

export const runComposerOptionsSchema = z.object({
  skillIds: z.array(skillIdSchema).max(20),
  permissionMode: z.enum(["strict", "workspace", "full"]),
  model: z.string().trim().min(1).max(200),
  effort: z.string().trim().min(1).max(50),
});

export const uploadedFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  mime: z.string().nullable().default(null),
});

export const runFileSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  path: z.string(),
  kind: z.enum(["added", "modified", "deleted"]),
  size: z.number().int().nonnegative().nullable(),
  sha256: z.string().length(64).nullable(),
  mime: z.string().nullable(),
  artifactAvailable: z.boolean(),
  previewAvailable: z.boolean(),
  truncated: z.boolean(),
});

export const runAgentContextSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  revision: z.number().int().positive(),
});

export const runSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["automated", "chat"]).default("automated"),
  conversationId: z.string().uuid().nullable().default(null),
  options: runComposerOptionsSchema.nullable().default(null),
  agent: runAgentContextSchema.nullable().default(null),
  skillId: skillIdSchema,
  skillName: z.string(),
  skillCommit: commitSchema,
  workspace: z.string(),
  task: z.string(),
  status: runStatusSchema,
  outcome: testOutcomeSchema.nullable(),
  outcomeNote: z.string().nullable(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  finalText: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const runDetailSchema = runSummarySchema.extend({
  inputFiles: z.array(uploadedFileSchema),
  files: z.array(runFileSchema),
});

export const runEventSchema = z.object({
  seq: z.number().int().positive(),
  runId: z.string().uuid(),
  kind: z.string(),
  method: z.string().nullable(),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});

export const runListResponseSchema = z.object({
  runs: z.array(runSummarySchema),
});

export const createRunFieldsSchema = z.object({
  skillId: skillIdSchema.optional(),
  agentId: agentIdSchema.optional(),
  workspace: z.string().trim().max(4096).default(""),
  task: z.string().trim().min(1).max(20000),
}).superRefine((input, context) => {
  if ((input.skillId === undefined) === (input.agentId === undefined)) {
    context.addIssue({ code: "custom", message: "测试必须且只能指定一个 Skill 或 Agent" });
  }
  if (input.skillId !== undefined && input.workspace.length === 0) {
    context.addIssue({ code: "custom", path: ["workspace"], message: "Skill 测试需要工作目录" });
  }
});

export const runOutcomeInputSchema = z.object({
  outcome: testOutcomeSchema,
  note: z.string().trim().max(2000).default(""),
});

export const approvalDecisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

export const approvalRequestSchema = z.object({
  id: z.union([z.string(), z.number().int()]),
  runId: z.string().uuid(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const pendingApprovalsResponseSchema = z.object({
  approvals: z.array(approvalRequestSchema),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type TestOutcome = z.infer<typeof testOutcomeSchema>;
export type RunComposerOptions = z.infer<typeof runComposerOptionsSchema>;
export type UploadedFile = z.infer<typeof uploadedFileSchema>;
export type RunFile = z.infer<typeof runFileSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunListResponse = z.infer<typeof runListResponseSchema>;
export type CreateRunFields = z.infer<typeof createRunFieldsSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
