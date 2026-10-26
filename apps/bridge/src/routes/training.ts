import type { FastifyInstance } from "fastify";
import { agentIdSchema } from "@skillhub/shared";
import type { TrainingService } from "../training.js";

export function registerTrainingRoutes(app: FastifyInstance, trainings: TrainingService): void {
  app.get("/api/trainings", async () => trainings.list());

  app.get("/api/trainings/:agentId", async (request) => {
    const { agentId } = request.params as { agentId: string };
    const training = trainings.require(agentIdSchema.parse(agentId));
    return { training: await trainings.toPublic(training), codexError: null };
  });

  app.post("/api/agents/:agentId/train", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return trainings.train(agentIdSchema.parse(agentId));
  });
}
