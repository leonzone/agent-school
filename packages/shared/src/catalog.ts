import { z } from "zod";

export const skillIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Skill ID 只能包含小写字母、数字和连字符");

export const commitSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "需要完整的 40 位 Git commit SHA");

export const skillMetadataSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  maintainers: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

export const skillVersionSchema = z.object({
  commit: commitSchema,
  shortCommit: z.string().length(8),
  committedAt: z.string().datetime(),
  subject: z.string(),
});

export const skillFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});

export const skillSummarySchema = z.object({
  id: skillIdSchema,
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  maintainers: z.array(z.string()),
  latestVersion: skillVersionSchema,
});

export const skillDetailSchema = skillSummarySchema.extend({
  skillMarkdown: z.string(),
  files: z.array(skillFileSchema),
});

export const catalogResponseSchema = z.object({
  skills: z.array(skillSummarySchema),
  syncedAt: z.string().datetime().nullable(),
  sourceCommit: commitSchema.nullable(),
});

export const versionsResponseSchema = z.object({
  versions: z.array(skillVersionSchema),
});

export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export type SkillVersion = z.infer<typeof skillVersionSchema>;
export type SkillFile = z.infer<typeof skillFileSchema>;
export type SkillSummary = z.infer<typeof skillSummarySchema>;
export type SkillDetail = z.infer<typeof skillDetailSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export type VersionsResponse = z.infer<typeof versionsResponseSchema>;
