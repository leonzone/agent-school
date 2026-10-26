import { skillIdSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import { catalogClient } from "../catalog-client.js";

export function registerCatalogRoutes(app: FastifyInstance): void {
  app.get("/api/catalog/skills", async (request) => {
    const query = (request.query as { q?: string }).q ?? "";
    return catalogClient.list(query);
  });

  app.post("/api/catalog/sync", async () => catalogClient.sync());

  app.get("/api/catalog/skills/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { commit } = request.query as { commit?: string };
    return catalogClient.detail(skillIdSchema.parse(id), commit);
  });

  app.get("/api/catalog/skills/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    return catalogClient.versions(skillIdSchema.parse(id));
  });
}
