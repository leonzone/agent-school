import { z } from "zod";
import { commitSchema, skillIdSchema } from "./catalog.js";

export const installationSchema = z.object({
  skillId: skillIdSchema,
  skillName: z.string(),
  commit: commitSchema,
  path: z.string(),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  locallyModified: z.boolean(),
});

export const installationListResponseSchema = z.object({
  installations: z.array(installationSchema),
});

export const installationResponseSchema = z.object({
  installation: installationSchema,
  codexError: z.string().nullable(),
});

export const installInputSchema = z.object({
  skillId: skillIdSchema,
  commit: commitSchema,
});

export type Installation = z.infer<typeof installationSchema>;
export type InstallationListResponse = z.infer<typeof installationListResponseSchema>;
export type InstallationResponse = z.infer<typeof installationResponseSchema>;
export type InstallInput = z.infer<typeof installInputSchema>;
