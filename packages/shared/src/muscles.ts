// Canonical muscle list — matches the muscle grouping used by the user's
// training-history export analysis, so imported/MCP-created data lines up
// with analytics.
export const MUSCLES = [
  'abs',
  'abductors',
  'adductors',
  'neck',
  'biceps',
  'calves',
  'chest',
  'upper_chest',
  'forearms',
  'front_delts',
  'side_delts',
  'rear_delts',
  'shoulders',
  'glutes',
  'hamstrings',
  'hip_flexors',
  'lats',
  'upper_back',
  'lower_back',
  'obliques',
  'quads',
  'traps',
  'triceps',
] as const;

export type Muscle = (typeof MUSCLES)[number];

// Equipment values present in the free-exercise-db catalog. Custom exercises
// may introduce new strings; UI pickers render this list.
export const EQUIPMENT = [
  'bodyweight',
  'dumbbells',
  'barbell',
  'resistance band',
  'EZ-bar',
  'medicine ball',
  'machine',
  'cable',
  'kettlebell',
  'exercise ball',
  'foam roll',
  'other',
] as const;

export type Equipment = (typeof EQUIPMENT)[number];
