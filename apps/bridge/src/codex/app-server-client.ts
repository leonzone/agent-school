import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type {
  ClientRequest,
  RequestId,
  ServerNotification,
  ServerRequest,
} from "@skillhub/codex-protocol";
import { resolveCodexExecutable } from "./executable.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type AppServerHandlers = {
  onNotification?: (notification: ServerNotification) => void;
  onServerRequest?: (request: ServerRequest) => Promise<unknown>;
  onExit?: (error: Error | null) => void;
  onStderr?: (message: string) => void;
};

export class CodexRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function idKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

export class AppServerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly process: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private closing = false;
  private exited = false;
  private stderr = "";
  private readonly exitedPromise: Promise<void>;

  private constructor(
    private readonly handlers: AppServerHandlers,
    codexPath: string,
  ) {
    this.process = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.exitedPromise = new Promise((resolve) => {
      this.process.once("exit", () => resolve());
      this.process.once("error", () => resolve());
    });
    const stopOnParentExit = () => {
      if (this.process.exitCode === null && this.process.signalCode === null) {
        this.process.kill("SIGTERM");
      }
    };
    process.once("exit", stopOnParentExit);

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-65_536);
      this.handlers.onStderr?.(chunk.toString("utf8"));
    });
    this.process.once("error", (error) => {
      process.removeListener("exit", stopOnParentExit);
      this.failPending(new Error(`无法启动 Codex app-server: ${error.message}`));
    });
    this.process.once("exit", (code, signal) => {
      process.removeListener("exit", stopOnParentExit);
      this.exited = true;
      const error = this.closing
        ? null
        : new Error(`Codex app-server 意外退出 (${signal ?? code ?? "unknown"})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`);
      this.failPending(error ?? new Error("Codex app-server 已关闭"));
      this.handlers.onExit?.(error);
    });
  }

  static async start(handlers: AppServerHandlers = {}, codexPath?: string): Promise<AppServerClient> {
    const executablePath = codexPath ?? (await resolveCodexExecutable()).path;
    const client = new AppServerClient(handlers, executablePath);
    try {
      await client.call("initialize", {
        clientInfo: {
          name: "skillhub",
          title: "Agent School",
          version: "0.1.0",
        },
        capabilities: null,
      }, 15_000);
      client.notifyInitialized();
      return client;
    } catch (error) {
      await client.stop();
      throw error;
    }
  }

  call<T>(method: ClientRequest["method"], params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closing || this.exited || this.process.exitCode !== null) {
      return Promise.reject(new Error("Codex app-server 未运行"));
    }
    const id = this.nextId++;
    const key = idKey(id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Codex 请求超时: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.send({ method, id, params } as ClientRequest);
    });
  }

  respond(id: RequestId, result: unknown): void {
    this.send({ id, result: result ?? {} });
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.send({ id, error: { code, message } });
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    this.closing = true;
    this.failPending(new Error("Codex app-server 已关闭"));
    this.process.stdin.end();
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill("SIGTERM");
    }
    const forced = setTimeout(() => {
      if (!this.exited && this.process.exitCode === null && this.process.signalCode === null) {
        this.process.kill("SIGKILL");
      }
    }, 2_000);
    forced.unref();
    await this.exitedPromise;
    clearTimeout(forced);
  }

  private notifyInitialized(): void {
    this.send({ method: "initialized" });
  }

  private send(message: object): void {
    if (this.exited || this.process.stdin.destroyed) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.handlers.onStderr?.(`无法解析的 app-server 输出: ${line.slice(0, 500)}\n`);
      return;
    }
    if (!isRecord(message)) return;

    if (typeof message.method === "string" && (typeof message.id === "string" || typeof message.id === "number")) {
      void this.handleServerRequest(message as unknown as ServerRequest);
      return;
    }
    if (typeof message.id === "string" || typeof message.id === "number") {
      this.handleResponse(message);
      return;
    }
    if (typeof message.method === "string") {
      this.handlers.onNotification?.(message as unknown as ServerNotification);
    }
  }

  private handleResponse(message: Record<string, unknown>): void {
    const id = message.id as RequestId;
    const pending = this.pending.get(idKey(id));
    if (!pending) return;
    this.pending.delete(idKey(id));
    clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      pending.reject(new CodexRpcError(
        typeof message.error.message === "string" ? message.error.message : "Codex 请求失败",
        typeof message.error.code === "number" ? message.error.code : -32603,
        message.error.data,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleServerRequest(request: ServerRequest): Promise<void> {
    if (!this.handlers.onServerRequest) {
      this.respondError(request.id, -32601, `Agent School 不支持该请求: ${request.method}`);
      return;
    }
    try {
      const result = await this.handlers.onServerRequest(request);
      this.respond(request.id, result);
    } catch (error) {
      this.respondError(
        request.id,
        -32000,
        error instanceof Error ? error.message : "Agent School 无法处理该请求",
      );
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
