import { codexConfigUpdateSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import type { CodexSettingsService } from "../codex/settings.js";

export function registerCodexRoutes(app: FastifyInstance, settings: CodexSettingsService): void {
  app.get("/api/codex/config", async () => settings.read());
  app.put("/api/codex/config", async (request) => (
    settings.update(codexConfigUpdateSchema.parse(request.body))
  ));
}
