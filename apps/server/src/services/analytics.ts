import { prisma } from '../lib/prisma.js';

export function epleyE1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Every week-start from `from` to `to` inclusive; empty if `from` is after `to`. */
export function weekRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

interface SetWithMuscles {
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
  multiplier: number;
  date: Date;
  exerciseId: string;
  exerciseName: string;
  category: string;
  muscles: { muscle: string; role: string }[];
}

async function loadCompletedSets(userId: string, since?: Date): Promise<SetWithMuscles[]> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      status: 'completed',
      ...(since ? { date: { gte: since } } : {}),
    },
    include: {
      exercises: {
        include: {
          exercise: { select: { id: true, name: true, category: true, muscles: true } },
          sets: true,
        },
      },
    },
  });
  const rows: SetWithMuscles[] = [];
  for (const w of workouts) {
    for (const we of w.exercises) {
      for (const s of we.sets) {
        rows.push({
          reps: s.reps,
          weightKg: s.weightKg,
          isWarmup: s.isWarmup,
          multiplier: s.multiplier,
          date: w.date,
          exerciseId: we.exercise.id,
          exerciseName: we.exercise.name,
          category: we.exercise.category,
          muscles: we.exercise.muscles.map((m) => ({ muscle: m.muscle, role: m.role })),
        });
      }
    }
  }
  return rows;
}

function setVolume(s: SetWithMuscles): number {
  return (s.reps ?? 0) * (s.weightKg ?? 0) * (s.multiplier || 1);
}

export async function getWeeklyVolume(userId: string, weeks: number) {
  const since = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000);
  const sets = await loadCompletedSets(userId, since);
  const byWeek = new Map<string, { volumeKg: number; sets: number; workoutDates: Set<string> }>();
  for (const s of sets) {
    const wk = weekStart(s.date);
    const entry = byWeek.get(wk) ?? { volumeKg: 0, sets: 0, workoutDates: new Set<string>() };
    if (!s.isWarmup) {
      entry.volumeKg += setVolume(s);
      entry.sets += 1;
    }
    entry.workoutDates.add(s.date.toISOString());
    byWeek.set(wk, entry);
  }
  // A week with no training is a zero, not a missing point. Returning only the
  // weeks that happen to have data lets a layoff close over itself, which makes
  // any consistency or trend reading wrong. Same treatment as getMuscleWeeklySets.
  const trained = [...byWeek.keys()].sort();
  const axis = trained.length
    ? weekRange(trained[0], maxWeek(weekStart(new Date()), trained[trained.length - 1]))
    : [];

  return axis.map((week) => {
    const v = byWeek.get(week);
    return {
      week,
      volumeKg: v ? Math.round(v.volumeKg) : 0,
      sets: v ? v.sets : 0,
      workouts: v ? v.workoutDates.size : 0,
    };
  });
}

const maxWeek = (a: string, b: string) => (a > b ? a : b);

export async function getMuscleWeeklySets(userId: string, weeks: number) {
  const since = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000);
  const sets = await loadCompletedSets(userId, since);
  const byMuscle = new Map<string, Map<string, number>>();
  for (const s of sets) {
    if (s.isWarmup || s.category !== 'strength') continue;
    const wk = weekStart(s.date);
    for (const m of s.muscles) {
      const weight = m.role === 'primary' ? 1 : 0.5;
      const weekMap = byMuscle.get(m.muscle) ?? new Map<string, number>();
      weekMap.set(wk, (weekMap.get(wk) ?? 0) + weight);
      byMuscle.set(m.muscle, weekMap);
    }
  }
  // Untrained weeks are zeros, not gaps. Returning only the weeks that happen to
  // have data lets a skipped week vanish from the axis entirely, so the trend line
  // closes over a layoff as if it were continuous. Every muscle shares one axis, so
  // a neglected muscle visibly flatlines next to the ones still being trained.
  const trained = [...byMuscle.values()].flatMap((m) => [...m.keys()]).sort();
  // Start at the user's first training week rather than `weeks` ago: a new account
  // shouldn't be buried under leading zeros it was never around for.
  const axis = trained.length ? weekRange(trained[0], maxWeek(weekStart(new Date()), trained[trained.length - 1])) : [];

  return [...byMuscle.entries()]
    .map(([muscle, weekMap]) => {
      const weekly = axis.map((week) => ({ week, sets: Math.round((weekMap.get(week) ?? 0) * 10) / 10 }));
      const total = weekly.reduce((sum, w) => sum + w.sets, 0);
      return { muscle, weeklyAvg: Math.round((total / axis.length) * 10) / 10, weeks: weekly };
    })
    .sort((a, b) => b.weeklyAvg - a.weeklyAvg);
}

export async function getE1RMSeries(userId: string, exerciseId: string) {
  const entries = await prisma.workoutExercise.findMany({
    where: { exerciseId, workout: { userId, status: 'completed' } },
    include: { workout: { select: { date: true } }, sets: true },
    orderBy: { workout: { date: 'asc' } },
  });
  const series: { date: string; e1rm: number; topWeightKg: number; topSetReps: number; volumeKg: number }[] = [];
  for (const we of entries) {
    let best = 0;
    let topWeight = 0;
    let topReps = 0;
    let volume = 0;
    for (const s of we.sets) {
      if (s.isWarmup || !s.reps || !s.weightKg) continue;
      const e = epleyE1RM(s.weightKg, Math.min(s.reps, 12));
      volume += s.reps * s.weightKg * (s.multiplier || 1);
      if (e > best) {
        best = e;
        topWeight = s.weightKg;
        topReps = s.reps;
      }
    }
    if (best > 0) {
      series.push({
        date: we.workout.date.toISOString().slice(0, 10),
        e1rm: Math.round(best * 10) / 10,
        topWeightKg: topWeight,
        topSetReps: topReps,
        volumeKg: Math.round(volume),
      });
    }
  }
  return series;
}

export async function getPRs(userId: string, limit = 15) {
  const sets = await loadCompletedSets(userId);
  const byExercise = new Map<
    string,
    { name: string; sessions: Set<string>; maxWeightKg: number; bestE1rm: number; bestE1rmDate: string; lastDate: string }
  >();
  for (const s of sets) {
    if (s.isWarmup || !s.reps || !s.weightKg) continue;
    const key = s.exerciseId;
    const day = s.date.toISOString().slice(0, 10);
    const entry =
      byExercise.get(key) ??
      ({ name: s.exerciseName, sessions: new Set(), maxWeightKg: 0, bestE1rm: 0, bestE1rmDate: day, lastDate: day } as const as {
        name: string; sessions: Set<string>; maxWeightKg: number; bestE1rm: number; bestE1rmDate: string; lastDate: string;
      });
    entry.sessions.add(day);
    entry.maxWeightKg = Math.max(entry.maxWeightKg, s.weightKg);
    const e = epleyE1RM(s.weightKg, Math.min(s.reps, 12));
    if (e > entry.bestE1rm) {
      entry.bestE1rm = e;
      entry.bestE1rmDate = day;
    }
    if (day > entry.lastDate) entry.lastDate = day;
    byExercise.set(key, entry);
  }
  return [...byExercise.entries()]
    .map(([exerciseId, e]) => ({
      exerciseId,
      name: e.name,
      sessions: e.sessions.size,
      maxWeightKg: e.maxWeightKg,
      bestE1rm: Math.round(e.bestE1rm * 10) / 10,
      bestE1rmDate: e.bestE1rmDate,
      lastDate: e.lastDate,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}
