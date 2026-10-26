import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { isLoopbackHostname, loadConfig, type CatalogConfig } from "./config.js";
import { CatalogDatabase } from "./database.js";
import { HttpError, SkillValidationError } from "./errors.js";
import { FeedbackService } from "./feedback.js";
import { GitCommandError, GitRepository } from "./git-repository.js";
import { registerRoutes } from "./routes.js";
import { SkillIndex } from "./skill-index.js";

function isLoopbackHostHeader(host: string): boolean {
  if (host.length === 0 || /[\s\\/?#]/.test(host)) {
    return false;
  }

  try {
    const url = new URL(`http://${host}`);
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return false;
    }
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function enforceLocalRequest(request: {
  headers: Record<string, string | string[] | undefined>;
}): void {
  const host = request.headers.host;
  if (typeof host !== "string" || !isLoopbackHostHeader(host)) {
    throw new HttpError(403, "INVALID_HOST", "仅允许使用 loopback Host 访问 Catalog");
  }

  const secFetchSite = request.headers["sec-fetch-site"];
  const values = Array.isArray(secFetchSite) ? secFetchSite : [secFetchSite];
  if (values.some((value) => value?.trim().toLowerCase() === "cross-site")) {
    throw new HttpError(403, "CROSS_SITE_REQUEST", "拒绝跨站浏览器请求");
  }
}

function statusCodeFor(error: unknown): number {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
  return typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : 500;
}

export function createServer(config: CatalogConfig = loadConfig()): FastifyInstance {
  if (!isLoopbackHostname(config.host)) {
    throw new Error("Catalog 只能监听 loopback 地址");
  }
  const app = Fastify({
    logger: true,
    bodyLimit: 64 * 1024,
  });
  const database = new CatalogDatabase(config.dataDir);
  const repository = new GitRepository(config.dataDir, config.courseUrl, config.courseRef);
  const skills = new SkillIndex(repository);
  const feedback = new FeedbackService(database);

  app.addHook("onRequest", async (request) => {
    enforceLocalRequest(request);
  });

  app.addHook("onReady", async () => {
    try {
      await skills.sync();
    } catch (error) {
      app.log.warn({ err: error }, "Initial Catalog synchronization failed");
    }
  });

  registerRoutes(app, { skills, feedback });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "接口不存在",
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      request.log.error({ err: error }, "Error after response was sent");
      return;
    }

    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "请求参数或 JSON body 校验失败" },
      });
      return;
    }
    if (error instanceof SkillValidationError) {
      reply.code(400).send({
        error: { code: "INVALID_SKILL", message: error.message },
      });
      return;
    }
    if (error instanceof GitCommandError) {
      request.log.error({ err: error }, "Git operation failed");
      reply.code(503).send({
        error: { code: "CATALOG_UNAVAILABLE", message: "课程仓库暂时不可用" },
      });
      return;
    }

    const statusCode = statusCodeFor(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled Catalog error");
    } else {
      request.log.warn({ err: error }, "Catalog request rejected");
    }

    const responses: Record<number, { code: string; message: string }> = {
      400: { code: "BAD_REQUEST", message: "请求格式无效" },
      401: { code: "UNAUTHORIZED", message: "请求未获授权" },
      403: { code: "FORBIDDEN", message: "请求被拒绝" },
      404: { code: "NOT_FOUND", message: "资源不存在" },
      405: { code: "METHOD_NOT_ALLOWED", message: "请求方法不受支持" },
      413: { code: "PAYLOAD_TOO_LARGE", message: "JSON body 不能超过 64KB" },
      415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "请求必须使用 application/json" },
    };
    const response = responses[statusCode] ?? {
      code: "INTERNAL_ERROR",
      message: "Catalog 服务内部错误",
    };
    reply.code(statusCode).send({ error: response });
  });

  app.addHook("onClose", async () => {
    database.close();
  });

  return app;
}

export async function startServer(config: CatalogConfig = loadConfig()): Promise<FastifyInstance> {
  const app = createServer(config);
  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) {
      return;
    }
    closing = true;
    app.log.info({ signal }, "Shutting down Catalog");
    void app.close().catch((error: unknown) => {
      app.log.error({ err: error }, "Catalog shutdown failed");
      process.exitCode = 1;
    });
  };
  const onSigint = (): void => shutdown("SIGINT");
  const onSigterm = (): void => shutdown("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await app.close();
    throw error;
  }

  return app;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  void startServer().catch((error: unknown) => {
    console.error("Catalog 启动失败", error);
    process.exitCode = 1;
  });
}
