import { z } from "zod";
import { commitSchema, skillIdSchema } from "./catalog.js";
import { testOutcomeSchema } from "./runs.js";

export const feedbackKindSchema = z.enum(["issue", "suggestion", "praise"]);

export const feedbackInputSchema = z.object({
  skillId: skillIdSchema,
  skillCommit: commitSchema,
  runId: z.string().uuid().nullable().default(null),
  kind: feedbackKindSchema,
  author: z.string().trim().max(80).default(""),
  content: z.string().trim().min(1).max(5000),
  outcome: testOutcomeSchema.nullable().default(null),
});

export const feedbackRecordSchema = feedbackInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export const feedbackListResponseSchema = z.object({
  feedback: z.array(feedbackRecordSchema),
});

export const feedbackResponseSchema = z.object({
  feedback: feedbackRecordSchema,
});

export type FeedbackKind = z.infer<typeof feedbackKindSchema>;
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
export type FeedbackListResponse = z.infer<typeof feedbackListResponseSchema>;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
