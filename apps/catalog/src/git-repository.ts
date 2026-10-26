import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  commitSchema,
  skillFileSchema,
  skillIdSchema,
  skillVersionSchema,
  type SkillFile,
  type SkillVersion,
} from "@skillhub/shared";

export class GitCommandError extends Error {
  readonly exitCode: number | null;

  constructor(subcommand: string, exitCode: number | null, detail: string) {
    const suffix = detail.length === 0 ? "" : `: ${detail}`;
    super(`git ${subcommand} 失败${exitCode === null ? "" : ` (${exitCode})`}${suffix}`);
    this.name = "GitCommandError";
    this.exitCode = exitCode;
  }
}

async function runGit(args: readonly string[], cwd?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      ...(cwd === undefined ? {} : { cwd }),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new GitCommandError(args[0] ?? "", null, error.message));
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(
        new GitCommandError(
          args[0] ?? "",
          code,
          Buffer.concat(stderr).toString("utf8").trim(),
        ),
      );
    });
  });
}

function parseVersions(output: Buffer): SkillVersion[] {
  const versions: SkillVersion[] = [];
  for (const line of output.toString("utf8").split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const firstSeparator = line.indexOf("\0");
    const secondSeparator = line.indexOf("\0", firstSeparator + 1);
    if (firstSeparator < 1 || secondSeparator < 0) {
      throw new Error("Git log 返回了无法解析的版本记录");
    }

    const commit = line.slice(0, firstSeparator);
    const rawCommittedAt = line.slice(firstSeparator + 1, secondSeparator);
    const committedAt = new Date(rawCommittedAt);
    if (Number.isNaN(committedAt.getTime())) {
      throw new Error(`Git commit ${commit} 包含无效时间`);
    }
    versions.push(
      skillVersionSchema.parse({
        commit,
        shortCommit: commit.slice(0, 8),
        committedAt: committedAt.toISOString(),
        subject: line.slice(secondSeparator + 1),
      }),
    );
  }
  return versions;
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

export class GitRepository {
  readonly mirrorPath: string;

  constructor(
    readonly dataDir: string,
    readonly courseUrl: string,
    readonly courseRef: string,
  ) {
    this.mirrorPath = join(dataDir, "mirror.git");
  }

  async syncRemote(): Promise<string> {
    await mkdir(this.dataDir, { recursive: true });
    if (!existsSync(this.mirrorPath)) {
      await runGit(["clone", "--mirror", "--", this.courseUrl, this.mirrorPath]);
    }
    await runGit(["fetch", "--prune", "origin"], this.mirrorPath);

    const output = await runGit(
      ["rev-parse", "--verify", `refs/heads/${this.courseRef}^{commit}`],
      this.mirrorPath,
    );
    return commitSchema.parse(output.toString("utf8").trim());
  }

  async listSkillIds(commit: string): Promise<string[]> {
    const validCommit = commitSchema.parse(commit);
    const output = await runGit(
      ["ls-tree", "-z", "-d", "--name-only", `${validCommit}:skills`],
      this.mirrorPath,
    );
    return output
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry.length > 0);
  }

  async readSkillFile(
    commit: string,
    skillId: string,
    path: "SKILL.md" | "skillhub.json",
  ): Promise<Buffer> {
    const validCommit = commitSchema.parse(commit);
    const validId = skillIdSchema.parse(skillId);
    return runGit(
      ["cat-file", "blob", `${validCommit}:skills/${validId}/${path}`],
      this.mirrorPath,
    );
  }

  async listSkillFiles(commit: string, skillId: string): Promise<SkillFile[]> {
    const validCommit = commitSchema.parse(commit);
    const validId = skillIdSchema.parse(skillId);
    const skillRoot = `skills/${validId}/`;
    const output = await runGit(
      ["ls-tree", "-r", "-l", "-z", validCommit, "--", skillRoot],
      this.mirrorPath,
    );
    const files: SkillFile[] = [];

    for (const entry of output.toString("utf8").split("\0")) {
      if (entry.length === 0) {
        continue;
      }
      const tab = entry.indexOf("\t");
      if (tab < 0) {
        throw new Error(`Git ls-tree 返回了无法解析的文件记录: ${validId}`);
      }
      const fields = entry.slice(0, tab).trim().split(/\s+/);
      const type = fields[1];
      const rawSize = fields[3];
      if (type !== "blob") {
        continue;
      }
      if (rawSize === undefined || !/^\d+$/.test(rawSize)) {
        throw new Error(`Git ls-tree 返回了无效文件大小: ${validId}`);
      }
      const fullPath = entry.slice(tab + 1);
      if (!fullPath.startsWith(skillRoot)) {
        throw new Error(`Git ls-tree 返回了 Skill 根目录外的路径: ${validId}`);
      }
      files.push(
        skillFileSchema.parse({
          path: fullPath.slice(skillRoot.length),
          size: Number(rawSize),
        }),
      );
    }

    files.sort((left, right) => comparePaths(left.path, right.path));
    return files;
  }

  async getSkillHistory(commit: string, skillId: string, maxCount?: number): Promise<SkillVersion[]> {
    const validCommit = commitSchema.parse(commit);
    const validId = skillIdSchema.parse(skillId);
    if (maxCount !== undefined && (!Number.isInteger(maxCount) || maxCount < 1)) {
      throw new Error("Git log maxCount 必须是正整数");
    }
    const limit = maxCount === undefined ? [] : [`--max-count=${maxCount}`];
    const output = await runGit(
      [
        "log",
        ...limit,
        "--format=%H%x00%cI%x00%s",
        validCommit,
        "--",
        `skills/${validId}`,
      ],
      this.mirrorPath,
    );
    return parseVersions(output);
  }

  async createSkillArchive(commit: string, skillId: string): Promise<Buffer> {
    const validCommit = commitSchema.parse(commit);
    const validId = skillIdSchema.parse(skillId);
    return runGit(
      [
        "archive",
        "--format=tar",
        `--prefix=${validId}/`,
        `${validCommit}:skills/${validId}`,
      ],
      this.mirrorPath,
    );
  }
}
