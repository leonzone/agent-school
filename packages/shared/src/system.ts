import { z } from "zod";

export const systemStatusSchema = z.object({
  codex: z.object({
    available: z.boolean(),
    version: z.string().nullable(),
    compatible: z.boolean(),
    loggedIn: z.boolean(),
    accountType: z.string().nullable(),
    error: z.string().nullable(),
  }),
  catalog: z.object({
    available: z.boolean(),
    error: z.string().nullable(),
  }),
  activeRunId: z.string().uuid().nullable(),
  maintenanceClonePath: z.string().nullable(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
