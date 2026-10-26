import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export interface CatalogConfig {
  host: string;
  port: number;
  courseUrl: string;
  courseRef: string;
  dataDir: string;
}

export function isLoopbackHostname(hostname: string): boolean {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized === "localhost") {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return normalized.startsWith("127.");
  }
  return ipVersion === 6 && normalized === "::1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CatalogConfig {
  const host = env.SKILLHUB_CATALOG_HOST ?? "127.0.0.1";
  if (!isLoopbackHostname(host)) {
    throw new Error("SKILLHUB_CATALOG_HOST 必须是 loopback 地址");
  }

  const rawPort = env.SKILLHUB_CATALOG_PORT ?? "43110";
  if (!/^\d{1,5}$/.test(rawPort)) {
    throw new Error("SKILLHUB_CATALOG_PORT 必须是 1 到 65535 的整数");
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SKILLHUB_CATALOG_PORT 必须是 1 到 65535 的整数");
  }

  const courseUrl = env.SKILLHUB_COURSE_URL ?? join(projectRoot, "var", "demo", "remote.git");
  const courseRef = env.SKILLHUB_COURSE_REF ?? "main";
  if (courseUrl.length === 0 || courseUrl.includes("\0")) {
    throw new Error("SKILLHUB_COURSE_URL 不能为空");
  }
  if (courseRef.length === 0 || courseRef.includes("\0")) {
    throw new Error("SKILLHUB_COURSE_REF 不能为空");
  }

  return {
    host,
    port,
    courseUrl,
    courseRef,
    dataDir: resolve(env.SKILLHUB_CATALOG_DATA_DIR ?? join(projectRoot, "var", "catalog")),
  };
}
