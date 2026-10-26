import {
  feedbackInputSchema,
  feedbackListResponseSchema,
  feedbackResponseSchema,
  commitSchema,
  skillIdSchema,
  type FeedbackListResponse,
  type FeedbackResponse,
} from "@skillhub/shared";
import { z } from "zod";
import type { CatalogDatabase, FeedbackQuery } from "./database.js";

const feedbackQuerySchema = z.object({
  skillId: skillIdSchema.optional(),
  skillCommit: commitSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export class FeedbackService {
  constructor(private readonly database: CatalogDatabase) {}

  create(body: unknown): FeedbackResponse {
    const input = feedbackInputSchema.parse(body);
    return feedbackResponseSchema.parse({
      feedback: this.database.insertFeedback(input),
    });
  }

  list(query: unknown): FeedbackListResponse {
    const parsed = feedbackQuerySchema.parse(query ?? {});
    const filters: FeedbackQuery = { limit: parsed.limit };
    if (parsed.skillId !== undefined) {
      filters.skillId = parsed.skillId;
    }
    if (parsed.skillCommit !== undefined) {
      filters.skillCommit = parsed.skillCommit;
    }
    return feedbackListResponseSchema.parse({
      feedback: this.database.listFeedback(filters),
    });
  }
}
