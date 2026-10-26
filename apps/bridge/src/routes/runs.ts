import { rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  approvalDecisionSchema,
  createRunFieldsSchema,
  runOutcomeInputSchema,
  type RunEvent,
} from "@skillhub/shared";
import type { FastifyInstance } from "fastify";
import type { RunManager } from "../codex/run-manager.js";
import { HttpError } from "../errors.js";
import type { RunStore } from "../runs.js";
import { receiveRunUpload } from "../run-upload.js";
import type { TrainingService } from "../training.js";
import {
  readArtifactPreview,
  resolveArtifactPath,
  runPaths,
  validateWorkspace,
} from "../workspace-files.js";

const runIdSchema = z.string().uuid();
const approvalInputSchema = z.object({
  requestId: z.union([z.string(), z.number().int()]),
  decision: approvalDecisionSchema,
});

function requireRun(store: RunStore, id: string) {
  const run = store.find(id);
  if (!run) throw new HttpError(404, "RUN_NOT_FOUND", "测试记录不存在");
  return run;
}

export function registerRunRoutes(
  app: FastifyInstance,
  manager: RunManager,
  store: RunStore,
  training: TrainingService,
): void {
  app.get("/api/runs", async () => ({ runs: manager.list() }));

  app.get("/api/runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    return requireRun(store, runIdSchema.parse(id));
  });

  app.post("/api/runs", async (request, reply) => {
    const runId = crypto.randomUUID();
    try {
      const { fields, inputFiles } = await receiveRunUpload(request, runId);
      const parsed = createRunFieldsSchema.parse(fields);
      const workspace = parsed.agentId !== undefined
        ? training.require(parsed.agentId).projectPath
        : await validateWorkspace(parsed.workspace);
      const run = await manager.start({
        id: runId,
        ...(parsed.skillId !== undefined ? { skillId: parsed.skillId } : {}),
        ...(parsed.agentId !== undefined ? { agentId: parsed.agentId } : {}),
        workspace,
        task: parsed.task,
        inputFiles,
      });
      return reply.code(201).send(run);
    } catch (error) {
      if (!store.find(runId)) await rm(runPaths(runId).root, { recursive: true, force: true });
      throw error;
    }
  });

  app.post("/api/runs/:id/stop", async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = runIdSchema.parse(rawId);
    requireRun(store, id);
    await manager.stop(id);
    return requireRun(store, id);
  });

  app.get("/api/runs/:id/approvals", async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = runIdSchema.parse(rawId);
    requireRun(store, id);
    return { approvals: manager.pendingApprovals(id) };
  });

  app.post("/api/runs/:id/approvals", async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = runIdSchema.parse(rawId);
    const input = approvalInputSchema.parse(request.body);
    manager.resolveApproval(id, input.requestId, input.decision);
    return { approvals: manager.pendingApprovals(id) };
  });

  app.post("/api/runs/:id/outcome", async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = runIdSchema.parse(rawId);
    const run = requireRun(store, id);
    if (run.kind === "chat") {
      throw new HttpError(409, "CHAT_OUTCOME_NOT_SUPPORTED", "自由聊天不支持结果验收");
    }
    if (run.status !== "completed") {
      throw new HttpError(409, "RUN_NOT_COMPLETED", "请在 Codex 完成测试后再确认是否达到预期");
    }
    const input = runOutcomeInputSchema.parse(request.body);
    store.setOutcome(id, input.outcome, input.note);
    return requireRun(store, id);
  });

  app.get("/api/runs/:id/events", async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const id = runIdSchema.parse(rawId);
    requireRun(store, id);
    const query = request.query as { after?: string };
    const rawAfter = request.headers["last-event-id"] ?? query.after ?? "0";
    const after = Number(Array.isArray(rawAfter) ? rawAfter[0] : rawAfter);
    if (!Number.isInteger(after) || after < 0) {
      throw new HttpError(400, "INVALID_EVENT_CURSOR", "事件序号无效");
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    let lastSeq = after;
    let replaying = true;
    const buffered: RunEvent[] = [];
    const send = (event: RunEvent) => {
      if (event.seq <= lastSeq || reply.raw.destroyed) return;
      lastSeq = event.seq;
      reply.raw.write(`id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = store.subscribe(id, (event) => {
      if (replaying) buffered.push(event);
      else send(event);
    });
    let cursor = after;
    while (true) {
      const events = store.eventsAfter(id, cursor, 500);
      for (const event of events) send(event);
      if (events.length < 500) break;
      cursor = events.at(-1)?.seq ?? cursor;
    }
    replaying = false;
    for (const event of buffered.sort((left, right) => left.seq - right.seq)) send(event);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(`: ${Date.now()}\n\n`);
    }, 15_000);
    heartbeat.unref();
    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/api/runs/:runId/files/:fileId/preview", async (request) => {
    const params = request.params as { runId: string; fileId: string };
    const runId = runIdSchema.parse(params.runId);
    const fileId = runIdSchema.parse(params.fileId);
    const file = store.getFile(runId, fileId);
    if (!file) throw new HttpError(404, "FILE_NOT_FOUND", "结果文件不存在");
    if (!file.artifactPath || !file.previewAvailable) {
      throw new HttpError(400, "PREVIEW_NOT_AVAILABLE", "该文件不支持在线预览，请下载后查看");
    }
    const preview = await readArtifactPreview(runId, file.artifactPath);
    return { path: file.path, mime: file.mime, ...preview };
  });

  app.get("/api/runs/:runId/files/:fileId/download", async (request, reply) => {
    const params = request.params as { runId: string; fileId: string };
    const runId = runIdSchema.parse(params.runId);
    const fileId = runIdSchema.parse(params.fileId);
    const file = store.getFile(runId, fileId);
    if (!file?.artifactPath) {
      throw new HttpError(404, "ARTIFACT_NOT_AVAILABLE", "该文件没有可下载的保存副本");
    }
    const artifactPath = await resolveArtifactPath(runId, file.artifactPath);
    const fileStat = await stat(artifactPath);
    const filename = path.basename(file.path);
    return reply
      .type(file.mime ?? "application/octet-stream")
      .header("content-length", fileStat.size)
      .header(
        "content-disposition",
        `attachment; filename="artifact"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .send(createReadStream(artifactPath));
  });
}
