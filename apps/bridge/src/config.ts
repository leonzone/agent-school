import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function portFromEnv(value: string | undefined, fallback: number): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效端口: ${value ?? fallback}`);
  }
  return port;
}

const port = portFromEnv(process.env.SKILLHUB_BRIDGE_PORT, 43111);
const host = process.env.SKILLHUB_BRIDGE_HOST ?? "127.0.0.1";
const home = path.resolve(
  process.env.SKILLHUB_HOME ?? path.join(os.homedir(), ".skillhub"),
);

export const config = {
  projectRoot,
  host,
  port,
  home,
  databasePath: path.join(home, "bridge.db"),
  downloadsDir: path.join(home, "downloads"),
  runsDir: path.join(home, "runs"),
  skillsRoot: path.resolve(
    process.env.SKILLHUB_SKILLS_ROOT ?? path.join(os.homedir(), ".agents", "skills"),
  ),
  agentsRoot: path.resolve(
    process.env.SKILLHUB_AGENTS_ROOT ?? path.join(os.homedir(), "AgentSchool"),
  ),
  catalogUrl: (process.env.SKILLHUB_CATALOG_URL ?? "http://127.0.0.1:43110").replace(/\/$/, ""),
  codexPath: process.env.SKILLHUB_CODEX_PATH ?? "codex",
  verifiedCodexVersion: "0.163.0",
  webDist: path.join(projectRoot, "apps", "web", "dist"),
  maintenanceClonePath: path.join(projectRoot, "var", "demo", "course"),
  allowedOrigins: new Set([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]),
  allowedHosts: new Set([
    `${host}:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "127.0.0.1:5173",
    "localhost:5173",
  ]),
};
