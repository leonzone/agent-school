import { z } from "zod";
import { agentIdSchema } from "./agents.js";
import { runSummarySchema } from "./runs.js";

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  agentId: agentIdSchema,
  agentName: z.string(),
  revision: z.number().int().positive(),
  projectPath: z.string(),
  title: z.string(),
  threadId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastMessageAt: z.string().datetime().nullable(),
  runCount: z.number().int().nonnegative(),
});

export const conversationDetailSchema = z.object({
  conversation: conversationSummarySchema,
  runs: z.array(runSummarySchema),
});

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

export const conversationResponseSchema = z.object({
  conversation: conversationSummarySchema,
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;
