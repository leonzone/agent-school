import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { v2 } from "@skillhub/codex-protocol";
import {
  agentIdSchema,
  type TrainedAgent,
  type TrainingListResponse,
  type TrainingResponse,
} from "@skillhub/shared";
import type { AgentService } from "./agents.js";
import { unpackSkillArchive } from "./archive-installer.js";
import { catalogClient } from "./catalog-client.js";
import { AppServerClient } from "./codex/app-server-client.js";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import {
  computeSkillManifest,
  manifestsEqual,
  type InstalledFile,
} from "./skill-manifest.js";

type TrainingRow = {
  agent_id: string;
  agent_name: string;
  revision: number;
  project_path: string;
  instruction_json: string;
  skills_json: string;
  created_at: string;
  updated_at: string;
};

export type StoredTrainingSkill = TrainedAgent["skills"][number] & {
  files: InstalledFile[];
};

export type StoredTrainingRecord = Omit<TrainedAgent, "skills"> & {
  instructionFiles: InstalledFile[];
  skills: StoredTrainingSkill[];
};

type MovedPath = {
  source: string;
  backup: string;
};

function toRecord(row: TrainingRow): StoredTrainingRecord {
  return {
    agentId: row.agent_id,
    agentName: row.agent_name,
    revision: row.revision,
    projectPath: row.project_path,
    instructionFiles: JSON.parse(row.instruction_json) as InstalledFile[],
    skills: JSON.parse(row.skills_json) as StoredTrainingSkill[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    locallyModified: false,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function computeInstructionManifest(projectPath: string): Promise<InstalledFile[]> {
  const instructionPath = path.join(projectPath, "AGENTS.md");
  const fileStat = await lstat(instructionPath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("AGENTS.md 必须是普通文件");
  }
  const content = await readFile(instructionPath);
  return [{
    path: "AGENTS.md",
    sha256: createHash("sha256").update(content).digest("hex"),
    mode: fileStat.mode & 0o777,
  }];
}

export class TrainingService {
  private readonly busy = new Set<string>();
  private activeRunAgentId: string | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly agents: AgentService,
  ) {}

  beginRun(agentIdInput: string): void {
    const agentId = agentIdSchema.parse(agentIdInput);
    if (this.busy.has(agentId)) {
      throw new HttpError(409, "TRAINING_BUSY", "该角色正在培训，暂时不能开始测试");
    }
    if (this.activeRunAgentId !== null) {
      throw new HttpError(409, "RUN_ALREADY_ACTIVE", "已有一个培训角色测试正在运行");
    }
    this.activeRunAgentId = agentId;
  }

  endRun(agentId: string): void {
    if (this.activeRunAgentId === agentId) this.activeRunAgentId = null;
  }

  async list(): Promise<TrainingListResponse> {
    const rows = this.db.prepare("SELECT * FROM trained_agents ORDER BY updated_at DESC, agent_id")
      .all() as unknown as TrainingRow[];
    const trainings: TrainedAgent[] = [];
    for (const row of rows) trainings.push(await this.toPublic(toRecord(row)));
    return { trainings };
  }

  get(agentId: string): StoredTrainingRecord | null {
    const row = this.db.prepare("SELECT * FROM trained_agents WHERE agent_id = ?")
      .get(agentId) as unknown as TrainingRow | undefined;
    return row ? toRecord(row) : null;
  }

  require(agentId: string): StoredTrainingRecord {
    const record = this.get(agentId);
    if (!record) throw new HttpError(404, "TRAINING_NOT_FOUND", "该角色尚未培训");
    return record;
  }

  async assertUsable(agentIdInput: string, revision: number): Promise<StoredTrainingRecord> {
    const agentId = agentIdSchema.parse(agentIdInput);
    const record = this.require(agentId);
    if (record.revision !== revision) {
      throw new HttpError(409, "TRAINED_REVISION_CHANGED", "培训版本已变化，请重新发起测试");
    }
    this.assertRecordPath(record);
    if (await this.isLocallyModified(record)) {
      throw new HttpError(409, "TRAINED_AGENT_CHANGED", "培训文件缺失或已被修改，请重新培训");
    }
    return record;
  }

  async toPublic(record: StoredTrainingRecord): Promise<TrainedAgent> {
    return {
      agentId: record.agentId,
      agentName: record.agentName,
      revision: record.revision,
      projectPath: record.projectPath,
      skills: record.skills.map(({ skillId, commit, path: skillPath }) => ({
        skillId,
        commit,
        path: skillPath,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      locallyModified: await this.isLocallyModified(record),
    };
  }

  async train(agentIdInput: string): Promise<TrainingResponse> {
    const agentId = agentIdSchema.parse(agentIdInput);
    return this.withLock(agentId, async () => {
      const agent = this.agents.require(agentId);
      const existing = this.get(agentId);
      const target = this.projectPath(agentId);
      const targetExists = await exists(target);
      if (targetExists && !existing) {
        throw new HttpError(409, "UNMANAGED_TRAINING_CONFLICT", `目标目录已存在且没有培训记录，未覆盖: ${target}`);
      }
      if (existing) {
        this.assertRecordPath(existing);
        if (!targetExists || await this.isLocallyModified(existing)) {
          throw new HttpError(409, "TRAINING_LOCALLY_MODIFIED", "培训文件缺失或已被本地修改，请先保留改动；本次未覆盖任何文件");
        }
      }

      const stagingRoot = path.join(config.agentsRoot, `.skillhub-training-${randomUUID()}`);
      const backupRoot = path.join(config.agentsRoot, `.skillhub-training-backup-${randomUUID()}`);
      const stagingSkillsRoot = path.join(stagingRoot, ".agents", "skills");
      const movedOld: MovedPath[] = [];
      const movedNew: string[] = [];
      let movedInitialTarget = false;
      let saved = false;
      let preserveBackup = false;
      try {
        await mkdir(stagingSkillsRoot, { recursive: true });
        await writeFile(path.join(stagingRoot, "AGENTS.md"), `${agent.instructions}\n`, { flag: "wx" });
        const instructionFiles = await computeInstructionManifest(stagingRoot);
        const skills: StoredTrainingSkill[] = [];
        for (const skillId of agent.skillIds) {
          const detail = await catalogClient.detail(skillId);
          const commit = detail.latestVersion.commit;
          const archive = await catalogClient.archive(skillId, commit);
          const { files } = await unpackSkillArchive({
            archive: archive.data,
            expectedSha256: archive.sha256,
            skillId,
            downloadsDir: config.downloadsDir,
            stagingRoot: stagingSkillsRoot,
          });
          skills.push({
            skillId,
            commit,
            path: path.join(target, ".agents", "skills", skillId),
            files,
          });
        }

        if (existing) {
          if (await this.isLocallyModified(existing)) {
            throw new HttpError(409, "TRAINING_LOCALLY_MODIFIED", "培训文件在下载期间被修改，本次未覆盖任何文件");
          }
          await mkdir(path.join(backupRoot, ".agents", "skills"), { recursive: true });
          const oldPaths = [
            path.join(target, "AGENTS.md"),
            ...existing.skills.map((skill) => skill.path),
          ];
          for (const source of oldPaths) {
            const relative = path.relative(target, source);
            const backup = path.join(backupRoot, relative);
            await rename(source, backup);
            movedOld.push({ source, backup });
          }
          const newPaths = [
            path.join(stagingRoot, "AGENTS.md"),
            ...skills.map((skill) => path.join(stagingSkillsRoot, skill.skillId)),
          ];
          const destinations = [
            path.join(target, "AGENTS.md"),
            ...skills.map((skill) => skill.path),
          ];
          for (const [index, source] of newPaths.entries()) {
            const destination = destinations[index];
            if (!destination) throw new Error("培训文件路径映射不完整");
            await rename(source, destination);
            movedNew.push(destination);
          }
        } else {
          await rename(stagingRoot, target);
          movedInitialTarget = true;
        }

        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO trained_agents (
            agent_id, agent_name, revision, project_path, instruction_json, skills_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            agent_name = excluded.agent_name,
            revision = excluded.revision,
            project_path = excluded.project_path,
            instruction_json = excluded.instruction_json,
            skills_json = excluded.skills_json,
            updated_at = excluded.updated_at
        `).run(
          agent.id,
          agent.name,
          agent.revision,
          target,
          JSON.stringify(instructionFiles),
          JSON.stringify(skills),
          existing?.createdAt ?? now,
          now,
        );
        saved = true;
      } catch (error) {
        try {
          if (movedInitialTarget) await rename(target, stagingRoot);
          for (const destination of movedNew.reverse()) {
            await rm(destination, { recursive: true, force: true });
          }
          for (const { source, backup } of movedOld.reverse()) {
            await rename(backup, source);
          }
        } catch (rollbackError) {
          preserveBackup = movedOld.length > 0;
          throw new AggregateError(
            [error, rollbackError],
            `培训失败且回滚未完成${preserveBackup ? `，旧文件保留在 ${backupRoot}` : ""}`,
          );
        }
        throw error;
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
        if (saved || !preserveBackup) await rm(backupRoot, { recursive: true, force: true });
      }
      return this.withCodexVerification(this.require(agentId));
    });
  }

  private projectPath(agentId: string): string {
    const root = path.resolve(config.agentsRoot);
    const target = path.resolve(root, agentId);
    if (path.dirname(target) !== root) throw new HttpError(400, "INVALID_TRAINING_PATH", "培训路径无效");
    return target;
  }

  private assertRecordPath(record: StoredTrainingRecord): void {
    if (path.resolve(record.projectPath) !== this.projectPath(record.agentId)) {
      throw new HttpError(409, "TRAINING_PATH_CONFLICT", "培训记录中的路径与当前配置不一致");
    }
    for (const skill of record.skills) {
      const expected = path.join(record.projectPath, ".agents", "skills", skill.skillId);
      if (path.resolve(skill.path) !== expected) {
        throw new HttpError(409, "TRAINING_PATH_CONFLICT", "培训记录中的 Skill 路径无效");
      }
    }
  }

  private async isLocallyModified(record: StoredTrainingRecord): Promise<boolean> {
    try {
      this.assertRecordPath(record);
      const projectStat = await lstat(record.projectPath);
      if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) return true;
      for (const directory of [
        path.join(record.projectPath, ".agents"),
        path.join(record.projectPath, ".agents", "skills"),
      ]) {
        const directoryStat = await lstat(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return true;
      }
      const instructionFiles = await computeInstructionManifest(record.projectPath);
      if (!manifestsEqual(instructionFiles, record.instructionFiles)) return true;
      for (const skill of record.skills) {
        const skillStat = await lstat(skill.path);
        if (!skillStat.isDirectory() || skillStat.isSymbolicLink()) return true;
        const files = await computeSkillManifest(skill.path);
        if (!manifestsEqual(files, skill.files)) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private async withCodexVerification(record: StoredTrainingRecord): Promise<TrainingResponse> {
    let codexError: string | null = null;
    try {
      const client = await AppServerClient.start();
      try {
        const result = await client.call<v2.SkillsListResponse>("skills/list", {
          cwds: [record.projectPath],
          forceReload: true,
        });
        const skills = result.data.flatMap((entry: v2.SkillsListEntry) => entry.skills);
        for (const installed of record.skills) {
          const expectedPath = path.resolve(installed.path, "SKILL.md");
          const match = skills.find((skill: v2.SkillMetadata) => path.resolve(skill.path) === expectedPath);
          if (!match) {
            const errors = result.data
              .flatMap((entry: v2.SkillsListEntry) => entry.errors)
              .map((entry: v2.SkillErrorInfo) => JSON.stringify(entry));
            throw new Error(`Codex 未发现 ${expectedPath}${errors.length ? `；${errors.join("；")}` : ""}`);
          }
          if (!match.enabled) throw new Error(`Codex 已发现 Skill，但它处于禁用状态: ${expectedPath}`);
        }
      } finally {
        await client.stop();
      }
    } catch (error) {
      codexError = error instanceof Error ? error.message : "Codex Skill 校验失败";
    }
    return { training: await this.toPublic(record), codexError };
  }

  private async withLock<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeRunAgentId === agentId) {
      throw new HttpError(409, "TRAINING_RUN_ACTIVE", "该角色正在测试中，完成或停止测试后才能培训");
    }
    if (this.busy.has(agentId)) {
      throw new HttpError(409, "TRAINING_BUSY", "该角色正在执行另一个培训操作");
    }
    this.busy.add(agentId);
    try {
      return await operation();
    } finally {
      this.busy.delete(agentId);
    }
  }
}
