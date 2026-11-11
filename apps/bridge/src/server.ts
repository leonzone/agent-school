import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { AgentService } from "./agents.js";
import { RunManager } from "./codex/run-manager.js";
import { CodexSettingsService } from "./codex/settings.js";
import { config } from "./config.js";
import { ConversationService } from "./conversations.js";
import { openDatabase } from "./database.js";
import { errorBody, HttpError } from "./errors.js";
import { InstallationService } from "./installations.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerCodexRoutes } from "./routes/codex.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerInstallationRoutes } from "./routes/installations.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerSkillHubRoutes } from "./routes/skillhub.js";
import { SkillHubRepository } from "./skillhub/catalog.js";
import { SkillInstaller } from "./skillhub/installations.js";
import { registerTrainingRoutes } from "./routes/training.js";
import { RunStore } from "./runs.js";
import { TrainingService } from "./training.js";

const app = Fastify({
  logger: true,
  bodyLimit: 64 * 1024,
});
const sessionToken = randomBytes(32).toString("hex");
const db = openDatabase(config.databasePath);
const installations = new InstallationService(db);
const agents = new AgentService(db);
const training = new TrainingService(db, agents);
const runStore = new RunStore(db);
const conversations = new ConversationService(db, training, runStore);
const runManager = new RunManager(runStore, installations, training, conversations);

await app.register(cookie);
await app.register(multipart, {
  limits: { files: 10, fileSize: 10 * 1024 * 1024, fields: 10 },
});

app.addHook("onRequest", async (request, reply) => {
  const host = request.headers.host ?? "";
  const fetchSite = request.headers["sec-fetch-site"];
  const origin = request.headers.origin;
  if (!config.allowedHosts.has(host) || fetchSite === "cross-site") {
    throw new HttpError(403, "LOCAL_REQUEST_REJECTED", "仅接受 Agent School 本机页面请求");
  }
  if (origin && !config.allowedOrigins.has(origin)) {
    throw new HttpError(403, "ORIGIN_REJECTED", "请求来源不受信任");
  }

  if (request.url.startsWith("/api") && request.url !== "/api/session") {
    if (request.cookies.skillhub_session !== sessionToken) {
      return reply.code(401).send({
        error: { code: "SESSION_REQUIRED", message: "请重新建立本地会话" },
      });
    }
  }
});

app.setErrorHandler(async (error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: {
        code: "INVALID_INPUT",
        message: error.issues[0]?.message ?? "输入无效",
        details: error.issues,
      },
    });
  }
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send(errorBody(error));
  }
  const candidate = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
  if (statusCode >= 500) request.log.error(error);
  return reply.code(statusCode).send({
    error: {
      code: typeof candidate.code === "string" ? candidate.code : "INTERNAL_ERROR",
      message: statusCode >= 500 || typeof candidate.message !== "string"
        ? "本地服务发生未预期错误"
        : candidate.message,
    },
  });
});

app.post("/api/session", async (_request, reply) => {
  return reply
    .setCookie("skillhub_session", sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: 12 * 60 * 60,
    })
    .send({ ok: true });
});

registerAgentRoutes(app, agents);
registerTrainingRoutes(app, training);
registerCatalogRoutes(app);
registerCodexRoutes(app, new CodexSettingsService(() => runManager.activeRunId));
registerFeedbackRoutes(app);
registerInstallationRoutes(app, installations);
registerConversationRoutes(app, conversations, runManager, runStore);
registerRunRoutes(app, runManager, runStore, training);
registerSystemRoutes(app, () => runManager.activeRunId);
registerSkillHubRoutes(app, new SkillHubRepository(config.skillHubRoot), new SkillInstaller(config.skillsRoot, installations));

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    index: ["index.html"],
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "请求的资源不存在" },
    });
  });
}

app.addHook("onClose", async () => {
  await runManager.close();
  db.close();
});

if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
  throw new Error("本机演示模式只允许 Bridge 监听 loopback 地址");
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`Agent School Bridge: http://${config.host}:${config.port}`);
app.log.info(`Agent School 数据目录: ${path.resolve(config.home)}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
