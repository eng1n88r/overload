import type { PlanTemplateItem } from '@overload/shared';
import { prisma } from '../../lib/prisma.js';
import { getRecoveryState } from '../recovery.js';
import {
  MODE_CONFIG,
  baseStepKg,
  incrementFor,
  isLowerBody,
  nextTarget,
  snapKg,
  toDisplayWeight,
  warmupRamp,
  type SessionPerformance,
  type TrainingMode,
  type WeightUnit,
} from './progression.js';

// Deterministic rules engine. Claude does the smarter adjustments via MCP.

const MUSCLE_GROUPS: Record<string, { muscles: string[]; label: string }> = {
  push: { label: 'Push Day', muscles: ['chest', 'front_delts', 'side_delts', 'triceps'] },
  pull: { label: 'Pull Day', muscles: ['lats', 'upper_back', 'rear_delts', 'biceps', 'forearms'] },
  legs: { label: 'Leg Day', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'lower_back'] },
  core: { label: 'Core Day', muscles: ['abs', 'obliques', 'hip_flexors'] },
};

interface GeneratedExercise {
  exerciseId: string;
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
  targetWeightKg: number | null;
  unit: string | null;
  notes: string | null;
}

async function loadHistory(userId: string, exerciseId: string, sessions = 3): Promise<SessionPerformance[]> {
  const entries = await prisma.workoutExercise.findMany({
    where: { exerciseId, workout: { userId, status: 'completed' } },
    include: { workout: { select: { date: true } }, sets: { where: { isWarmup: false } } },
    orderBy: { workout: { date: 'desc' } },
    take: sessions,
  });
  return entries
    .reverse()
    .map((we) => ({
      sets: we.sets
        .filter((s) => s.reps != null && s.weightKg != null)
        .map((s) => ({ reps: s.reps!, weightKg: s.weightKg! })),
    }));
}

async function applyProgression(
  userId: string,
  exerciseId: string,
  mode: TrainingMode,
  unit: WeightUnit,
): Promise<GeneratedExercise> {
  const exercise = await prisma.exercise.findUniqueOrThrow({
    where: { id: exerciseId },
    include: { muscles: { where: { role: 'primary' } } },
  });
  const history = await loadHistory(userId, exerciseId);
  const lowerBody = isLowerBody(exercise.muscles.map((m) => m.muscle));
  const increment = incrementFor(exercise.equipment, mode, lowerBody, unit);
  const target = nextTarget(history, mode, exercise.mechanic, increment, unit);

  const notes: string[] = [];
  if (target.deload) notes.push('Deload: -10% after stall — rebuild with clean reps');
  if (MODE_CONFIG[mode].warmupRamp && exercise.mechanic === 'compound' && target.weightKg) {
    const ramp = warmupRamp(target.weightKg, baseStepKg(unit));
    if (ramp.length) {
      // The note names weights, so it has to name them in the lifter's unit.
      notes.push(`Warm-up: ${ramp.map((r) => `${r.reps}×${toDisplayWeight(r.weightKg, unit)}${unit}`).join(', ')}`);
    }
  }
  if (MODE_CONFIG[mode].cue) notes.push(MODE_CONFIG[mode].cue!);

  return {
    exerciseId,
    targetSets: target.sets,
    targetRepsLow: target.repsLow,
    targetRepsHigh: target.repsHigh,
    targetWeightKg: target.weightKg,
    // Timed movements (planks, carries, stretches) must reach the logger as a
    // seconds input rather than a reps stepper.
    unit: exercise.defaultUnit,
    notes: notes.length ? notes.join(' | ') : null,
  };
}

// Movements from these source categories suit explosive (power) work.
const EXPLOSIVE_CATEGORIES = new Set(['olympic weightlifting', 'plyometrics', 'powerlifting']);

/** Pick exercises for a muscle: familiar lifts first, compounds before isolations.
 *  Power mode restricts to compounds and prefers explosive movement categories. */
async function pickExercises(
  userId: string,
  muscle: string,
  equipment: string[],
  exclude: Set<string>,
  count: number,
  mode: TrainingMode,
): Promise<string[]> {
  const compoundOnly = MODE_CONFIG[mode].compoundOnly ?? false;
  const usage = await prisma.workoutExercise.groupBy({
    by: ['exerciseId'],
    where: { workout: { userId, status: 'completed' } },
    _count: { exerciseId: true },
  });
  const usageMap = new Map(usage.map((u) => [u.exerciseId, u._count.exerciseId]));

  // Availability: broad equipment item must be owned (bodyweight/machine/
  // cable/other pass — their real requirement is the apparatus), and the
  // specific apparatus, when set, must be owned. Empty profile = everything.
  const candidates = await prisma.exercise.findMany({
    where: {
      category: 'strength',
      ...(compoundOnly ? { mechanic: 'compound' } : {}),
      muscles: { some: { muscle, role: 'primary' } },
      ...(equipment.length
        ? {
            equipment: { in: [...equipment, 'bodyweight', 'machine', 'cable', 'other'] },
            OR: [{ apparatus: null }, { apparatus: { in: equipment } }],
          }
        : {}),
    },
    select: { id: true, mechanic: true, name: true, sourceCategory: true },
  });

  const explosive = (c: { sourceCategory: string | null }) =>
    c.sourceCategory !== null && EXPLOSIVE_CATEGORIES.has(c.sourceCategory);

  const ranked = candidates
    .filter((c) => !exclude.has(c.id))
    .sort((a, b) => {
      const useDiff = (usageMap.get(b.id) ?? 0) - (usageMap.get(a.id) ?? 0);
      if (useDiff !== 0) return useDiff;
      if (compoundOnly && explosive(a) !== explosive(b)) return explosive(a) ? -1 : 1;
      if (a.mechanic !== b.mechanic) return a.mechanic === 'compound' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // Prefer one compound first when we take multiple.
  const picked: string[] = [];
  const compound = ranked.find((c) => c.mechanic === 'compound');
  if (compound && count > 0) picked.push(compound.id);
  for (const c of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(c.id)) picked.push(c.id);
  }
  return picked;
}

export interface GenerateOptions {
  date?: Date;
  planDayId?: string;
  muscles?: string[];
  mode?: TrainingMode;
}

export async function generateWorkout(userId: string, opts: GenerateOptions = {}) {
  const date = opts.date ?? new Date();

  // Idempotency for the plain "generate my day" calls the web UI makes (no
  // explicit muscle targeting): a repeat call for a day that already has a
  // pending workout (double-clicked button, retried request, etc.) returns
  // that workout instead of creating a duplicate. Explicit-muscle calls
  // (MCP power-user targeting) are exempt so a session can be deliberately
  // regenerated with different parameters on the same day.
  if (!opts.muscles?.length) {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const existing = await prisma.workout.findFirst({
      where: { userId, status: { in: ['planned', 'in_progress'] }, date: { gte: dayStart, lte: dayEnd } },
    });
    if (existing) return existing.id;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const unit: WeightUnit = user.unitPreference === 'lb' ? 'lb' : 'kg';
  const equipment: string[] = JSON.parse(user.equipment || '[]');
  const userMode = (user.trainingMode as TrainingMode) || 'hypertrophy';

  let name: string;
  let mode: TrainingMode;
  let exercises: GeneratedExercise[] = [];

  if (opts.planDayId) {
    const day = await prisma.planDay.findFirst({
      where: { id: opts.planDayId, plan: { userId } },
      include: { plan: true },
    });
    if (!day) throw Object.assign(new Error('Plan day not found'), { statusCode: 404 });
    name = day.name;
    mode = opts.mode ?? (day.mode as TrainingMode | null) ?? userMode;

    // 1-based week number since plan start; deload weeks run at ~60% sets.
    const weekNumber = Math.max(1, Math.floor((date.getTime() - day.plan.startDate.getTime()) / (7 * 864e5)) + 1);
    const deloadWeeks: number[] = JSON.parse(day.plan.deloadWeeks || '[]');
    const isDeload = deloadWeeks.includes(weekNumber);
    if (isDeload) name = `${name} (deload)`;

    const template: PlanTemplateItem[] = JSON.parse(day.template);
    for (const t of template) {
      const gen = await applyProgression(userId, t.exerciseId, mode, unit);
      let targetSets = t.sets ?? gen.targetSets;
      let targetWeightKg = t.targetWeightKg ?? gen.targetWeightKg;
      if (isDeload) {
        targetSets = Math.max(1, Math.round(targetSets * 0.6));
        // Onto the plate grid, not a 0.5 kg one — a deload still has to be loadable.
        if (targetWeightKg) targetWeightKg = snapKg(targetWeightKg * 0.9, unit);
      }
      const extras = [
        t.notes,
        t.unit === 'seconds' ? 'targets are SECONDS, not reps' : null,
        t.perSide ? 'per side' : null,
        t.rir != null ? `RIR ${t.rir}` : null,
        t.restSec != null ? `rest ${Math.floor(t.restSec / 60)}:${String(t.restSec % 60).padStart(2, '0')}` : null,
        isDeload ? 'deload week — reduced volume' : null,
        gen.notes,
      ].filter(Boolean);
      exercises.push({
        ...gen,
        targetSets,
        targetRepsLow: t.repsLow ?? gen.targetRepsLow,
        targetRepsHigh: t.repsHigh ?? gen.targetRepsHigh,
        targetWeightKg,
        // Structured, so the logger can pick the right input. The prose note
        // above stays as a belt-and-braces cue for humans and agents.
        unit: t.unit ?? gen.unit,
        notes: extras.length ? extras.join(' | ') : null,
      });
    }
  } else {
    mode = opts.mode ?? userMode;
    // Freestyle: pick the freshest muscle group, or honor an explicit muscle list.
    let muscles: string[];
    if (opts.muscles?.length) {
      muscles = opts.muscles;
      name = 'Custom Workout';
    } else {
      const recovery = await getRecoveryState(userId, date);
      const recoveryMap = new Map(recovery.map((r) => [r.muscle, r.recoveryPct]));
      const scored = Object.entries(MUSCLE_GROUPS)
        .filter(([key]) => key !== 'core')
        .map(([key, group]) => ({
          key,
          group,
          score: group.muscles.reduce((a, m) => a + (recoveryMap.get(m) ?? 100), 0) / group.muscles.length,
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      muscles = best.group.muscles;
      name = best.group.label;
    }

    const cap = MODE_CONFIG[mode].maxExercises;
    const exclude = new Set<string>();
    const perMuscle = muscles.length <= 3 ? 2 : 1;
    for (const muscle of muscles.slice(0, 6)) {
      const ids = await pickExercises(userId, muscle, equipment, exclude, perMuscle, mode);
      for (const id of ids) {
        exclude.add(id);
        exercises.push(await applyProgression(userId, id, mode, unit));
      }
      if (exercises.length >= cap) break;
    }
    exercises = exercises.slice(0, cap);
  }

  const workout = await prisma.workout.create({
    data: {
      userId,
      date,
      name,
      mode,
      status: 'planned',
      source: 'generated',
      exercises: {
        create: exercises.map((e, i) => ({
          exerciseId: e.exerciseId,
          order: i,
          targetSets: e.targetSets,
          targetRepsLow: e.targetRepsLow,
          targetRepsHigh: e.targetRepsHigh,
          targetWeightKg: e.targetWeightKg,
          unit: e.unit,
          notes: e.notes,
        })),
      },
    },
  });
  return workout.id;
}
