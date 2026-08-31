import { describe, expect, it } from 'vitest';
import { effectiveReps } from '../analytics.js';
import {
  MODE_CONFIG,
  baseStepKg,
  bestE1RM,
  incrementFor,
  nextTarget,
  repMaxWeight,
  repRangeFor,
  snapKg,
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

describe('prescriptions land on plates the lifter owns', () => {
  const LB = 0.45359237;
  /** kg back to lb, to the tenth the UI would print. */
  const lb = (kg: number | null) => Math.round((kg ?? 0) / LB * 10) / 10;

  it('rounds an lb lifter onto whole 5 lb steps, not a converted kg grid', () => {
    // The bug: 16 kg is a tidy kg number that displays as 35.3 lb.
    for (const kg of [16, 22.5, 37.5, 61.235]) {
      const snapped = snapKg(kg, 'lb');
      expect(lb(snapped) % 5).toBe(0);
    }
  });

  it('leaves a kg lifter on the 2.5 kg grid they already had', () => {
    expect(baseStepKg('kg')).toBe(2.5);
    for (const kg of [16, 22.4, 61.3]) {
      expect(snapKg(kg, 'kg') % 2.5).toBe(0);
    }
  });

  it('steps dumbbells by 5 lb for an lb lifter and 2 kg for a kg one', () => {
    expect(lb(incrementFor('dumbbells', 'hypertrophy', false, 'lb'))).toBe(5);
    expect(incrementFor('dumbbells', 'hypertrophy', false, 'kg')).toBe(2.0);
  });

  it('jumps double on lower-body strength work, in either unit', () => {
    expect(lb(incrementFor('barbell', 'strength', true, 'lb'))).toBe(10);
    expect(incrementFor('barbell', 'strength', true, 'kg')).toBe(5);
  });

  it('loads nothing for bodyweight and bands whatever the unit', () => {
    for (const unit of ['kg', 'lb'] as const) {
      expect(incrementFor('bodyweight', 'hypertrophy', false, unit)).toBe(0);
      expect(incrementFor('resistance band', 'hypertrophy', false, unit)).toBe(0);
    }
  });

  it('keeps a progressed target loadable for an lb lifter', () => {
    // Top of the range hit twice -> add a step. The result must still be
    // something you can put on a bar.
    const history = [hyp([{ reps: 10, weightKg: 16 }, { reps: 10, weightKg: 16 }])];
    const inc = incrementFor('dumbbells', 'hypertrophy', false, 'lb');
    const t = nextTarget(history, 'hypertrophy', 'compound', inc, 'lb');
    expect(lb(t.weightKg) % 5).toBe(0);
  });

  it('keeps a deload loadable for an lb lifter', () => {
    const stalled = hyp([{ reps: 6, weightKg: 40 }]);
    const t = nextTarget([stalled, stalled, stalled], 'hypertrophy', 'compound',
      incrementFor('barbell', 'hypertrophy', false, 'lb'), 'lb');
    expect(t.deload).toBe(true);
    expect(lb(t.weightKg) % 5).toBe(0);
  });

  it('defaults to kg when no unit is given, so existing callers are unchanged', () => {
    expect(incrementFor('barbell')).toBe(2.5);
    expect(incrementFor('dumbbells')).toBe(2.0);
  });
});

describe('plan templates carry loads written in some other grid', () => {
  const LB = 0.45359237;
  const lb = (kg: number) => Math.round(kg / LB * 10) / 10;

  // The generator was fixed but plan templates still held kg-rounded loads
  // that overrode it, so 16 kg went on prescribing 35.3 lb.
  it('snaps a stored template load onto the lifter\'s grid', () => {
    expect(lb(snapKg(16, 'lb'))).toBe(35);
    expect(lb(snapKg(11.3, 'lb'))).toBe(25);
    expect(lb(snapKg(22.5, 'lb'))).toBe(50);
  });

  it('leaves a kg lifter\'s stored template load on the kg grid', () => {
    expect(snapKg(16, 'kg')).toBe(15);
    expect(snapKg(11.3, 'kg')).toBe(12.5);
    expect(snapKg(22.5, 'kg')).toBe(22.5);
  });
});

describe('effort ratings feed the prescription', () => {
  /** A session of `n` sets at one weight, optionally rated. */
  const sesh = (reps: number, weightKg: number, rpe?: number, n = 2) => ({
    sets: Array.from({ length: n }, () => ({ reps, weightKg, rpe: rpe ?? null })),
  });
  const inc = incrementFor('barbell', 'hypertrophy', false, 'kg'); // 2.5

  describe('effectiveReps: an unrated set is still assumed to be to failure', () => {
    it('leaves unrated reps alone, which is what Epley always assumed', () => {
      expect(effectiveReps(8, null)).toBe(8);
      expect(effectiveReps(8, undefined)).toBe(8);
    });

    it('adds the reps in reserve the rating claims', () => {
      expect(effectiveReps(8, 10)).toBe(8); // nothing left
      expect(effectiveReps(8, 9)).toBe(9); // 1 left
      expect(effectiveReps(8, 8)).toBe(10); // 2 left
      expect(effectiveReps(8, 6)).toBe(12); // 4 left
    });

    it('caps at the rep count where the estimate stops meaning anything', () => {
      expect(effectiveReps(12, 6)).toBe(12);
      expect(effectiveReps(20, 8)).toBe(12);
    });

    it('never takes reps away, however the rating arrives', () => {
      expect(effectiveReps(8, 11)).toBe(8);
      expect(effectiveReps(8, 1)).toBe(12); // clamped to 4 in reserve
    });
  });

  describe('the size of the jump follows the rating', () => {
    it('adds one step unrated, exactly as before', () => {
      const t = nextTarget([sesh(10, 60)], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.weightKg).toBe(62.5);
    });

    it('adds two steps when every top set was easy', () => {
      const t = nextTarget([sesh(10, 60, 6)], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.weightKg).toBe(65);
    });

    it('holds the weight when the top of the range was a grind', () => {
      const t = nextTarget([sesh(10, 60, 9)], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.weightKg).toBe(60);
    });

    it('takes the hardest of the top sets, not the kindest', () => {
      // One set flew, the next was a grind. The grind decides.
      const mixed = { sets: [{ reps: 10, weightKg: 60, rpe: 6 }, { reps: 10, weightKg: 60, rpe: 9 }] };
      expect(nextTarget([mixed], 'hypertrophy', 'compound', inc, 'kg').weightKg).toBe(60);
    });

    it('does not add weight below the top of the range, however easy it felt', () => {
      const t = nextTarget([sesh(7, 60, 6)], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.weightKg).toBe(60);
    });
  });

  describe('stalls', () => {
    it('still deloads after three flat sessions when nothing was rated', () => {
      const flat = sesh(8, 60);
      const t = nextTarget([flat, flat, flat], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.deload).toBe(true);
      expect(t.weightKg).toBe(55);
    });

    it('deloads after only two sessions of grinding', () => {
      const grind = sesh(8, 60, 10);
      const t = nextTarget([grind, grind], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.deload).toBe(true);
      expect(t.weightKg).toBe(55);
    });

    it('does not deload three flat sessions that all felt easy', () => {
      const easy = sesh(8, 60, 6);
      const t = nextTarget([easy, easy, easy], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.deload).toBe(false);
    });

    it('does not call it grinding when the second session improved', () => {
      const t = nextTarget([sesh(8, 60, 10), sesh(9, 60, 10)], 'hypertrophy', 'compound', inc, 'kg');
      expect(t.deload).toBe(false);
    });
  });

  describe('the e1RM anchor', () => {
    it('reads a rated set as the harder effort it was', () => {
      // 8 x 60 at RPE 8 is a 10-rep effort: a higher e1RM, so a higher ceiling.
      const rated = bestE1RM([sesh(8, 60, 8)]);
      const unrated = bestE1RM([sesh(8, 60)]);
      expect(rated).toBeGreaterThan(unrated);
      expect(rated).toBeCloseTo(60 * (1 + 10 / 30), 5);
      expect(unrated).toBeCloseTo(60 * (1 + 8 / 30), 5);
    });
  });
});

describe('nextTarget: the rep floor is a session aim', () => {
  it('asks for one more rep when the weight repeats', () => {
    // 8 reps mid-range (6-10 compound): weight holds, the floor moves to 9 —
    // the number the logger prefills.
    const t = nextTarget([hyp([{ reps: 8, weightKg: 40 }])], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(40);
    expect(t.repsLow).toBe(9);
    expect(t.repsHigh).toBe(10);
  });

  it('caps the aim at the top of the range', () => {
    // Top of the range held at RPE 9: the weight stays, and so does the aim —
    // there is no 11 in a 6-10 prescription.
    const t = nextTarget([{ sets: [{ reps: 10, weightKg: 40, rpe: 9 }] }], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(40);
    expect(t.repsLow).toBe(10);
  });

  it('resets the aim to the bottom of the range after a weight jump', () => {
    const t = nextTarget([hyp([{ reps: 10, weightKg: 40 }])], 'hypertrophy', 'compound', 2.5);
    expect(t.weightKg).toBe(42.5);
    expect(t.repsLow).toBe(6);
  });
});
