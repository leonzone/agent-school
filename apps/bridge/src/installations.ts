import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  installInputSchema,
  skillIdSchema,
  type Installation,
  type InstallationListResponse,
  type InstallationResponse,
  type InstallInput,
} from "@skillhub/shared";
import { unpackSkillArchive } from "./archive-installer.js";
import { catalogClient } from "./catalog-client.js";
import { verifyInstalledSkill } from "./codex/service.js";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import {
  computeSkillManifest,
  manifestsEqual,
  type InstalledFile,
} from "./skill-manifest.js";

type InstallationRow = {
  skill_id: string;
  skill_name: string;
  commit_sha: string;
  path: string;
  files_json: string;
  installed_at: string;
  updated_at: string;
};

export type InstalledSkillRecord = {
  skillId: string;
  skillName: string;
  commit: string;
  path: string;
  files: InstalledFile[];
  installedAt: string;
  updatedAt: string;
};

function toRecord(row: InstallationRow): InstalledSkillRecord {
  return {
    skillId: row.skill_id,
    skillName: row.skill_name,
    commit: row.commit_sha,
    path: row.path,
    files: JSON.parse(row.files_json) as InstalledFile[],
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
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

export class InstallationService {
  private readonly busy = new Set<string>();
  private activeRunSkillId: string | null = null;

  constructor(private readonly db: DatabaseSync) {}

  beginRun(skillIdInput: string): void {
    const skillId = skillIdSchema.parse(skillIdInput);
    if (this.busy.has(skillId)) {
      throw new HttpError(409, "INSTALLATION_BUSY", "该 Skill 正在安装或更新，暂时不能开始测试");
    }
    if (this.activeRunSkillId !== null) {
      throw new HttpError(409, "RUN_ALREADY_ACTIVE", "已有一个测试正在使用 Skill");
    }
    this.activeRunSkillId = skillId;
  }

  endRun(skillId: string): void {
    if (this.activeRunSkillId === skillId) this.activeRunSkillId = null;
  }

  async list(): Promise<InstallationListResponse> {
    const rows = this.db.prepare("SELECT * FROM installations ORDER BY updated_at DESC").all() as unknown as InstallationRow[];
    const installations: Installation[] = [];
    for (const row of rows) {
      installations.push(await this.toPublic(toRecord(row)));
    }
    return { installations };
  }

  get(skillId: string): InstalledSkillRecord | null {
    const row = this.db.prepare("SELECT * FROM installations WHERE skill_id = ?")
      .get(skillId) as unknown as InstallationRow | undefined;
    return row ? toRecord(row) : null;
  }

  require(skillId: string): InstalledSkillRecord {
    const record = this.get(skillId);
    if (!record) throw new HttpError(404, "SKILL_NOT_INSTALLED", "该 Skill 尚未安装");
    return record;
  }

  async assertUsable(skillId: string, commit: string): Promise<InstalledSkillRecord> {
    const record = this.require(skillId);
    if (record.commit !== commit) {
      throw new HttpError(409, "INSTALLED_VERSION_CHANGED", "安装版本已变化，请重新发起测试");
    }
    if (!(await exists(record.path)) || await this.isLocallyModified(record)) {
      throw new HttpError(409, "INSTALLED_SKILL_CHANGED", "安装目录缺失或已被修改，请重新安装");
    }
    return record;
  }

  async install(input: InstallInput): Promise<InstallationResponse> {
    const { skillId, commit } = installInputSchema.parse(input);
    return this.withLock(skillId, async () => {
      const existing = this.get(skillId);
      const target = path.join(config.skillsRoot, skillId);
      const targetExists = await exists(target);
      if (targetExists && !existing) {
        throw new HttpError(409, "UNMANAGED_SKILL_CONFLICT", `目标目录已存在且不由 Agent School 管理: ${target}`);
      }
      if (existing && path.resolve(existing.path) !== path.resolve(target)) {
        throw new HttpError(409, "INSTALLATION_PATH_CONFLICT", "安装记录中的路径与当前配置不一致");
      }
      if (existing && targetExists && await this.isLocallyModified(existing)) {
        throw new HttpError(409, "SKILL_LOCALLY_MODIFIED", "Skill 已被本地修改，请先保留改动；本次未覆盖任何文件");
      }
      if (existing?.commit === commit && targetExists) {
        return this.withCodexVerification(existing);
      }

      const archive = await catalogClient.archive(skillId, commit);
      const stagingRoot = path.join(config.skillsRoot, `.skillhub-staging-${randomUUID()}`);
      const backupPath = path.join(config.skillsRoot, `.skillhub-backup-${randomUUID()}`);
      let movedOld = false;
      let movedNew = false;
      let installed = false;
      let preserveBackup = false;
      try {
        const { stagedSkillPath, files } = await unpackSkillArchive({
          archive: archive.data,
          expectedSha256: archive.sha256,
          skillId,
          downloadsDir: config.downloadsDir,
          stagingRoot,
        });
        if (targetExists) {
          await rename(target, backupPath);
          movedOld = true;
        }
        await rename(stagedSkillPath, target);
        movedNew = true;
        const now = new Date().toISOString();
        const installedAt = existing?.installedAt ?? now;
        this.db.prepare(`
          INSERT INTO installations (
            skill_id, skill_name, commit_sha, path, files_json, installed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(skill_id) DO UPDATE SET
            skill_name = excluded.skill_name,
            commit_sha = excluded.commit_sha,
            path = excluded.path,
            files_json = excluded.files_json,
            updated_at = excluded.updated_at
        `).run(
          skillId,
          skillId,
          commit,
          target,
          JSON.stringify(files),
          installedAt,
          now,
        );
        installed = true;
      } catch (error) {
        try {
          if (movedNew) {
            await rename(target, path.join(stagingRoot, "failed-skill"));
          }
          if (movedOld) {
            await rename(backupPath, target);
          }
        } catch (rollbackError) {
          preserveBackup = movedOld;
          throw new AggregateError([error, rollbackError], `安装失败且回滚未完成，旧目录保留在 ${backupPath}`);
        }
        throw error;
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
        if (installed || !preserveBackup) {
          await rm(backupPath, { recursive: true, force: true });
        }
      }
      return this.withCodexVerification(this.require(skillId));
    });
  }

  async uninstall(skillIdInput: string): Promise<void> {
    const skillId = skillIdSchema.parse(skillIdInput);
    await this.withLock(skillId, async () => {
      const record = this.require(skillId);
      const targetExists = await exists(record.path);
      if (targetExists && await this.isLocallyModified(record)) {
        throw new HttpError(409, "SKILL_LOCALLY_MODIFIED", "Skill 已被本地修改，未执行卸载");
      }
      if (!targetExists) {
        this.db.prepare("DELETE FROM installations WHERE skill_id = ?").run(skillId);
        return;
      }
      const trashRoot = path.join(config.home, "trash");
      const trashPath = path.join(trashRoot, randomUUID());
      await mkdir(trashRoot, { recursive: true });
      await rename(record.path, trashPath);
      try {
        this.db.prepare("DELETE FROM installations WHERE skill_id = ?").run(skillId);
      } catch (error) {
        await rename(trashPath, record.path);
        throw error;
      }
      await rm(trashPath, { recursive: true, force: true });
    });
  }

  private async withCodexVerification(record: InstalledSkillRecord): Promise<InstallationResponse> {
    let codexError: string | null = null;
    try {
      await verifyInstalledSkill(path.join(record.path, "SKILL.md"), config.projectRoot);
    } catch (error) {
      codexError = error instanceof Error ? error.message : "Codex Skill 校验失败";
    }
    return { installation: await this.toPublic(record), codexError };
  }

  private async toPublic(record: InstalledSkillRecord): Promise<Installation> {
    return {
      skillId: record.skillId,
      skillName: record.skillName,
      commit: record.commit,
      path: record.path,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      locallyModified: !(await exists(record.path)) || await this.isLocallyModified(record),
    };
  }

  private async isLocallyModified(record: InstalledSkillRecord): Promise<boolean> {
    try {
      const current = await computeSkillManifest(record.path);
      return !manifestsEqual(current, record.files);
    } catch {
      return true;
    }
  }

  private async withLock<T>(skillId: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeRunSkillId === skillId) {
      throw new HttpError(409, "SKILL_RUN_ACTIVE", "该 Skill 正在测试中，完成或停止测试后才能安装、更新或卸载");
    }
    if (this.busy.has(skillId)) {
      throw new HttpError(409, "INSTALLATION_BUSY", "该 Skill 正在执行另一个安装操作");
    }
    this.busy.add(skillId);
    try {
      return await operation();
    } finally {
      this.busy.delete(skillId);
    }
  }
}
