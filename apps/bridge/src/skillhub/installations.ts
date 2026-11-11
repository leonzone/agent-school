import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { hubSkillIdSchema, skillIdSchema, type HubInstallation } from "@skillhub/shared";
import { z } from "zod";
import { HttpError } from "../errors.js";
import type { InstallationService } from "../installations.js";

const RECORD_FILE = ".skillhub-installation.json";
export const MAX_SKILL_BYTES = 50 * 1024 * 1024;
const recordSchema = z.object({
  source: z.literal("skillhub"),
  skillId: hubSkillIdSchema,
  name: skillIdSchema,
  installedAt: z.string().datetime(),
  version: z.string().default(""),
});

export type SkillPackageFile = { path: string; content: Buffer; executable?: boolean };

export function parseSkillMarkdown(markdown: string): { data: Record<string, unknown>; content: string } {
  const source = markdown.replace(/^\uFEFF/, "");
  if (Buffer.byteLength(source) > 512 * 1024) throw new HttpError(413, "SKILL_MARKDOWN_TOO_LARGE", "SKILL.md 不能超过 512 KB");
  if (!/^---\r?\n/.test(source) || !/^---[ \t]*(?:\r?\n|$)/m.test(source.slice(source.indexOf("\n") + 1))) {
    throw new HttpError(400, "INVALID_SKILL_MARKDOWN", `SKILL.md 必须使用 YAML frontmatter 和首尾 ---；实际首行：${JSON.stringify(source.split("\n")[0]?.slice(0, 60) ?? "")}`);
  }
  try {
    const parsed = matter(source, { language: "yaml" });
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  } catch { throw new HttpError(400, "INVALID_SKILL_MARKDOWN", "Skill 的 YAML frontmatter 无法解析，请检查名称和描述格式"); }
}

export function assertSkillPath(filePath: string) {
  const segments = filePath.split("/");
  if (!filePath || /[\\\u0000-\u001f:]/.test(filePath) || path.posix.isAbsolute(filePath) || segments.some((segment) => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment))) {
    throw new HttpError(400, "INVALID_SKILL_PATH", `Skill 安装包包含非法路径：${filePath}`);
  }
}

export function validateSkillFiles(files: SkillPackageFile[]): string {
  if (files.length === 0 || files.length > 1000 || files.reduce((sum, file) => sum + file.content.length, 0) > MAX_SKILL_BYTES) {
    throw new HttpError(413, "INVALID_SKILL_PACKAGE_SIZE", "Skill 安装包最多包含 1000 个文件，总大小不能超过 50 MB");
  }
  const seen = new Set<string>();
  for (const file of files) {
    assertSkillPath(file.path);
    const key = file.path.normalize("NFC").toLowerCase();
    if ([RECORD_FILE, ".skillhub-package.json"].includes(key) || seen.has(key)) throw new HttpError(400, "DUPLICATE_SKILL_PATH", `Skill 安装包存在重复或保留路径：${file.path}`);
    seen.add(key);
  }
  const markdown = files.find((file) => file.path === "SKILL.md");
  if (!markdown) throw new HttpError(400, "SKILL_MARKDOWN_REQUIRED", "Skill 安装包缺少根目录 SKILL.md");
  const frontmatter = parseSkillMarkdown(markdown.content.toString("utf8")).data;
  const name = skillIdSchema.safeParse(frontmatter.name);
  if (!name.success || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    throw new HttpError(400, "INVALID_SKILL_MARKDOWN", "Skill 的 name 必须是有效目录名，description 不能为空");
  }
  return name.data;
}

export async function publishNewSkillDirectory(target: string, files: SkillPackageFile[], record?: Record<string, unknown>) {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.skillhub-staging-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const file of files) {
      const destination = path.join(staging, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
    }
    if (record) await writeFile(path.join(staging, RECORD_FILE), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    try { await mkdir(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HttpError(409, "SKILL_DIRECTORY_EXISTS", `安装目录已存在，本次未覆盖任何文件：${target}`);
      throw error;
    }
    try { await rename(staging, target); }
    catch (error) {
      try { await rmdir(target); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Skill 发布失败，目标目录已保留"); }
      throw error;
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export class SkillInstaller {
  constructor(private readonly root: string, private readonly installations: Pick<InstallationService, "withLock">) {}

  async list(): Promise<HubInstallation[]> {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const installed: HubInstallation[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const recordPath = path.join(this.root, entry.name, RECORD_FILE);
      let text: string;
      try {
        if (!(await lstat(recordPath)).isFile()) throw new Error(`Skill 安装记录不是普通文件：${recordPath}`);
        text = await readFile(recordPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      let record: z.infer<typeof recordSchema>;
      try { record = recordSchema.parse(JSON.parse(text)); }
      catch { throw new HttpError(409, "INVALID_INSTALLATION_RECORD", `Skill 安装记录损坏：${recordPath}`); }
      if (record.name !== entry.name) throw new HttpError(409, "INSTALLATION_PATH_CONFLICT", `Skill 安装记录与目录不一致：${recordPath}`);
      installed.push({ skillId: record.skillId, name: record.name, path: path.join(this.root, entry.name), installedAt: record.installedAt, version: record.version });
    }
    return installed;
  }

  async install(skillIdInput: string, files: SkillPackageFile[], version: string): Promise<HubInstallation> {
    const skillId = hubSkillIdSchema.parse(skillIdInput);
    const name = validateSkillFiles(files);
    return this.installations.withLock(name, async () => {
      const target = path.join(this.root, name);
      try {
        await lstat(target);
        throw new HttpError(409, "SKILL_DIRECTORY_EXISTS", `安装目录已存在，本次未覆盖任何文件：${target}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const installedAt = new Date().toISOString();
      await publishNewSkillDirectory(target, files, { source: "skillhub", skillId, name, installedAt, version });
      return { skillId, name, path: target, installedAt, version };
    });
  }
}
