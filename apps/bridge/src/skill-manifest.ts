import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export type InstalledFile = {
  path: string;
  sha256: string;
  mode: number;
};

export async function computeSkillManifest(root: string): Promise<InstalledFile[]> {
  const files: InstalledFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill 中不允许符号链接: ${absolute}`);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Skill 中包含不支持的文件类型: ${absolute}`);
      const [fileStat, content] = await Promise.all([
        stat(absolute),
        readFile(absolute),
      ]);
      files.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        sha256: createHash("sha256").update(content).digest("hex"),
        mode: fileStat.mode & 0o777,
      });
    }
  }
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function manifestsEqual(left: InstalledFile[], right: InstalledFile[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
