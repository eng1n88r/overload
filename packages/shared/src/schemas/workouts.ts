import { z } from 'zod';
import { num, numeric } from './numeric.js';

/** Accepts a plain date (YYYY-MM-DD) or a full ISO datetime with offset. */
export const flexibleDateTimeSchema = z
  .union([z.string().date(), z.string().datetime({ offset: true })])
  .describe('YYYY-MM-DD or ISO datetime, e.g. 2026-08-03 or 2026-08-03T09:00:00Z');

// Numerics are wrapped in `numeric()` because these are spread as top-level
// arguments of the MCP `log_set` tool, and several clients send scalars as
// strings — see schemas/numeric.ts.
export const setEntrySchema = z.object({
  reps: numeric(num().int().min(0)).nullish(),
  weightKg: numeric(num().min(0)).nullish(),
  durationSec: numeric(num().min(0)).nullish(),
  distanceM: numeric(num().min(0)).nullish(),
  incline: numeric(num()).nullish(),
  resistance: numeric(num()).nullish(),
  isWarmup: z.boolean().default(false),
  /** Omit to inherit the exercise's loadFactor; an explicit value always wins.
   *  Deliberately not `.default(1)` — that erased "omitted" before the service
   *  layer could distinguish it from a deliberate ×1. */
  multiplier: numeric(num().positive()).optional(),
  rpe: numeric(num().min(1).max(10)).nullish(),
  note: z.string().max(500).nullish(),
  completedAt: z.string().datetime({ offset: true }).nullish(),
});

/** PATCH one logged set. Only the fields the live logger can revise after the
 *  fact — RPE is asked during the rest that follows the set, not before it. */
export const setUpdateSchema = z.object({
  rpe: numeric(num().min(1).max(10)).nullish(),
  note: z.string().max(500).nullish(),
});

export const workoutExerciseSchema = z.object({
  exerciseId: z.string(),
  targetSets: z.number().int().positive().nullish(),
  targetRepsLow: z.number().int().positive().nullish(),
  targetRepsHigh: z.number().int().positive().nullish(),
  targetWeightKg: numeric(num().min(0)).nullish(),
  unit: z.enum(['reps', 'seconds']).nullish().describe("'seconds' for timed holds; omit to inherit the exercise default"),
  notes: z.string().max(1000).nullish(),
  sets: z.array(setEntrySchema).default([]),
});

export const workoutStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'skipped']);

export const workoutCreateSchema = z.object({
  date: flexibleDateTimeSchema,
  name: z.string().max(200).nullish(),
  status: workoutStatusSchema.default('planned'),
  source: z.enum(['manual', 'generated', 'mcp']).default('manual'),
  mode: z.enum(['strength', 'hypertrophy', 'endurance', 'power']).nullish(),
  externalId: z.string().max(200).nullish(),
  notes: z.string().max(10000).nullish().describe('markdown supported, max 10000 chars'),
  durationSec: z.number().int().positive().nullish(),
  exercises: z.array(workoutExerciseSchema).default([]),
});

// PATCH semantics: omitted fields stay UNCHANGED. `exercises`, when present,
// replaces the workout's exercise list wholesale.
// Deliberately not derived via .partial() from the create schema: .partial()
// keeps .default()s firing for omitted keys, which silently reset status and
// wiped the exercise list on minimal-diff updates.
export const workoutUpdateSchema = z.object({
  date: flexibleDateTimeSchema.optional(),
  name: z.string().max(200).nullish(),
  status: workoutStatusSchema.optional(),
  mode: z.enum(['strength', 'hypertrophy', 'endurance', 'power']).nullish(),
  notes: z.string().max(10000).nullish().describe('markdown supported, max 10000 chars'),
  durationSec: z.number().int().positive().nullish(),
  exercises: z.array(workoutExerciseSchema).optional().describe('when present, REPLACES the full exercise list'),
});

export const workoutListQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: workoutStatusSchema.optional(),
  exerciseId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const exerciseListQuerySchema = z.object({
  search: z.string().optional(),
  muscle: z.string().optional(),
  equipment: z.string().optional(),
  category: z.enum(['strength', 'cardio', 'stretch']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

export type WorkoutCreate = z.infer<typeof workoutCreateSchema>;
export type WorkoutUpdate = z.infer<typeof workoutUpdateSchema>;
