import type { FastifyInstance } from "fastify";
import {
  agentCreateInputSchema,
  agentDuplicateInputSchema,
  agentIdSchema,
  agentProfileInputSchema,
  agentUpdateInputSchema,
} from "@skillhub/shared";
import type { AgentService } from "../agents.js";

export function registerAgentRoutes(app: FastifyInstance, agents: AgentService): void {
  app.get("/api/agents", async () => agents.list());

  app.post("/api/agents", async (request, reply) => {
    const result = await agents.create(agentCreateInputSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.get("/api/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { agent: agents.require(agentIdSchema.parse(id)) };
  });

  app.put("/api/agents/:id/profile", async (request) => {
    const { id } = request.params as { id: string };
    return agents.updateProfile(
      agentIdSchema.parse(id),
      agentProfileInputSchema.parse(request.body),
    );
  });

  app.put("/api/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    return agents.update(agentIdSchema.parse(id), agentUpdateInputSchema.parse(request.body));
  });

  app.delete("/api/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    agents.delete(agentIdSchema.parse(id));
    return { ok: true };
  });

  app.post("/api/agents/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await agents.duplicate(agentIdSchema.parse(id), agentDuplicateInputSchema.parse(request.body));
    return reply.code(201).send(result);
  });
}
