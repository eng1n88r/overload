import { describe, expect, it } from 'vitest';
import { deriveApparatus } from './apparatus.js';

describe('deriveApparatus', () => {
  it('identifies named machines', () => {
    expect(deriveApparatus('Smith Machine Squat', 'machine')).toBe('smith machine');
    expect(deriveApparatus('Leg Press', 'machine')).toBe('leg press');
    expect(deriveApparatus('Hack Squat', 'machine')).toBe('hack squat machine');
    expect(deriveApparatus('Leg Extensions', 'machine')).toBe('leg extension machine');
    expect(deriveApparatus('Seated Leg Curl', 'machine')).toBe('leg curl machine');
    expect(deriveApparatus('Butterfly', 'machine')).toBe('pec deck');
    expect(deriveApparatus('Machine Bench Press', 'machine')).toBe('chest press machine');
    expect(deriveApparatus('Leverage High Row', 'machine')).toBe('row machine');
    expect(deriveApparatus('Thigh Abductor', 'machine')).toBe('hip abductor-adductor machine');
  });

  it('splits cable work into pulldown vs generic station', () => {
    expect(deriveApparatus('Wide-Grip Lat Pulldown', 'cable')).toBe('lat pulldown');
    expect(deriveApparatus('Triceps Pushdown', 'cable')).toBe('cable station');
    expect(deriveApparatus('Cable Crossover', 'cable')).toBe('cable station');
  });

  it('identifies cardio machines but not outdoor variants', () => {
    expect(deriveApparatus('Running, Treadmill', 'machine')).toBe('treadmill');
    expect(deriveApparatus('Bicycling, Stationary', 'machine')).toBe('stationary bike');
    expect(deriveApparatus('Bicycling', 'other')).toBeNull();
  });

  it('detects benches, racks and bars from names', () => {
    expect(deriveApparatus('Barbell Bench Press - Medium Grip', 'barbell')).toBe('bench');
    expect(deriveApparatus('Incline Dumbbell Press', 'dumbbell')).toBe('bench');
    expect(deriveApparatus('Bench Dips', 'body only')).toBe('bench');
    expect(deriveApparatus('Preacher Curl', 'barbell')).toBe('preacher bench');
    expect(deriveApparatus('Barbell Full Squat', 'barbell')).toBe('squat rack');
    expect(deriveApparatus('Pullups', 'body only')).toBe('pull-up bar');
    expect(deriveApparatus('Hanging Leg Raise', 'body only')).toBe('pull-up bar');
    expect(deriveApparatus('Dips - Triceps Version', 'body only')).toBe('dip station');
    expect(deriveApparatus('Box Jump (Multiple Response)', 'other')).toBe('plyo box');
  });

  it('does not confuse hamstrings with rings or pushdown with pulldown', () => {
    expect(deriveApparatus('Seated Band Hamstring Curl', 'other')).toBeNull();
    expect(deriveApparatus('Ring Dips', 'other')).toBe('rings');
    expect(deriveApparatus('Reverse Grip Triceps Pushdown', 'cable')).toBe('cable station');
  });

  it('returns null for plain free-weight and bodyweight movements', () => {
    expect(deriveApparatus('Barbell Curl', 'barbell')).toBeNull();
    expect(deriveApparatus('Push Up', 'body only')).toBeNull();
    expect(deriveApparatus('Dumbbell Lunge', 'dumbbell')).toBeNull();
  });
});
