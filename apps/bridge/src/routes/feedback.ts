import { feedbackInputSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import { catalogClient } from "../catalog-client.js";

export function registerFeedbackRoutes(app: FastifyInstance): void {
  app.post("/api/feedback", async (request, reply) => {
    const input = feedbackInputSchema.parse(request.body);
    const result = await catalogClient.createFeedback(input);
    return reply.code(201).send(result);
  });

  app.get("/api/feedback", async (request) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
      if (typeof value === "string") query.set(key, value);
    }
    return catalogClient.listFeedback(query);
  });
}
