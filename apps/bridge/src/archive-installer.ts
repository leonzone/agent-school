import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import * as tar from "tar";
import { skillIdSchema } from "@skillhub/shared";
import { HttpError } from "./errors.js";
import { computeSkillManifest, type InstalledFile } from "./skill-manifest.js";

const MAX_FILES = 1_000;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

function validateEntryPath(entryPath: string, skillId: string): void {
  const pathWithoutTrailingSlash = entryPath.endsWith("/") ? entryPath.slice(0, -1) : entryPath;
  const segments = pathWithoutTrailingSlash.split("/");
  if (
    !entryPath ||
    entryPath.includes("\\") ||
    entryPath.includes("\0") ||
    path.posix.isAbsolute(entryPath) ||
    /^[A-Za-z]:/.test(entryPath) ||
    segments.some((segment) => segment === ".." || segment === "") ||
    segments[0] !== skillId
  ) {
    throw new HttpError(400, "INVALID_SKILL_ARCHIVE", `归档包含非法路径: ${entryPath}`);
  }
}

export async function unpackSkillArchive(options: {
  archive: Buffer;
  expectedSha256: string;
  skillId: string;
  downloadsDir: string;
  stagingRoot: string;
}): Promise<{ stagedSkillPath: string; files: InstalledFile[] }> {
  const skillId = skillIdSchema.parse(options.skillId);
  const actualSha = createHash("sha256").update(options.archive).digest("hex");
  if (actualSha !== options.expectedSha256) {
    throw new HttpError(502, "ARCHIVE_HASH_MISMATCH", "Skill 归档 hash 与课程服务不一致");
  }
  if (options.archive.length > MAX_TOTAL_SIZE) {
    throw new HttpError(413, "SKILL_ARCHIVE_TOO_LARGE", "Skill 归档超过 50 MB 限制");
  }

  await mkdir(options.downloadsDir, { recursive: true });
  const archivePath = path.join(options.downloadsDir, `${skillId}-${actualSha}.tar`);
  await writeFile(archivePath, options.archive, { flag: "w" });

  let fileCount = 0;
  let totalSize = 0;
  let hasSkillMarkdown = false;
  try {
    await tar.t({
      file: archivePath,
      strict: true,
      onentry: (entry) => {
        validateEntryPath(entry.path, skillId);
        if (!["File", "Directory"].includes(entry.type)) {
          throw new HttpError(400, "INVALID_SKILL_ARCHIVE", `归档不允许链接或特殊文件: ${entry.path}`);
        }
        if (entry.type === "File") {
          fileCount += 1;
          totalSize += entry.size;
          if (fileCount > MAX_FILES || totalSize > MAX_TOTAL_SIZE) {
            throw new HttpError(413, "SKILL_ARCHIVE_TOO_LARGE", "Skill 文件数量或总大小超过限制");
          }
          if (entry.path === `${skillId}/SKILL.md`) hasSkillMarkdown = true;
        }
      },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_SKILL_ARCHIVE", "无法读取 Skill tar 归档");
  }
  if (!hasSkillMarkdown) {
    throw new HttpError(400, "INVALID_SKILL_ARCHIVE", "归档缺少根目录 SKILL.md");
  }

  await mkdir(options.stagingRoot, { recursive: true });
  try {
    await tar.x({
      file: archivePath,
      cwd: options.stagingRoot,
      strict: true,
      preservePaths: false,
      preserveOwner: false,
    });
    const stagedSkillPath = path.join(options.stagingRoot, skillId);
    const skillMarkdown = await readFile(path.join(stagedSkillPath, "SKILL.md"), "utf8");
    const parsed = matter(skillMarkdown);
    const name = parsed.data.name;
    const description = parsed.data.description;
    if (name !== skillId || typeof description !== "string" || !description.trim()) {
      throw new HttpError(400, "INVALID_SKILL", "SKILL.md 的 name/description 与目录不匹配");
    }
    const files = await computeSkillManifest(stagedSkillPath);
    return { stagedSkillPath, files };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_SKILL_ARCHIVE", "Skill 解包或内容校验失败");
  }
}
