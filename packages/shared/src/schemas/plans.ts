import { z } from 'zod';
import { flexibleDateTimeSchema } from './workouts.js';

export const TRAINING_MODES = ['strength', 'hypertrophy', 'endurance', 'power'] as const;
export const trainingModeSchema = z.enum(TRAINING_MODES);
export type TrainingMode = z.infer<typeof trainingModeSchema>;

export const planTemplateItemSchema = z.object({
  exerciseId: z.string().describe('catalog exercise id (MCP tools also accept exact name or alias)'),
  sets: z.number().int().min(1).max(10).optional(),
  repsLow: z.number().int().min(1).max(120).optional(),
  repsHigh: z.number().int().min(1).max(120).optional(),
  targetWeightKg: z.number().min(0).optional().describe('starting load; omit to let progression derive it'),
  rir: z.number().min(0).max(6).optional().describe('target reps in reserve'),
  restSec: z.number().int().min(15).max(600).optional(),
  perSide: z.boolean().optional().describe('reps/duration are per side'),
  unit: z.enum(['reps', 'seconds']).optional().describe('what repsLow/High count; default reps'),
  notes: z.string().max(500).optional().describe('per-exercise cue/caution, shown during the session'),
});

export const planDaySchema = z.object({
  dayIndex: z.number().int().min(0).max(13),
  name: z.string().min(1).max(100),
  mode: trainingModeSchema.nullish(),
  weekday: z.number().int().min(0).max(6).nullish().describe('0=Monday ... 6=Sunday; anchors generate_week'),
  targetMuscles: z.array(z.string()).default([]),
  template: z.array(planTemplateItemSchema).default([]),
});

export const planCreateSchema = z.object({
  name: z.string().min(1).max(200),
  weeks: z.number().int().min(1).max(52).default(8),
  daysPerWeek: z.number().int().min(1).max(7).default(4),
  startDate: z.string().date().optional(),
  deloadWeeks: z
    .array(z.number().int().min(1).max(52))
    .default([])
    .describe('1-based week numbers generated at reduced volume, e.g. [4, 8]'),
  notes: z.string().max(10000).nullish().describe('markdown supported, max 10000 chars'),
  createdBy: z.enum(['manual', 'generator', 'mcp']).default('manual'),
  days: z.array(planDaySchema).default([]),
});

// PATCH semantics: omitted fields stay UNCHANGED. `days`, when present,
// replaces the day list but preserves the identity of days whose dayIndex
// already exists. Not derived via .partial() — see workoutUpdateSchema.
export const planUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
  weeks: z.number().int().min(1).max(52).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  startDate: z.string().date().optional(),
  deloadWeeks: z.array(z.number().int().min(1).max(52)).optional(),
  notes: z.string().max(10000).nullish().describe('markdown supported, max 10000 chars'),
  days: z
    .array(planDaySchema)
    .optional()
    .describe('when present, REPLACES the day list (days keep identity per dayIndex)'),
});

export const generateWorkoutSchema = z.object({
  date: flexibleDateTimeSchema.optional(),
  planDayId: z.string().optional(),
  muscles: z.array(z.string()).optional(),
  mode: trainingModeSchema.optional(),
});

export type PlanCreate = z.infer<typeof planCreateSchema>;
export type PlanUpdate = z.infer<typeof planUpdateSchema>;
export type PlanTemplateItem = z.infer<typeof planTemplateItemSchema>;
