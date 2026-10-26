import { z } from "zod";
import { commitSchema, skillIdSchema } from "./catalog.js";

export const agentIdSchema = skillIdSchema;

export const agentFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(100_000),
  skillIds: z.array(skillIdSchema).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length, "不能重复选择同一个 Skill"),
});

export const agentCreateInputSchema = agentFieldsSchema.extend({
  id: agentIdSchema,
  avatar: z.string().trim().min(1).max(16).optional(),
});

export const agentUpdateInputSchema = agentFieldsSchema.extend({
  expectedRevision: z.number().int().positive(),
});

export const agentProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatar: z.string().trim().min(1).max(16),
});

export const agentDuplicateInputSchema = z.object({
  id: agentIdSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

export const agentSchema = agentFieldsSchema.extend({
  id: agentIdSchema,
  avatar: z.string().trim().min(1).max(16).default("🤖"),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const trainedSkillSchema = z.object({
  skillId: skillIdSchema,
  commit: commitSchema,
  path: z.string(),
});

export const trainedAgentSchema = z.object({
  agentId: agentIdSchema,
  agentName: z.string(),
  revision: z.number().int().positive(),
  projectPath: z.string(),
  skills: z.array(trainedSkillSchema).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  locallyModified: z.boolean(),
});

export const agentListResponseSchema = z.object({ agents: z.array(agentSchema) });
export const agentResponseSchema = z.object({ agent: agentSchema });
export const trainingListResponseSchema = z.object({ trainings: z.array(trainedAgentSchema) });
export const trainingResponseSchema = z.object({
  training: trainedAgentSchema,
  codexError: z.string().nullable(),
});

export type AgentFields = z.infer<typeof agentFieldsSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;
export type AgentProfileInput = z.infer<typeof agentProfileInputSchema>;
export type AgentDuplicateInput = z.infer<typeof agentDuplicateInputSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type TrainedSkill = z.infer<typeof trainedSkillSchema>;
export type TrainedAgent = z.infer<typeof trainedAgentSchema>;
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type TrainingListResponse = z.infer<typeof trainingListResponseSchema>;
export type TrainingResponse = z.infer<typeof trainingResponseSchema>;
