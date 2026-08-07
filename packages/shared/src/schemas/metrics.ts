import { z } from 'zod';
import { num, numeric } from './numeric.js';

export const bodyMetricUpsertSchema = z.object({
  date: z.string().date(),
  type: z.string().min(1).max(50),
  value: numeric(num()),
  unit: z.string().max(20).default('kg'),
});

export const bodyMetricQuerySchema = z.object({
  type: z.string().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export const nutritionUpsertSchema = z.object({
  date: z.string().date(),
  calories: numeric(num().int().min(0)).nullish(),
  proteinG: numeric(num().min(0)).nullish(),
  carbsG: numeric(num().min(0)).nullish(),
  fatG: numeric(num().min(0)).nullish(),
  note: z.string().max(500).nullish(),
});

export const nutritionQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(90),
});
