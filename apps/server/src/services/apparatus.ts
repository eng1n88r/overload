// Derives the specific apparatus (machine, station, bench, bar...) an
// exercise needs from its name + catalog equipment bucket. free-exercise-db
// only carries broad buckets ('machine', 'cable', 'other'); the actual
// station is encoded in the exercise name. One apparatus per exercise — for
// multi-apparatus lifts the scarcest item wins (e.g. Box Squat -> plyo box).

interface Rule {
  re: RegExp;
  apparatus: string;
  /** Restrict the rule to specific catalog equipment buckets. */
  equipment?: string[];
}

// Ordered: first match wins.
const RULES: Rule[] = [
  // --- named machines ---
  { re: /smith/, apparatus: 'smith machine' },
  { re: /leg press|calf press/, apparatus: 'leg press' },
  { re: /hack squat|lying machine squat/, apparatus: 'hack squat machine' },
  { re: /leg extension/, apparatus: 'leg extension machine' },
  { re: /leg curl/, apparatus: 'leg curl machine', equipment: ['machine'] },
  { re: /calf raise|calf-machine|donkey calf/, apparatus: 'calf raise machine', equipment: ['machine', 'other'] },
  { re: /butterfly|pec deck|machine flye/, apparatus: 'pec deck' },
  { re: /chest press|bench press/, apparatus: 'chest press machine', equipment: ['machine'] },
  { re: /shoulder|military/, apparatus: 'shoulder press machine', equipment: ['machine'] },
  { re: /row|shrug|deadlift/, apparatus: 'row machine', equipment: ['machine'] },
  { re: /preacher|bicep curl/, apparatus: 'biceps curl machine', equipment: ['machine'] },
  { re: /triceps|dip machine/, apparatus: 'triceps machine', equipment: ['machine'] },
  { re: /ab crunch machine/, apparatus: 'ab crunch machine' },
  { re: /thigh abductor|thigh adductor/, apparatus: 'hip abductor-adductor machine' },
  { re: /glute ham|reverse hyper/, apparatus: 'glute ham developer' },
  { re: /hyperextension/, apparatus: 'back extension bench' },

  // --- cardio machines ---
  { re: /treadmill/, apparatus: 'treadmill' },
  { re: /bicycling, stationary|recumbent bike/, apparatus: 'stationary bike' },
  { re: /elliptical/, apparatus: 'elliptical' },
  { re: /stairmaster|step mill/, apparatus: 'stair machine' },
  { re: /rowing, stationary/, apparatus: 'rowing machine' },

  // --- cable stations ---
  { re: /pulldown/, apparatus: 'lat pulldown', equipment: ['cable'] },
  { re: /./, apparatus: 'cable station', equipment: ['cable'] },

  // --- benches, racks, bars, stations ---
  { re: /bench dip/, apparatus: 'bench' },
  { re: /\brings?\b/, apparatus: 'rings' },
  { re: /suspended|suspension|with straps/, apparatus: 'suspension trainer' },
  { re: /\bdips?\b|parallel bar/, apparatus: 'dip station' },
  { re: /pull-?ups?|pullups?|chin-?ups?|chins\b|sternum chin|hanging|muscle up|rocky pull|london bridges/, apparatus: 'pull-up bar' },
  { re: /\bsled\b|prowler/, apparatus: 'sled' },
  { re: /trap bar/, apparatus: 'trap bar' },
  { re: /\bplate\b/, apparatus: 'weight plates' },
  { re: /ab roller|ab wheel/, apparatus: 'ab wheel' },
  { re: /battling ropes|battle rope/, apparatus: 'battle ropes' },
  { re: /box (jump|squat|skip|shuffle)|high box|bench jump/, apparatus: 'plyo box' },
  { re: /preacher/, apparatus: 'preacher bench' },
  { re: /\bsquat\b|good morning/, apparatus: 'squat rack', equipment: ['barbell'] },
  { re: /bench|incline|decline/, apparatus: 'bench', equipment: ['barbell', 'dumbbell', 'e-z curl bar', 'other', 'body only'] },

  // pull-up-bar movements hiding under 'other'
  { re: /band assisted pull-up/, apparatus: 'pull-up bar' },
];

/**
 * @param name catalog exercise name
 * @param equipment raw free-exercise-db equipment bucket (before seed mapping)
 */
export function deriveApparatus(name: string, equipment: string | null): string | null {
  const n = name.toLowerCase();
  for (const rule of RULES) {
    if (rule.equipment && !rule.equipment.includes(equipment ?? '')) continue;
    if (rule.re.test(n)) return rule.apparatus;
  }
  return null;
}
