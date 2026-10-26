import { rm } from "node:fs/promises";
import { z } from "zod";
import { runComposerOptionsSchema } from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import type { RunManager } from "../codex/run-manager.js";
import type { ConversationService } from "../conversations.js";
import { HttpError } from "../errors.js";
import type { RunStore } from "../runs.js";
import { receiveRunUpload } from "../run-upload.js";
import { runPaths } from "../workspace-files.js";

const conversationIdSchema = z.string().uuid();
const messageFieldsSchema = z.object({
  task: z.string().trim().min(1).max(20000),
  skillIds: z.string().max(10000).optional(),
  permissionMode: z.enum(["strict", "workspace", "full"]).default("workspace"),
  model: z.string().trim().min(1).max(200),
  effort: z.string().trim().min(1).max(50),
  confirmFullAccess: z.string().optional(),
});

function parseSkillIds(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  try {
    return runComposerOptionsSchema.shape.skillIds.parse(JSON.parse(raw));
  } catch {
    throw new HttpError(400, "INVALID_SKILL_IDS", "skillIds 必须是有效的 Skill ID JSON 数组");
  }
}

export function registerConversationRoutes(
  app: FastifyInstance,
  conversations: ConversationService,
  manager: RunManager,
  store: RunStore,
): void {
  app.post("/api/agents/:agentId/conversation", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return conversations.ensureDetail(agentId);
  });

  app.post("/api/agents/:agentId/conversations", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const conversation = conversations.create(agentId);
    return reply.code(201).send({ conversation });
  });

  app.get("/api/agents/:agentId/conversations", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return { conversations: conversations.list(agentId) };
  });

  app.get("/api/conversations/:id", async (request) => {
    const { id } = request.params as { id: string };
    return conversations.detail(conversationIdSchema.parse(id));
  });

  app.post("/api/conversations/:id/messages", async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const conversationId = conversationIdSchema.parse(rawId);
    const conversation = conversations.require(conversationId);
    const runId = crypto.randomUUID();
    try {
      const { fields, inputFiles } = await receiveRunUpload(request, runId, "materials");
      const parsed = messageFieldsSchema.parse(fields);
      const skillIds = parseSkillIds(parsed.skillIds);
      const run = await manager.start({
        id: runId,
        conversationId,
        workspace: conversation.projectPath,
        task: parsed.task,
        inputFiles,
        composerOptions: {
          ...(skillIds !== undefined ? { skillIds } : {}),
          permissionMode: parsed.permissionMode,
          model: parsed.model,
          effort: parsed.effort,
        },
        confirmFullAccess: parsed.confirmFullAccess === "true",
      });
      return reply.code(201).send(run);
    } catch (error) {
      if (!store.find(runId)) await rm(runPaths(runId).root, { recursive: true, force: true });
      throw error;
    }
  });
}
