import { describe, expect, it } from 'vitest';
import {
  MODE_CONFIG,
  bestE1RM,
  incrementFor,
  nextTarget,
  repMaxWeight,
  repRangeFor,
  warmupRamp,
} from './progression.js';

const hyp = (sets: { reps: number; weightKg: number }[]) => ({ sets });

describe('mode configuration follows guidelines', () => {
  it('assigns rep ranges by mode and mechanic', () => {
    expect(repRangeFor('compound', 'strength')).toEqual({ low: 3, high: 6 });
    expect(repRangeFor('isolation', 'strength')).toEqual({ low: 6, high: 10 });
    expect(repRangeFor('compound', 'hypertrophy')).toEqual({ low: 6, high: 10 });
    expect(repRangeFor('isolation', 'hypertrophy')).toEqual({ low: 10, high: 15 });
    expect(repRangeFor('compound', 'endurance')).toEqual({ low: 15, high: 20 });
    expect(repRangeFor('compound', 'power')).toEqual({ low: 3, high: 5 });
    expect(repRangeFor(null, 'hypertrophy')).toEqual({ low: 6, high: 10 }); // unknown mechanic -> compound
  });

  it('orders rest periods strength/power > hypertrophy > endurance', () => {
    expect(MODE_CONFIG.strength.restSec).toBeGreaterThan(MODE_CONFIG.hypertrophy.restSec);
    expect(MODE_CONFIG.power.restSec).toBeGreaterThan(MODE_CONFIG.hypertrophy.restSec);
    expect(MODE_CONFIG.hypertrophy.restSec).toBeGreaterThan(MODE_CONFIG.endurance.restSec);
  });

  it('maps equipment and mode to increments', () => {
    expect(incrementFor('barbell')).toBe(2.5);
    expect(incrementFor('barbell', 'strength', true)).toBe(5); // lower-body strength
    expect(incrementFor('barbell', 'strength', false)).toBe(2.5);
    expect(incrementFor('dumbbells', 'strength', true)).toBe(2);
    expect(incrementFor('bodyweight')).toBe(0);
  });
});

describe('e1RM math (Epley)', () => {
  it('inverts the estimate: weight for target reps', () => {
    // 100kg x 10 -> e1RM 133.3; the 5-rep max from that is ~114.3
    const e1rm = bestE1RM([hyp([{ reps: 10, weightKg: 100 }])]);
    expect(e1rm).toBeCloseTo(133.33, 1);
    expect(repMaxWeight(e1rm, 5)).toBeCloseTo(114.3, 1);
    expect(repMaxWeight(e1rm, 1)).toBeCloseTo(129.0, 0); // reps capped at 12 in estimate
  });

  it('caps reps at 12 when estimating', () => {
    const from12 = bestE1RM([hyp([{ reps: 12, weightKg: 50 }])]);
    const from20 = bestE1RM([hyp([{ reps: 20, weightKg: 50 }])]);
    expect(from20).toBe(from12);
  });
});

describe('nextTarget: within-mode double progression', () => {
  it('returns defaults with no history', () => {
    const t = nextTarget([], 'hypertrophy', 'compound', 2.5);
    expect(t).toEqual({ sets: 3, repsLow: 6, repsHigh: 10, weightKg: null, deload: false });
  });

  it('holds weight while chasing reps below the top of the range', () => {
    const t = nextTarget([hyp([{ reps: 8, weightKg: 60 }, { reps: 7, weightKg: 60 }])], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(60);
    expect(t.deload).toBe(false);
  });

  it('adds weight when all top-weight sets hit the top of the range', () => {
    const t = nextTarget([hyp([{ reps: 10, weightKg: 60 }, { reps: 10, weightKg: 60 }])], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(62.5);
  });

  it('ignores lighter back-off sets when judging top weight', () => {
    const t = nextTarget([hyp([{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: 50 }])], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(62.5);
  });

  it('deloads 10% after three stalled sessions', () => {
    const stalled = hyp([{ reps: 8, weightKg: 80 }]);
    const t = nextTarget([stalled, stalled, stalled], 'hypertrophy', 'compound', 2.5);
    expect(t.deload).toBe(true);
    expect(t.weightKg).toBe(72.5);
  });

  it('does not deload when progress happened within the window', () => {
    const t = nextTarget(
      [hyp([{ reps: 8, weightKg: 80 }]), hyp([{ reps: 9, weightKg: 80 }]), hyp([{ reps: 9, weightKg: 80 }])],
      'hypertrophy',
      'compound',
      2.5,
    );
    expect(t.deload).toBe(false);
    expect(t.weightKg).toBe(80);
  });

  it('does not add weight for bodyweight movements', () => {
    const t = nextTarget([hyp([{ reps: 15, weightKg: 0 }])], 'hypertrophy', 'isolation', 0);
    expect(t.weightKg).toBe(0);
  });

  it('caps the prescription at the e1RM ceiling for the bottom of the range', () => {
    // top of range reached at 60 -> +2.5 would give 62.5; e1RM 66 gives a
    // 6-rep max ceiling of .95 * 66/(1.2) ≈ 52.5 — impossible jump is capped.
    const t = nextTarget([hyp([{ reps: 10, weightKg: 55 }])], 'hypertrophy', 'compound', 2.5);
    const e1rm = bestE1RM([hyp([{ reps: 10, weightKg: 55 }])]);
    const ceiling = Math.round(((0.95 * e1rm) / (1 + 6 / 30)) / 2.5) * 2.5;
    expect(t.weightKg).toBeLessThanOrEqual(ceiling);
  });
});

describe('nextTarget: mode switching anchors to e1RM', () => {
  it('treats adjacent rep counts as the same zone (double progression applies)', () => {
    // 8-rep history entering a 3-6 strength range is only 2 reps off the top:
    // double progression carries the load forward (+2.5 since 8 >= 6).
    const history = [hyp([{ reps: 8, weightKg: 65 }, { reps: 8, weightKg: 65 }])];
    const t = nextTarget(history, 'strength', 'compound', 2.5);
    expect(t.weightKg).toBe(67.5);
    expect(t.repsLow).toBe(3);
    expect(t.repsHigh).toBe(6);
  });

  it('anchors to e1RM when history is clearly from another rep zone', () => {
    // 12x50 hypertrophy history -> e1RM 70; strength anchor .95 * 70 / 1.2 = 55.4 -> 55
    const history = [hyp([{ reps: 12, weightKg: 50 }, { reps: 12, weightKg: 50 }])];
    const t = nextTarget(history, 'strength', 'compound', 2.5);
    expect(t.weightKg).toBe(55);
    expect(t.weightKg!).toBeGreaterThan(50);
  });

  it('prescribes a lighter weight for an endurance session', () => {
    const history = [hyp([{ reps: 8, weightKg: 65 }, { reps: 8, weightKg: 65 }])];
    const e1rm = bestE1RM(history);
    const t = nextTarget(history, 'endurance', 'compound', 2.5);
    const expected = Math.round(((0.9 * e1rm) / (1 + 20 / 30)) / 2.5) * 2.5;
    expect(t.weightKg).toBe(expected);
    expect(t.weightKg!).toBeLessThan(65);
  });
});

describe('nextTarget: power mode', () => {
  const history = [hyp([{ reps: 5, weightKg: 100 }])]; // e1RM ≈ 116.7

  it('prescribes ~50% of e1RM regardless of last session weight', () => {
    const t = nextTarget(history, 'power', 'compound', 2.5);
    const e1rm = bestE1RM(history);
    expect(t.weightKg).toBe(Math.round((0.5 * e1rm) / 2.5) * 2.5);
    expect(t.weightKg!).toBeLessThan(100);
    expect(t.repsLow).toBe(3);
    expect(t.repsHigh).toBe(5);
  });

  it('never deloads (loads are submaximal by design)', () => {
    const stalled = hyp([{ reps: 5, weightKg: 60 }]);
    const t = nextTarget([stalled, stalled, stalled], 'power', 'compound', 2.5);
    expect(t.deload).toBe(false);
  });

  it('returns no weight without history to estimate from', () => {
    const t = nextTarget([], 'power', 'compound', 2.5);
    expect(t.weightKg).toBeNull();
  });
});

describe('warmupRamp', () => {
  it('ramps 40/60/80% toward the working weight', () => {
    expect(warmupRamp(100)).toEqual([
      { reps: 5, weightKg: 40 },
      { reps: 3, weightKg: 60 },
      { reps: 2, weightKg: 80 },
    ]);
  });

  it('skips the ramp for light working weights', () => {
    expect(warmupRamp(35)).toEqual([]);
  });
});
