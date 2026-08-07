import { describe, expect, it } from 'vitest';
import { computeRecovery, tauHours, type TrainedWorkout } from './recovery.js';

const NOW = new Date('2026-07-27T12:00:00Z');

function workout(hoursAgo: number, muscle: string, sets: number, role = 'primary'): TrainedWorkout {
  return {
    date: new Date(NOW.getTime() - hoursAgo * 3600000),
    exercises: [{ category: 'strength', workingSets: sets, muscles: [{ muscle, role }] }],
  };
}

function pct(result: ReturnType<typeof computeRecovery>, muscle: string) {
  return result.find((m) => m.muscle === muscle)!.recoveryPct;
}

describe('computeRecovery', () => {
  it('reports 100% for untrained muscles', () => {
    const r = computeRecovery([], NOW);
    expect(r.every((m) => m.recoveryPct === 100)).toBe(true);
    expect(r.every((m) => m.lastTrained === null)).toBe(true);
  });

  it('fatigues a just-trained muscle heavily', () => {
    const r = computeRecovery([workout(0, 'chest', 10)], NOW);
    expect(pct(r, 'chest')).toBeLessThan(20);
  });

  it('recovers over time with exponential decay', () => {
    const now = pct(computeRecovery([workout(0, 'chest', 6)], NOW), 'chest');
    const later = pct(computeRecovery([workout(48, 'chest', 6)], NOW), 'chest');
    const muchLater = pct(computeRecovery([workout(120, 'chest', 6)], NOW), 'chest');
    expect(later).toBeGreaterThan(now);
    expect(muchLater).toBeGreaterThan(later);
    expect(muchLater).toBeGreaterThan(85);
  });

  it('weights secondary muscles at half', () => {
    const primary = pct(computeRecovery([workout(12, 'biceps', 6, 'primary')], NOW), 'biceps');
    const secondary = pct(computeRecovery([workout(12, 'biceps', 6, 'secondary')], NOW), 'biceps');
    expect(secondary).toBeGreaterThan(primary);
  });

  it('gives big muscles a slower recovery (larger tau)', () => {
    expect(tauHours('quads')).toBeGreaterThan(tauHours('biceps'));
    const quads = pct(computeRecovery([workout(36, 'quads', 6)], NOW), 'quads');
    const biceps = pct(computeRecovery([workout(36, 'biceps', 6)], NOW), 'biceps');
    expect(biceps).toBeGreaterThan(quads);
  });

  it('ignores cardio and future workouts', () => {
    const cardio: TrainedWorkout = {
      date: NOW,
      exercises: [{ category: 'cardio', workingSets: 5, muscles: [{ muscle: 'quads', role: 'primary' }] }],
    };
    const future = workout(-5, 'chest', 10);
    const r = computeRecovery([cardio, future], NOW);
    expect(pct(r, 'quads')).toBe(100);
    expect(pct(r, 'chest')).toBe(100);
  });

  it('accumulates fatigue across multiple sessions', () => {
    const one = pct(computeRecovery([workout(24, 'chest', 5)], NOW), 'chest');
    const two = pct(computeRecovery([workout(24, 'chest', 5), workout(48, 'chest', 5)], NOW), 'chest');
    expect(two).toBeLessThan(one);
  });
});
