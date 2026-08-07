// Equipment picker taxonomy. Two kinds of values live side by side in a
// user's equipment profile:
//  - broad equipment items (an exercise's `equipment` field): barbell, ...
//  - specific apparatus (an exercise's `apparatus` field): smith machine, ...
// An exercise is available when its equipment item AND its apparatus (when
// set) are both in the profile. An empty profile allows everything.

export interface EquipmentGroup {
  key: string;
  label: string;
  items: string[];
}

export const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  {
    key: 'free-weights',
    label: 'Free weights',
    items: ['barbell', 'dumbbells', 'EZ-bar', 'kettlebell', 'trap bar', 'weight plates'],
  },
  {
    key: 'benches-racks',
    label: 'Benches & racks',
    items: ['bench', 'preacher bench', 'squat rack', 'back extension bench', 'glute ham developer'],
  },
  {
    key: 'bars-stations',
    label: 'Bars & stations',
    items: ['pull-up bar', 'dip station', 'rings', 'suspension trainer', 'plyo box'],
  },
  {
    key: 'machines',
    label: 'Machines',
    items: [
      'smith machine',
      'leg press',
      'hack squat machine',
      'leg extension machine',
      'leg curl machine',
      'calf raise machine',
      'chest press machine',
      'shoulder press machine',
      'row machine',
      'pec deck',
      'biceps curl machine',
      'triceps machine',
      'ab crunch machine',
      'hip abductor-adductor machine',
    ],
  },
  {
    key: 'cables',
    label: 'Cables',
    items: ['cable station', 'lat pulldown'],
  },
  {
    key: 'cardio-machines',
    label: 'Cardio machines',
    items: ['treadmill', 'stationary bike', 'elliptical', 'stair machine', 'rowing machine'],
  },
  {
    key: 'accessories',
    label: 'Accessories',
    items: ['resistance band', 'medicine ball', 'exercise ball', 'foam roll', 'ab wheel', 'battle ropes', 'sled'],
  },
];

/** Broad equipment values that require an explicit profile entry. The rest
 *  ('bodyweight', 'machine', 'cable', 'other') carry their real requirement
 *  in `apparatus`, or need nothing at all. */
export const EQUIPMENT_ITEMS_REQUIRING_SELECTION = new Set([
  'barbell',
  'dumbbells',
  'EZ-bar',
  'kettlebell',
  'resistance band',
  'medicine ball',
  'exercise ball',
  'foam roll',
]);
