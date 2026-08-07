// Standard body measurement sites (weight is tracked separately).
export interface BodyMeasurementType {
  type: string;
  label: string;
  unit: string;
}

export const BODY_MEASUREMENT_TYPES: BodyMeasurementType[] = [
  { type: 'neck', label: 'Neck', unit: 'cm' },
  { type: 'shoulders', label: 'Shoulders', unit: 'cm' },
  { type: 'chest', label: 'Chest', unit: 'cm' },
  { type: 'left_biceps', label: 'Left biceps', unit: 'cm' },
  { type: 'right_biceps', label: 'Right biceps', unit: 'cm' },
  { type: 'left_forearm', label: 'Left forearm', unit: 'cm' },
  { type: 'right_forearm', label: 'Right forearm', unit: 'cm' },
  { type: 'waist', label: 'Waist', unit: 'cm' },
  { type: 'hips', label: 'Hips', unit: 'cm' },
  { type: 'left_thigh', label: 'Left thigh', unit: 'cm' },
  { type: 'right_thigh', label: 'Right thigh', unit: 'cm' },
  { type: 'left_calf', label: 'Left calf', unit: 'cm' },
  { type: 'right_calf', label: 'Right calf', unit: 'cm' },
  { type: 'body_fat_pct', label: 'Body fat %', unit: '%' },
];
