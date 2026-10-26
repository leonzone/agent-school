import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import type { NewRunFile } from "./runs.js";

type Fingerprint = {
  size: number;
  sha256: string;
};

export type WorkspaceSnapshot = Map<string, Fingerprint>;

const IGNORED_DIRECTORIES = new Set([".git", ".agents", "node_modules", ".skillhub"]);
const MAX_ARTIFACT_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_SIZE = 100 * 1024 * 1024;
const MAX_PREVIEW_SIZE = 2 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".sql": "application/sql; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function fingerprint(filePath: string): Promise<Fingerprint | null> {
  try {
    const fileStat = await stat(filePath);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk as Buffer);
    }
    return { size: fileStat.size, sha256: hash.digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function validateWorkspace(workspace: string): Promise<string> {
  if (!path.isAbsolute(workspace)) {
    throw new HttpError(400, "WORKSPACE_NOT_ABSOLUTE", "工作目录必须是绝对路径");
  }
  let resolved: string;
  try {
    resolved = await realpath(workspace);
  } catch {
    throw new HttpError(400, "WORKSPACE_NOT_FOUND", "工作目录不存在或无法访问");
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new HttpError(400, "WORKSPACE_NOT_DIRECTORY", "工作路径不是目录");
  }
  if (resolved === path.parse(resolved).root) {
    throw new HttpError(400, "WORKSPACE_TOO_BROAD", "不能把文件系统根目录作为测试工作区");
  }
  return resolved;
}

export function runPaths(runId: string): { root: string; inputs: string; artifacts: string } {
  const root = path.join(config.runsDir, runId);
  return {
    root,
    inputs: path.join(root, "inputs"),
    artifacts: path.join(root, "artifacts"),
  };
}

export async function createRunDirectories(runId: string): Promise<ReturnType<typeof runPaths>> {
  const paths = runPaths(runId);
  await mkdir(paths.inputs, { recursive: true });
  await mkdir(paths.artifacts, { recursive: true });
  return paths;
}

export function sanitizeUploadName(filename: string, index: number): string {
  const basename = path.basename(filename.replace(/\\/g, "/"));
  const cleaned = basename.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._-]/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  const safe = cleaned || "material";
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  return index === 0 ? safe : `${stem}-${index}${extension}`;
}

export async function captureWorkspaceSnapshot(workspace: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileFingerprint = await fingerprint(absolute);
      if (fileFingerprint) snapshot.set(path.relative(workspace, absolute), fileFingerprint);
    }
  }
  await visit(workspace);
  return snapshot;
}

export async function collectRunArtifacts(options: {
  runId: string;
  workspace: string;
  before: WorkspaceSnapshot;
}): Promise<NewRunFile[]> {
  const after = await captureWorkspaceSnapshot(options.workspace);
  const paths = new Set([...options.before.keys(), ...after.keys()]);
  const artifactsRoot = runPaths(options.runId).artifacts;
  const workspaceReal = await realpath(options.workspace);
  const results: NewRunFile[] = [];
  let totalCopied = 0;

  for (const relativePath of [...paths].sort()) {
    const before = options.before.get(relativePath);
    const current = after.get(relativePath);
    const kind = !before ? "added" : !current ? "deleted" : null;
    if (before && current && before.sha256 === current.sha256 && before.size === current.size) {
      continue;
    }
    if (!current) {
      results.push({
        path: relativePath,
        kind: kind ?? "deleted",
        size: null,
        sha256: null,
        mime: null,
        artifactPath: null,
        previewAvailable: false,
        truncated: false,
      });
      continue;
    }

    const mime = MIME_TYPES[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream";
    const result: NewRunFile = {
      path: relativePath,
      kind: kind ?? "modified",
      size: current.size,
      sha256: current.sha256,
      mime,
      artifactPath: null,
      previewAvailable: false,
      truncated: false,
    };
    const canCopy = current.size <= MAX_ARTIFACT_SIZE && totalCopied + current.size <= MAX_TOTAL_ARTIFACT_SIZE;
    if (!canCopy) {
      result.truncated = true;
      results.push(result);
      continue;
    }

    const source = path.join(options.workspace, relativePath);
    const sourceReal = await realpath(source);
    if (!isInside(workspaceReal, sourceReal) || !(await lstat(sourceReal)).isFile()) {
      throw new Error(`结果文件路径越出工作区或不是普通文件: ${relativePath}`);
    }
    const destination = path.join(artifactsRoot, relativePath);
    if (!isInside(artifactsRoot, destination)) {
      throw new Error(`结果文件路径无效: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(sourceReal, destination);
    const copied = await fingerprint(destination);
    if (!copied) throw new Error(`结果文件复制失败: ${relativePath}`);
    totalCopied += copied.size;
    result.size = copied.size;
    result.sha256 = copied.sha256;
    result.artifactPath = destination;
    result.previewAvailable = copied.size <= MAX_PREVIEW_SIZE && mime.includes("charset=utf-8");
    results.push(result);
  }
  return results;
}

export async function resolveArtifactPath(runId: string, artifactPath: string): Promise<string> {
  const root = await realpath(runPaths(runId).artifacts);
  const resolved = await realpath(artifactPath);
  if (!isInside(root, resolved) || !(await lstat(resolved)).isFile()) {
    throw new HttpError(400, "INVALID_ARTIFACT_PATH", "结果文件路径无效");
  }
  return resolved;
}

export async function readArtifactPreview(runId: string, artifactPath: string): Promise<{
  content: string;
  truncated: boolean;
}> {
  const resolved = await resolveArtifactPath(runId, artifactPath);
  const fileStat = await stat(resolved);
  if (fileStat.size > MAX_PREVIEW_SIZE) {
    throw new HttpError(413, "PREVIEW_TOO_LARGE", "文件超过 2 MB，请下载后查看");
  }
  const content = await readFile(resolved, "utf8");
  return { content, truncated: false };
}
