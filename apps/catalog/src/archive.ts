import { createHash } from "node:crypto";
import type { GitRepository } from "./git-repository.js";

export interface SkillArchive {
  content: Buffer;
  sha256: string;
}

export async function buildSkillArchive(
  repository: GitRepository,
  commit: string,
  skillId: string,
): Promise<SkillArchive> {
  const content = await repository.createSkillArchive(commit, skillId);
  return {
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
