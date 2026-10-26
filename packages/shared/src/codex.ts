import { z } from "zod";
import { systemStatusSchema } from "./system.js";

export const codexApprovalPolicySchema = z.enum(["untrusted", "on-request", "never"]);
export const codexSandboxModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export const codexWebSearchModeSchema = z.enum(["disabled", "cached", "indexed", "live"]);

export const codexModelOptionSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  defaultReasoningEffort: z.string(),
  supportedReasoningEfforts: z.array(z.string()),
  isDefault: z.boolean(),
});

export const codexSettingsSchema = z.object({
  model: z.string(),
  reasoningEffort: z.string(),
  approvalPolicy: z.union([
    codexApprovalPolicySchema,
    z.literal("default"),
    z.literal("custom"),
  ]),
  sandboxMode: z.union([
    codexSandboxModeSchema,
    z.literal("default"),
    z.literal("custom"),
  ]),
  networkAccess: z.boolean(),
  webSearch: z.union([codexWebSearchModeSchema, z.literal("custom")]),
});

export const codexConfigResponseSchema = z.object({
  codex: systemStatusSchema.shape.codex,
  cliCommand: z.string(),
  cliPath: z.string().nullable(),
  configFilePath: z.string().nullable(),
  configVersion: z.string().nullable(),
  settings: codexSettingsSchema.nullable(),
  models: z.array(codexModelOptionSchema),
  allowedApprovalPolicies: z.array(codexApprovalPolicySchema).nullable(),
  allowedSandboxModes: z.array(codexSandboxModeSchema).nullable(),
  allowedWebSearchModes: z.array(codexWebSearchModeSchema).nullable(),
  warnings: z.array(z.string()),
});

export const codexConfigChangesSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  reasoningEffort: z.string().trim().min(1).max(40).optional(),
  approvalPolicy: codexApprovalPolicySchema.optional(),
  sandboxMode: codexSandboxModeSchema.optional(),
  networkAccess: z.boolean().optional(),
  webSearch: codexWebSearchModeSchema.optional(),
}).strict().refine(
  (changes) => Object.values(changes).some((value) => value !== undefined),
  { message: "至少需要修改一项配置" },
);

export const codexConfigUpdateSchema = z.object({
  expectedVersion: z.string().trim().min(1).max(200).nullable(),
  changes: codexConfigChangesSchema,
  confirmDangerFullAccess: z.boolean().optional(),
}).strict();

export type CodexApprovalPolicy = z.infer<typeof codexApprovalPolicySchema>;
export type CodexSandboxMode = z.infer<typeof codexSandboxModeSchema>;
export type CodexWebSearchMode = z.infer<typeof codexWebSearchModeSchema>;
export type CodexModelOption = z.infer<typeof codexModelOptionSchema>;
export type CodexSettings = z.infer<typeof codexSettingsSchema>;
export type CodexConfigResponse = z.infer<typeof codexConfigResponseSchema>;
export type CodexConfigChanges = z.infer<typeof codexConfigChangesSchema>;
export type CodexConfigUpdate = z.infer<typeof codexConfigUpdateSchema>;
