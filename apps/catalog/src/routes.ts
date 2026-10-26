import { commitSchema, skillIdSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, SkillValidationError } from "./errors.js";
import type { FeedbackService } from "./feedback.js";
import type { SkillIndex } from "./skill-index.js";

const skillParamsSchema = z.object({
  id: skillIdSchema,
});

const archiveParamsSchema = skillParamsSchema.extend({
  commit: commitSchema,
});

interface CatalogServices {
  skills: SkillIndex;
  feedback: FeedbackService;
}

export function registerRoutes(app: FastifyInstance, services: CatalogServices): void {
  const { skills, feedback } = services;

  app.get("/api/health", async () => ({
    status: "ok" as const,
    ...skills.getSyncStatus(),
  }));

  app.post("/api/sync", async (request) => {
    try {
      return await skills.sync();
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      request.log.error({ err: error }, "Catalog synchronization failed");
      if (error instanceof SkillValidationError) {
        throw new HttpError(503, "SYNC_FAILED", `课程同步失败: ${error.message}`);
      }
      throw new HttpError(
        503,
        "SYNC_FAILED",
        "课程仓库同步失败，请检查课程 remote 与默认分支",
      );
    }
  });

  app.get("/api/skills", async (request) => skills.getCatalog(request.query));

  app.get("/api/skills/:id", async (request) => {
    const { id } = skillParamsSchema.parse(request.params);
    return skills.getDetail(id, request.query);
  });

  app.get("/api/skills/:id/versions", async (request) => {
    const { id } = skillParamsSchema.parse(request.params);
    return skills.getVersions(id);
  });

  app.get("/api/skills/:id/versions/:commit/archive", async (request, reply) => {
    const { id, commit } = archiveParamsSchema.parse(request.params);
    const archive = await skills.getArchive(id, commit);
    reply
      .type("application/x-tar")
      .header("content-length", String(archive.content.length))
      .header("x-content-sha256", archive.sha256)
      .header("x-skill-commit", commit);
    return reply.send(archive.content);
  });

  app.post("/api/feedback", async (request, reply) => {
    const response = feedback.create(request.body);
    reply.code(201);
    return response;
  });

  app.get("/api/feedback", async (request) => feedback.list(request.query));
}
