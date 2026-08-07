import { describe, expect, it } from 'vitest';
import { epleyE1RM, weekRange, weekStart } from './analytics.js';

describe('epleyE1RM', () => {
  it('returns the weight itself for a single', () => {
    expect(epleyE1RM(100, 1)).toBe(100);
  });
  it('estimates higher 1RM for more reps', () => {
    expect(epleyE1RM(100, 10)).toBeCloseTo(133.33, 1);
  });
  it('returns 0 for zero reps', () => {
    expect(epleyE1RM(100, 0)).toBe(0);
  });
});

describe('weekStart', () => {
  it('maps any weekday to that week Monday (UTC)', () => {
    expect(weekStart(new Date('2026-07-27T10:00:00Z'))).toBe('2026-07-27'); // Monday
    expect(weekStart(new Date('2026-07-29T10:00:00Z'))).toBe('2026-07-27'); // Wednesday
    expect(weekStart(new Date('2026-08-02T23:59:00Z'))).toBe('2026-07-27'); // Sunday
    expect(weekStart(new Date('2026-08-03T00:00:00Z'))).toBe('2026-08-03'); // next Monday
  });
});

describe('weekRange', () => {
  it('fills every week between the endpoints, inclusive', () => {
    expect(weekRange('2026-07-13', '2026-08-03')).toEqual(['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']);
  });
  it('returns the single week when both ends match', () => {
    expect(weekRange('2026-08-03', '2026-08-03')).toEqual(['2026-08-03']);
  });
  it('returns nothing when the range runs backwards', () => {
    expect(weekRange('2026-08-03', '2026-07-27')).toEqual([]);
  });
  it('crosses a DST boundary without drifting off Monday', () => {
    // Europe/US clocks change late October; UTC arithmetic must not slip a day.
    expect(weekRange('2026-10-19', '2026-11-09')).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
  });
});
