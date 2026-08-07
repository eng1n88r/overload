import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'user']),
  unitPreference: z.enum(['kg', 'lb']),
  distanceUnitPreference: z.enum(['km', 'mi']),
  trainingMode: z.string().optional(),
  avatar: z.string().nullish(),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
});

export const apiKeyPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

export type ApiKeyPublic = z.infer<typeof apiKeyPublicSchema>;
