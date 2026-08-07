import { MUSCLES } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

// Larger muscle groups recover slower.
const SLOW_MUSCLES = new Set(['quads', 'hamstrings', 'glutes', 'lower_back', 'lats', 'upper_back', 'chest']);

export function tauHours(muscle: string): number {
  return SLOW_MUSCLES.has(muscle) ? 48 : 36;
}

// Fatigue contributed by one working set at the moment it is performed.
// A "fresh" muscle has fatigue below FRESH_THRESHOLD.
const PRIMARY_WEIGHT = 1.0;
const SECONDARY_WEIGHT = 0.5;
export const FRESH_THRESHOLD = 2.0;

export interface MuscleRecovery {
  muscle: string;
  fatigue: number; // decayed set-equivalents still "in the muscle"
  recoveryPct: number; // 100 = fully fresh
  lastTrained: string | null;
}

export interface TrainedExercise {
  category: string;
  workingSets: number;
  muscles: { muscle: string; role: string }[];
}

export interface TrainedWorkout {
  date: Date;
  exercises: TrainedExercise[];
}

/** Pure fatigue model: exponential decay of set-equivalents per muscle. */
export function computeRecovery(workouts: TrainedWorkout[], now: Date): MuscleRecovery[] {
  const fatigue = new Map<string, number>();
  const lastTrained = new Map<string, string>();
  for (const w of workouts) {
    const hoursSince = (now.getTime() - w.date.getTime()) / 3600000;
    if (hoursSince < 0) continue;
    for (const we of w.exercises) {
      if (we.category !== 'strength' || !we.workingSets) continue;
      for (const m of we.muscles) {
        const weight = m.role === 'primary' ? PRIMARY_WEIGHT : SECONDARY_WEIGHT;
        const decayed = we.workingSets * weight * Math.exp(-hoursSince / tauHours(m.muscle));
        fatigue.set(m.muscle, (fatigue.get(m.muscle) ?? 0) + decayed);
        const day = w.date.toISOString();
        if (!lastTrained.has(m.muscle) || day > lastTrained.get(m.muscle)!) {
          lastTrained.set(m.muscle, day);
        }
      }
    }
  }

  return MUSCLES.map((muscle) => {
    const f = fatigue.get(muscle) ?? 0;
    return {
      muscle,
      fatigue: Math.round(f * 100) / 100,
      recoveryPct: Math.max(0, Math.min(100, Math.round((1 - f / (FRESH_THRESHOLD * 2)) * 100))),
      lastTrained: lastTrained.get(muscle) ?? null,
    };
  }).sort((a, b) => a.recoveryPct - b.recoveryPct);
}

export async function getRecoveryState(userId: string, now = new Date()): Promise<MuscleRecovery[]> {
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const workouts = await prisma.workout.findMany({
    where: { userId, status: 'completed', date: { gte: since, lte: now } },
    include: {
      exercises: {
        include: {
          exercise: { select: { category: true, muscles: true } },
          sets: { where: { isWarmup: false } },
        },
      },
    },
  });

  return computeRecovery(
    workouts.map((w) => ({
      date: w.date,
      exercises: w.exercises.map((we) => ({
        category: we.exercise.category,
        workingSets: we.sets.length,
        muscles: we.exercise.muscles.map((m) => ({ muscle: m.muscle, role: m.role })),
      })),
    })),
    now,
  );
}
