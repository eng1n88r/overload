import { describe, expect, it } from 'vitest';
import { setEntrySchema, nutritionUpsertSchema, bodyMetricUpsertSchema } from '@overload/shared';

/**
 * Several MCP clients send every scalar as a string, which made `log_set`
 * reject its own arguments ("Expected number, received string at reps").
 * These pin both halves of the fix: numeric strings must be accepted, and
 * blank/garbage must not silently become 0.
 */
describe('numeric coercion at the MCP boundary', () => {
  it('accepts numeric strings on a set (the log_set failure)', () => {
    expect(setEntrySchema.parse({ reps: '10', weightKg: '30.5', multiplier: '2', rpe: '8' })).toMatchObject({
      reps: 10,
      weightKg: 30.5,
      multiplier: 2,
      rpe: 8,
    });
  });

  it('still accepts real numbers unchanged', () => {
    expect(setEntrySchema.parse({ reps: 10, weightKg: 30.5 })).toMatchObject({ reps: 10, weightKg: 30.5 });
  });

  it('preserves null and omitted rather than coercing them to 0', () => {
    const parsed = setEntrySchema.parse({ reps: 10, weightKg: null });
    expect(parsed.weightKg).toBeNull();
    expect(parsed.durationSec).toBeUndefined();
  });

  it('rejects a blank string instead of logging a silent zero', () => {
    // bare z.coerce.number() turns '' into 0, which reads as a logged 0kg set
    expect(setEntrySchema.safeParse({ reps: 10, weightKg: '' }).success).toBe(false);
    expect(setEntrySchema.safeParse({ reps: 10, weightKg: '   ' }).success).toBe(false);
  });

  it('still rejects non-numeric junk', () => {
    expect(setEntrySchema.safeParse({ reps: 'abc' }).success).toBe(false);
  });

  it('enforces constraints after coercion', () => {
    expect(setEntrySchema.safeParse({ reps: '-1' }).success).toBe(false);
    expect(setEntrySchema.safeParse({ rpe: '11' }).success).toBe(false);
    expect(setEntrySchema.safeParse({ multiplier: '0' }).success).toBe(false);
  });

  it('covers log_nutrition and log_body_metric too', () => {
    expect(nutritionUpsertSchema.parse({ date: '2026-08-03', calories: '2000', proteinG: '150' })).toMatchObject({
      calories: 2000,
      proteinG: 150,
    });
    expect(bodyMetricUpsertSchema.parse({ date: '2026-08-03', type: 'weight', value: '82.5' })).toMatchObject({
      value: 82.5,
    });
    expect(nutritionUpsertSchema.safeParse({ date: '2026-08-03', calories: '' }).success).toBe(false);
  });
});
