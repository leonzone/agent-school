import { installInputSchema, skillIdSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import type { InstallationService } from "../installations.js";

export function registerInstallationRoutes(
  app: FastifyInstance,
  installations: InstallationService,
): void {
  app.get("/api/installations", async () => installations.list());

  app.post("/api/installations", async (request, reply) => {
    const input = installInputSchema.parse(request.body);
    const result = await installations.install(input);
    return reply.code(201).send(result);
  });

  app.delete("/api/installations/:id", async (request) => {
    const { id } = request.params as { id: string };
    await installations.uninstall(skillIdSchema.parse(id));
    return { ok: true };
  });
}
