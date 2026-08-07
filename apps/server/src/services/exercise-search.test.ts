import { describe, expect, it } from 'vitest';
import { searchExercises, type SearchableExercise } from './exercise-search.js';

const CATALOG: SearchableExercise[] = [
  { id: 'One-Arm_Dumbbell_Row', name: 'One-Arm Dumbbell Row' },
  { id: 'Bent_Over_Barbell_Row', name: 'Bent Over Barbell Row' },
  { id: 'Chest-Supported_Dumbbell_Row', name: 'Chest-Supported Dumbbell Row' },
  { id: 'Chin-Up', name: 'Chin-Up' },
  { id: 'Pullups', name: 'Pullups' },
  { id: 'Barbell_Full_Squat', name: 'Barbell Full Squat' },
  { id: 'Dumbbell_Goblet_Squat', name: 'Dumbbell Goblet Squat' },
  { id: 'Triceps_Pushdown', name: 'Triceps Pushdown' },
];

const names = (q: string) => searchExercises(q, CATALOG).map((m) => m.name);

describe('searchExercises', () => {
  it('matches across punctuation', () => {
    expect(names('one arm dumbbell row')[0]).toBe('One-Arm Dumbbell Row');
    expect(names('chest supported row')[0]).toBe('Chest-Supported Dumbbell Row');
  });

  it('expands synonyms', () => {
    expect(names('db row')).toContain('One-Arm Dumbbell Row');
    expect(names('chinup')[0]).toBe('Chin-Up');
    expect(names('pull-up')).toContain('Pullups');
  });

  it('requires all tokens to match', () => {
    expect(names('barbell row')).toEqual(['Bent Over Barbell Row']);
    expect(names('cable row')).toEqual([]);
  });

  it('ranks closer name lengths first', () => {
    expect(names('squat')[0]).toBe('Barbell Full Squat');
    expect(names('goblet squat')[0]).toBe('Dumbbell Goblet Squat');
  });

  it('returns empty for empty queries', () => {
    expect(names('')).toEqual([]);
  });
});
