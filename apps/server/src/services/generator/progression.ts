// Mode-aware progression. Prescriptions follow standard strength-science
// guidelines (ACSM position stand; Schoenfeld et al. on rep ranges and rest):
//
//   strength     3-6 reps @ ~85-95% 1RM, long rests, high sets on compounds
//   hypertrophy  6-10 compound / 10-15 isolation @ ~65-80% 1RM (default)
//   endurance    15-25 reps @ ~40-60% 1RM, short rests, fewer sets
//   power        3-5 reps @ ~50% 1RM moved with max intended velocity
//                (dynamic-effort method), explosive compounds only, never
//                near failure — progression comes from the e1RM rising, not
//                from grinding heavier sets
//
// Weights are anchored to the Epley e1RM estimate (e1RM = w * (1 + r/30)),
// inverted to prescribe a weight for any target rep count:
//   repMaxWeight(reps) = e1RM / (1 + reps/30)
// with an intensity factor below 1 to leave 1-3 reps in reserve. Power uses a
// direct fraction of e1RM instead (bar speed, not proximity to failure).
//
// Within a mode, double progression applies: fill reps to the top of the
// range, then add load and reset. Three sessions without improvement -> -10%
// deload. When history comes from a different rep zone (mode switch), the
// e1RM anchor sets the weight instead of last session's load.

import { effectiveReps, epleyE1RM } from '../analytics.js';

export const TRAINING_MODES = ['strength', 'hypertrophy', 'endurance', 'power'] as const;
export type TrainingMode = (typeof TRAINING_MODES)[number];

export interface SessionPerformance {
  /** Working sets of one past session, oldest session first in the array of sessions. */
  sets: { reps: number; weightKg: number; rpe?: number | null }[];
}

/**
 * How the app reads an effort rating.
 *
 * RPE is a reps-in-reserve claim, so it answers the question the rep count
 * alone cannot: was that the top of the range because it was earned, or
 * because it was a grind? Two thresholds, deliberately far apart, because a
 * self-reported number should only move the prescription when it is emphatic.
 */
const RPE_EASY = 6;      // 4 in reserve — under-loaded, take a double jump
const RPE_HARD = 9;      // 1 in reserve — hold the weight, earn it clean
const RPE_GRINDING = 9.5; // at or past failure two sessions running

export interface RepRange {
  low: number;
  high: number;
}

export interface ProgressionTarget {
  sets: number;
  repsLow: number;
  repsHigh: number;
  weightKg: number | null;
  deload: boolean;
}

interface ModeConfig {
  repRange: { compound: RepRange; isolation: RepRange };
  sets: { compound: number; isolation: number };
  /** Fraction of the estimated rep-max weight to prescribe (reps-in-reserve buffer). */
  intensityPct: number;
  /** Default rest between working sets, seconds. */
  restSec: number;
  /** Freestyle session size cap. */
  maxExercises: number;
  /** Prescribe a warm-up ramp before the working sets of compounds. */
  warmupRamp: boolean;
  /** Prescribe a direct fraction of e1RM instead of the rep-max inversion (power). */
  loadPctOfE1RM?: number;
  /** Restrict freestyle selection to compound movements (power). */
  compoundOnly?: boolean;
  /** Coaching cue attached to every generated exercise in this mode. */
  cue?: string;
}

export const MODE_CONFIG: Record<TrainingMode, ModeConfig> = {
  strength: {
    repRange: { compound: { low: 3, high: 6 }, isolation: { low: 6, high: 10 } },
    sets: { compound: 5, isolation: 3 },
    intensityPct: 0.95,
    restSec: 180,
    maxExercises: 4,
    warmupRamp: true,
  },
  hypertrophy: {
    repRange: { compound: { low: 6, high: 10 }, isolation: { low: 10, high: 15 } },
    sets: { compound: 3, isolation: 3 },
    intensityPct: 0.95,
    restSec: 90,
    maxExercises: 6,
    warmupRamp: false,
  },
  endurance: {
    repRange: { compound: { low: 15, high: 20 }, isolation: { low: 15, high: 25 } },
    sets: { compound: 3, isolation: 2 },
    intensityPct: 0.9,
    restSec: 60,
    maxExercises: 5,
    warmupRamp: false,
  },
  power: {
    repRange: { compound: { low: 3, high: 5 }, isolation: { low: 6, high: 10 } },
    sets: { compound: 4, isolation: 3 },
    intensityPct: 0.95, // only used as fallback; loadPctOfE1RM drives the weight
    restSec: 180,
    maxExercises: 4,
    warmupRamp: false,
    loadPctOfE1RM: 0.5,
    compoundOnly: true,
    cue: 'Power work: move every rep with max intended velocity; stop the set the moment bar speed drops. Never grind.',
  },
};

const LOWER_BODY_MUSCLES = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'lower_back', 'adductors', 'abductors']);

export function isLowerBody(primaryMuscles: string[]): boolean {
  return primaryMuscles.some((m) => LOWER_BODY_MUSCLES.has(m));
}

export type WeightUnit = 'kg' | 'lb';

const KG_PER_LB = 0.45359237;

/**
 * The smallest jump a lifter can actually load, in kg.
 *
 * Everything here computes in kg, but the plates are not metric for everyone.
 * Rounding to a kg grid and converting only for display is what prescribed
 * 35.3 lb on a dumbbell press — 16 kg is a clean number in the wrong currency.
 * Snapping to a grid taken from the lifter's own unit keeps both honest: a kg
 * gym still gets 2.5 kg (a pair of 1.25s), an lb gym gets whole 5 lb.
 */
export function baseStepKg(unit: WeightUnit): number {
  return unit === 'lb' ? 5 * KG_PER_LB : 2.5;
}

/** Round a kg weight onto the lifter's own plate grid. */
export function snapKg(weightKg: number, unit: WeightUnit): number {
  return roundToStep(weightKg, baseStepKg(unit));
}

/** Weight in the lifter's unit, for prose that has to name a number. */
export function toDisplayWeight(weightKg: number, unit: WeightUnit): number {
  return unit === 'lb' ? Math.round(weightKg / KG_PER_LB) : Math.round(weightKg * 2) / 2;
}

export function incrementFor(
  equipment: string,
  mode: TrainingMode = 'hypertrophy',
  lowerBody = false,
  unit: WeightUnit = 'kg',
): number {
  const base = baseStepKg(unit);
  switch (equipment) {
    case 'dumbbells':
    case 'kettlebell':
      // Metric bells commonly step in 2s; imperial ones in 5 lb, which is the
      // base grid already.
      return unit === 'lb' ? base : 2.0;
    case 'bodyweight':
    case 'resistance band':
      return 0;
    default:
      // Heavier absolute loads on lower-body strength work allow bigger jumps.
      return mode === 'strength' && lowerBody ? base * 2 : base;
  }
}

/** Weight at which `reps` is an estimated max effort, from an Epley e1RM. */
export function repMaxWeight(e1rm: number, reps: number): number {
  return e1rm / (1 + reps / 30);
}

function roundToStep(weight: number, step: number): number {
  if (step <= 0) return Math.round(weight * 2) / 2;
  return Math.round(weight / step) * step;
}

interface SessionScore {
  weight: number;
  minReps: number;
  /** Hardest of the top-weight sets, or null when none were rated. The hardest
   *  rather than the average: one easy set does not undo a grind. */
  rpe: number | null;
}

function sessionScore(s: SessionPerformance): SessionScore | null {
  if (!s.sets.length) return null;
  const weight = Math.max(...s.sets.map((x) => x.weightKg));
  const topSets = s.sets.filter((x) => x.weightKg === weight);
  const rated = topSets.map((x) => x.rpe).filter((r): r is number => r != null);
  return {
    weight,
    minReps: Math.min(...topSets.map((x) => x.reps)),
    rpe: rated.length ? Math.max(...rated) : null,
  };
}

function improved(prev: SessionScore, next: SessionScore): boolean {
  return next.weight > prev.weight || (next.weight === prev.weight && next.minReps > prev.minReps);
}

/** Best recent e1RM across the history window (reps capped at 12 — the Epley
 *  estimate loses validity for high-rep sets). */
export function bestE1RM(history: SessionPerformance[]): number {
  let best = 0;
  for (const s of history) {
    for (const set of s.sets) {
      if (set.weightKg > 0 && set.reps > 0) {
        best = Math.max(best, epleyE1RM(set.weightKg, effectiveReps(set.reps, set.rpe)));
      }
    }
  }
  return best;
}

export function repRangeFor(mechanic: string | null, mode: TrainingMode = 'hypertrophy'): RepRange {
  return MODE_CONFIG[mode].repRange[mechanic === 'isolation' ? 'isolation' : 'compound'];
}

export function nextTarget(
  history: SessionPerformance[],
  mode: TrainingMode,
  mechanic: string | null,
  increment: number,
  unit: WeightUnit = 'kg',
): ProgressionTarget {
  const cfg = MODE_CONFIG[mode];
  const kind = mechanic === 'isolation' ? 'isolation' : 'compound';
  const range = cfg.repRange[kind];
  const sets = cfg.sets[kind];
  const base = baseStepKg(unit);
  const step = increment >= base || increment === 0 ? base : increment;

  const scores = history.map(sessionScore).filter((s): s is NonNullable<typeof s> => s !== null);
  const last = scores.at(-1);
  if (!last) {
    return { sets, repsLow: range.low, repsHigh: range.high, weightKg: null, deload: false };
  }

  // Power: always a direct fraction of e1RM — loads are submaximal by design,
  // so double progression and stall/deload logic do not apply. The prescribed
  // weight rises automatically as strength/hypertrophy work raises the e1RM.
  if (cfg.loadPctOfE1RM) {
    const e1rmAll = bestE1RM(history.slice(-3));
    return {
      sets,
      repsLow: range.low,
      repsHigh: range.high,
      weightKg: e1rmAll > 0 ? roundToStep(cfg.loadPctOfE1RM * e1rmAll, step) : null,
      deload: false,
    };
  }

  const deloadTo = (): ProgressionTarget => ({
    sets,
    repsLow: range.low,
    repsHigh: range.high,
    weightKg: Math.max(0, roundToStep(last.weight * 0.9, step)),
    deload: true,
  });

  // Grinding: two sessions at or past failure with nothing gained between them.
  // Waiting for a third is another week of junk volume under a weight that is
  // already too heavy, and the ratings say so plainly.
  if (scores.length >= 2) {
    const [a, b] = scores.slice(-2);
    if (a.rpe != null && b.rpe != null && a.rpe >= RPE_GRINDING && b.rpe >= RPE_GRINDING && !improved(a, b)) {
      return deloadTo();
    }
  }

  // Stalled: three consecutive sessions with no improvement.
  if (scores.length >= 3) {
    const [a, b, c] = scores.slice(-3);
    if (!improved(a, b) && !improved(b, c) && !improved(a, c)) {
      // Unless all three felt easy. Flat and comfortable is not a stall — it is
      // someone repeating a weight they never pushed, and cutting 10% off it
      // takes load away from a lifter who needs more, not less.
      const allEasy = [a, b, c].every((x) => x.rpe != null && x.rpe <= RPE_EASY + 1);
      if (!allEasy) return deloadTo();
    }
  }

  const e1rm = bestE1RM(history.slice(-3));
  // The weight at which the top of the rep range is attainable with reps in reserve.
  const anchor = e1rm > 0 ? roundToStep(cfg.intensityPct * repMaxWeight(e1rm, range.high), step) : null;
  // Absolute ceiling: bottom of the range at max effort — never prescribe above it.
  const ceiling = e1rm > 0 ? roundToStep(cfg.intensityPct * repMaxWeight(e1rm, range.low), step) : null;

  // History from a different rep zone (mode switch): last session's load says
  // nothing about this range, so trust the e1RM anchor.
  const differentZone = last.minReps > range.high + 2 || last.minReps < Math.max(1, range.low - 2);
  if (differentZone && anchor !== null && increment > 0) {
    return { sets, repsLow: range.low, repsHigh: range.high, weightKg: anchor, deload: false };
  }

  // Double progression within the zone, with the rating deciding the size of
  // the jump. Reps alone cannot tell a set that flew from one that nearly
  // buried you, and those two deserve different weights next week.
  let weight: number;
  if (last.minReps >= range.high && increment > 0) {
    const steps = last.rpe == null ? 1
      : last.rpe >= RPE_HARD ? 0
        : last.rpe <= RPE_EASY ? 2
          : 1;
    weight = roundToStep(last.weight + increment * steps, step);
  } else {
    weight = last.weight;
  }
  // Sanity-cap unrealistic jumps against the e1RM — but never prescribe below
  // a weight the lifter already handled (that would be a hidden deload).
  if (ceiling !== null && weight > ceiling) weight = Math.max(ceiling, last.weight);
  // Repeating a weight means the ask is more reps, and the target should say
  // so: the rep floor becomes last session's reps plus one, capped at the top
  // of the range — the number the logger prefills. A fresh jump resets the
  // aim to the bottom of the range, where a new weight is supposed to start.
  const repsLow =
    weight > last.weight ? range.low : Math.min(Math.max(last.minReps + 1, range.low), range.high);
  // Both branches above can hand back `last.weight` untouched, and history is
  // whatever was logged — including the off-grid loads this used to prescribe.
  // A repeat is still a prescription, so it has to be loadable too.
  return { sets, repsLow, repsHigh: range.high, weightKg: roundToStep(weight, step), deload: false };
}

/** Warm-up ramp toward a working weight (strength mode): ~40/60/80% singles
 *  and triples. Skipped for light loads where the empty bar covers it. */
export function warmupRamp(workingWeightKg: number, step = 2.5): { reps: number; weightKg: number }[] {
  if (workingWeightKg < 40) return [];
  return [
    { reps: 5, weightKg: roundToStep(workingWeightKg * 0.4, step) },
    { reps: 3, weightKg: roundToStep(workingWeightKg * 0.6, step) },
    { reps: 2, weightKg: roundToStep(workingWeightKg * 0.8, step) },
  ];
}
