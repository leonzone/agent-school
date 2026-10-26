import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { SystemStatus } from "@skillhub/shared";
import { catalogClient } from "../catalog-client.js";
import { getCodexStatus } from "../codex/service.js";
import { config } from "../config.js";

export function registerSystemRoutes(
  app: FastifyInstance,
  getActiveRunId: () => string | null,
): void {
  app.get("/api/system/status", async (): Promise<SystemStatus> => {
    const [codex, catalog] = await Promise.all([
      getCodexStatus(),
      catalogClient.health().then(
        () => ({ available: true, error: null }),
        (error: unknown) => ({
          available: false,
          error: error instanceof Error ? error.message : "课程服务不可用",
        }),
      ),
    ]);
    return {
      codex,
      catalog,
      activeRunId: getActiveRunId(),
      maintenanceClonePath: existsSync(config.maintenanceClonePath)
        ? config.maintenanceClonePath
        : null,
    };
  });
}
