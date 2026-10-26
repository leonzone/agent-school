import matter from "gray-matter";
import { z, ZodError } from "zod";
import {
  catalogResponseSchema,
  commitSchema,
  skillDetailSchema,
  skillIdSchema,
  skillMetadataSchema,
  skillSummarySchema,
  versionsResponseSchema,
  type CatalogResponse,
  type SkillDetail,
  type SkillFile,
  type SkillMetadata,
  type SkillSummary,
  type SkillVersion,
  type VersionsResponse,
} from "@skillhub/shared";
import { buildSkillArchive, type SkillArchive } from "./archive.js";
import { HttpError, SkillValidationError } from "./errors.js";
import type { GitRepository } from "./git-repository.js";

const frontmatterSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

const catalogQuerySchema = z.object({
  q: z.string().optional(),
});

const detailQuerySchema = z.object({
  commit: commitSchema.optional(),
});

interface SkillContent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tags: string[];
  maintainers: string[];
  skillMarkdown: string;
  files: SkillFile[];
}

interface CatalogSnapshot {
  skills: SkillSummary[];
  syncedAt: string;
  sourceCommit: string;
}

function validationMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : "未知校验错误";
}

function summarize(content: SkillContent, latestVersion: SkillVersion): SkillSummary {
  return skillSummarySchema.parse({
    id: content.id,
    name: content.name,
    displayName: content.displayName,
    description: content.description,
    tags: content.tags,
    maintainers: content.maintainers,
    latestVersion,
  });
}

async function readSkill(
  repository: GitRepository,
  commit: string,
  skillId: string,
): Promise<SkillContent> {
  const files = await repository.listSkillFiles(commit, skillId);
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new SkillValidationError(skillId, "缺少 SKILL.md");
  }

  const skillMarkdown = (await repository.readSkillFile(commit, skillId, "SKILL.md")).toString(
    "utf8",
  );
  const hasMetadata = files.some((file) => file.path === "skillhub.json");
  const rawMetadata = hasMetadata
    ? (await repository.readSkillFile(commit, skillId, "skillhub.json")).toString("utf8")
    : null;

  try {
    const parsedMarkdown = matter(skillMarkdown);
    const frontmatter = frontmatterSchema.parse(parsedMarkdown.data);
    if (frontmatter.name !== skillId) {
      throw new Error(
        `frontmatter name ${JSON.stringify(frontmatter.name)} 必须等于目录 ID ${JSON.stringify(skillId)}`,
      );
    }

    let metadata: SkillMetadata;
    if (rawMetadata === null) {
      metadata = skillMetadataSchema.parse({});
    } else {
      let json: unknown;
      try {
        json = JSON.parse(rawMetadata);
      } catch (error) {
        throw new Error(`skillhub.json 不是有效 JSON: ${validationMessage(error)}`);
      }
      metadata = skillMetadataSchema.parse(json);
    }

    return {
      id: skillId,
      name: frontmatter.name,
      displayName: metadata.displayName ?? frontmatter.name,
      description: frontmatter.description,
      tags: metadata.tags,
      maintainers: metadata.maintainers,
      skillMarkdown,
      files,
    };
  } catch (error) {
    if (error instanceof SkillValidationError) {
      throw error;
    }
    throw new SkillValidationError(skillId, validationMessage(error));
  }
}

function compareSkills(left: SkillSummary, right: SkillSummary): number {
  const byDisplayName = left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: "base",
  });
  if (byDisplayName !== 0) {
    return byDisplayName;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class SkillIndex {
  private snapshot: CatalogSnapshot | null = null;
  private syncPromise: Promise<CatalogResponse> | null = null;

  constructor(private readonly repository: GitRepository) {}

  getSyncStatus(): { syncedAt: string | null; sourceCommit: string | null } {
    return {
      syncedAt: this.snapshot?.syncedAt ?? null,
      sourceCommit: this.snapshot?.sourceCommit ?? null,
    };
  }

  private requireSnapshot(): CatalogSnapshot {
    if (this.snapshot === null) {
      throw new HttpError(503, "CATALOG_NOT_SYNCED", "目录尚未同步，请先调用 POST /api/sync");
    }
    return this.snapshot;
  }

  private requireCurrentSkill(snapshot: CatalogSnapshot, skillId: string): SkillSummary {
    const skill = snapshot.skills.find((candidate) => candidate.id === skillId);
    if (skill === undefined) {
      throw new HttpError(404, "SKILL_NOT_FOUND", `Skill ${skillId} 不存在`);
    }
    return skill;
  }

  private async findVersion(
    snapshot: CatalogSnapshot,
    skillId: string,
    commit: string,
  ): Promise<SkillVersion> {
    const versions = await this.repository.getSkillHistory(snapshot.sourceCommit, skillId);
    const version = versions.find((candidate) => candidate.commit === commit);
    if (version === undefined) {
      throw new HttpError(
        404,
        "SKILL_VERSION_NOT_FOUND",
        `commit ${commit} 不属于 Skill ${skillId} 的默认分支历史`,
      );
    }
    return version;
  }

  private async readRequestedVersion(commit: string, skillId: string): Promise<SkillContent> {
    try {
      return await readSkill(this.repository, commit, skillId);
    } catch (error) {
      if (error instanceof SkillValidationError) {
        throw new HttpError(400, "INVALID_SKILL_VERSION", error.message);
      }
      throw error;
    }
  }

  private async performSync(): Promise<CatalogResponse> {
    const sourceCommit = await this.repository.syncRemote();
    const rawIds = await this.repository.listSkillIds(sourceCommit);
    const skills: SkillSummary[] = [];

    for (const rawId of rawIds) {
      const parsedId = skillIdSchema.safeParse(rawId);
      if (!parsedId.success) {
        throw new SkillValidationError(
          JSON.stringify(rawId),
          "目录名不符合 skillIdSchema",
        );
      }
      const skillId = parsedId.data;
      const content = await readSkill(this.repository, sourceCommit, skillId);
      const history = await this.repository.getSkillHistory(sourceCommit, skillId, 1);
      const latestVersion = history[0];
      if (latestVersion === undefined) {
        throw new SkillValidationError(skillId, "无法确定目录的最新 commit");
      }
      skills.push(summarize(content, latestVersion));
    }

    skills.sort(compareSkills);
    this.snapshot = {
      skills,
      sourceCommit,
      syncedAt: new Date().toISOString(),
    };
    return this.getCatalog({});
  }

  async sync(): Promise<CatalogResponse> {
    if (this.syncPromise !== null) {
      return this.syncPromise;
    }
    const operation = this.performSync();
    this.syncPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.syncPromise === operation) {
        this.syncPromise = null;
      }
    }
  }

  getCatalog(query: unknown): CatalogResponse {
    const snapshot = this.requireSnapshot();
    const { q = "" } = catalogQuerySchema.parse(query ?? {});
    const needle = q.trim().toLowerCase();
    const skills = snapshot.skills
      .filter((skill) => {
        if (needle.length === 0) {
          return true;
        }
        return [
          skill.id,
          skill.name,
          skill.displayName,
          skill.description,
          ...skill.tags,
          ...skill.maintainers,
        ]
          .join("\n")
          .toLowerCase()
          .includes(needle);
      })
      .slice()
      .sort(compareSkills);

    return catalogResponseSchema.parse({
      skills,
      syncedAt: snapshot.syncedAt,
      sourceCommit: snapshot.sourceCommit,
    });
  }

  async getDetail(skillId: string, query: unknown): Promise<SkillDetail> {
    const snapshot = this.requireSnapshot();
    const current = this.requireCurrentSkill(snapshot, skillId);
    const { commit } = detailQuerySchema.parse(query ?? {});
    const selectedCommit = commit ?? current.latestVersion.commit;
    if (commit !== undefined) {
      await this.findVersion(snapshot, skillId, commit);
    }
    const content = await this.readRequestedVersion(selectedCommit, skillId);

    return skillDetailSchema.parse({
      ...summarize(content, current.latestVersion),
      skillMarkdown: content.skillMarkdown,
      files: content.files,
    });
  }

  async getVersions(skillId: string): Promise<VersionsResponse> {
    const snapshot = this.requireSnapshot();
    this.requireCurrentSkill(snapshot, skillId);
    const versions = await this.repository.getSkillHistory(snapshot.sourceCommit, skillId);
    return versionsResponseSchema.parse({ versions });
  }

  async getArchive(skillId: string, commit: string): Promise<SkillArchive> {
    const snapshot = this.requireSnapshot();
    this.requireCurrentSkill(snapshot, skillId);
    await this.findVersion(snapshot, skillId, commit);
    await this.readRequestedVersion(commit, skillId);
    return buildSkillArchive(this.repository, commit, skillId);
  }
}
