import type { Prisma } from '@prisma/client';
import type { WorkoutCreate } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

export const workoutInclude = {
  exercises: {
    orderBy: { order: 'asc' },
    include: {
      exercise: { select: { id: true, name: true, category: true, equipment: true, images: true, defaultUnit: true } },
      sets: { orderBy: { order: 'asc' } },
    },
  },
} satisfies Prisma.WorkoutInclude;

export type WorkoutFull = Prisma.WorkoutGetPayload<{ include: typeof workoutInclude }>;

export function serializeWorkout(w: WorkoutFull) {
  return {
    id: w.id,
    date: w.date.toISOString(),
    name: w.name,
    status: w.status,
    source: w.source,
    mode: w.mode,
    externalId: w.externalId,
    notes: w.notes,
    durationSec: w.durationSec,
    exercises: w.exercises.map((we) => ({
      id: we.id,
      order: we.order,
      exerciseId: we.exerciseId,
      exerciseName: we.exercise.name,
      category: we.exercise.category,
      equipment: we.exercise.equipment,
      image: (JSON.parse(we.exercise.images) as string[]).map((p) => `/img/exercises/${p}`)[0] ?? null,
      targetSets: we.targetSets,
      targetRepsLow: we.targetRepsLow,
      targetRepsHigh: we.targetRepsHigh,
      targetWeightKg: we.targetWeightKg,
      // Resolved here so every client agrees: an explicit per-workout unit
      // wins, otherwise the movement's catalog default.
      unit: we.unit ?? we.exercise.defaultUnit,
      notes: we.notes,
      sets: we.sets.map((s) => ({
        id: s.id,
        order: s.order,
        reps: s.reps,
        weightKg: s.weightKg,
        durationSec: s.durationSec,
        distanceM: s.distanceM,
        isWarmup: s.isWarmup,
        multiplier: s.multiplier,
        resistance: s.resistance,
        rpe: s.rpe,
        note: s.note,
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    })),
  };
}

/** exerciseId -> loadFactor, used to seed `SetEntry.multiplier` when a caller omits it. */
export async function loadFactorsFor(exerciseIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(exerciseIds)];
  if (!ids.length) return new Map();
  const rows = await prisma.exercise.findMany({
    where: { id: { in: ids } },
    select: { id: true, loadFactor: true },
  });
  return new Map(rows.map((r) => [r.id, r.loadFactor]));
}

export async function exercisesCreateData(exercises: WorkoutCreate['exercises']) {
  const loadFactors = await loadFactorsFor(exercises.map((e) => e.exerciseId));
  return exercises.map((we, i) => ({
    exerciseId: we.exerciseId,
    order: i,
    targetSets: we.targetSets ?? null,
    targetRepsLow: we.targetRepsLow ?? null,
    targetRepsHigh: we.targetRepsHigh ?? null,
    targetWeightKg: we.targetWeightKg ?? null,
    unit: we.unit ?? null,
    notes: we.notes ?? null,
    sets: {
      create: we.sets.map((s, j) => ({
        order: j,
        reps: s.reps ?? null,
        weightKg: s.weightKg ?? null,
        durationSec: s.durationSec ?? null,
        distanceM: s.distanceM ?? null,
        incline: s.incline ?? null,
        resistance: s.resistance ?? null,
        isWarmup: s.isWarmup,
        multiplier: s.multiplier ?? loadFactors.get(we.exerciseId) ?? 1,
        rpe: s.rpe ?? null,
        note: s.note ?? null,
        completedAt: s.completedAt ? new Date(s.completedAt) : null,
      })),
    },
  }));
}

export async function validateExerciseIds(exercises: WorkoutCreate['exercises']) {
  const ids = [...new Set(exercises.map((e) => e.exerciseId))];
  if (!ids.length) return null;
  const found = await prisma.exercise.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  return missing.length ? missing : null;
}

/**
 * Create a workout for a user; when externalId matches an existing workout,
 * returns it instead of duplicating (idempotent bulk creation).
 */
export async function createWorkoutForUser(
  userId: string,
  body: WorkoutCreate,
): Promise<{ workout: WorkoutFull; created: boolean }> {
  if (body.externalId) {
    const existing = await prisma.workout.findUnique({
      where: { userId_externalId: { userId, externalId: body.externalId } },
      include: workoutInclude,
    });
    if (existing) return { workout: existing, created: false };
  }
  const workout = await prisma.workout.create({
    data: {
      userId,
      date: new Date(body.date),
      name: body.name ?? null,
      status: body.status,
      source: body.source,
      mode: body.mode ?? null,
      externalId: body.externalId ?? null,
      notes: body.notes ?? null,
      durationSec: body.durationSec ?? null,
      exercises: { create: await exercisesCreateData(body.exercises) },
    },
    include: workoutInclude,
  });
  return { workout, created: true };
}
