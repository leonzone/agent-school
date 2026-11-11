import { z } from "zod";

export const hubSkillIdSchema = z.string().regex(/^skl_[a-z0-9][a-z0-9-]{0,63}$/, "Skill 标识无效");
export const hubVersionSchema = z.string().max(80).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/, "版本应为 1.0.0 或 1.0.0-beta.1 这样的格式");
export const hubDependencySchema = z.object({ type: z.literal("skill"), id: hubSkillIdSchema, version: hubVersionSchema, required: z.boolean() });
export const skillHubQuerySchema = z.object({
  keyword: z.string().trim().max(200).default(""),
  scope: z.enum(["all", "installed"]).default("all"),
  sort: z.enum(["latest", "name"]).default("latest"),
  category: z.string().trim().max(100).default(""),
  tag: z.string().trim().max(50).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const hubUploadInputSchema = z.object({
  version: hubVersionSchema.optional(),
  displayName: z.string().trim().min(1, "显示名称不能为空").max(100, "显示名称不能超过 100 个字符").optional(),
  author: z.string().trim().min(1, "作者不能为空").max(80, "作者不能超过 80 个字符").optional(),
  category: z.string().trim().max(100, "分类不能超过 100 个字符").default(""),
  tags: z.array(z.string().trim().min(1, "标签不能为空").max(50, "单个标签不能超过 50 个字符")).max(20, "标签不能超过 20 个").default([]),
}).strict();
export const hubInstallConfirmationSchema = z.object({ planId: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict();

export type SkillHubQuery = z.infer<typeof skillHubQuerySchema>;
export type HubUploadInput = z.infer<typeof hubUploadInputSchema>;
export type HubDependency = z.infer<typeof hubDependencySchema>;
export type HubFile = { path: string; size: number; sha256: string; executable: boolean };
export type HubSkill = {
  id: string;
  name: string;
  title: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  version: string;
  uploadedAt: string;
  fileCount: number;
  bytes: number;
};
export type HubSkillDetail = HubSkill & {
  markdown: string;
  skillMarkdown: string;
  files: HubFile[];
  versions: Array<{ version: string; uploadedAt: string }>;
  dependencies: HubDependency[];
};
export type SkillHubCatalog = {
  skills: HubSkill[];
  total: number;
  page: number;
  pageSize: number;
  facets: { categories: string[]; tags: string[] };
};
export type HubInstallation = { skillId: string; name: string; version: string; path: string; installedAt: string };
export type HubInstallPlan = {
  id: string;
  expiresAt: string;
  nodes: Array<{ skillId: string; name: string; title: string; version: string; path: string; fileCount: number; bytes: number; alreadyInstalled: boolean; dependencies: HubDependency[] }>;
};
export type HubInstallResult = { installations: HubInstallation[]; codexErrors: string[]; error: string | null; skipped: string[] };
export type HubMcpInfo = {
  ready: boolean;
  codexConfig: string;
  config: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
  tools: Array<{ name: string; description: string }>;
  instructions: string;
};
