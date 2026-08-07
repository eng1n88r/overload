// Load .env from the working directory before Prisma Client initialises. Without
// this the generated client falls back to the .env beside the schema, so a seed
// run from the repo root quietly filled a different database than the one just
// migrated. src/index.ts has always done the same.
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { deriveApparatus } from '../src/services/apparatus.js';

const prisma = new PrismaClient();

interface SourceExercise {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

const MUSCLE_MAP: Record<string, string> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'upper_back',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

const EQUIPMENT_MAP: Record<string, string> = {
  'body only': 'bodyweight',
  dumbbell: 'dumbbells',
  kettlebells: 'kettlebell',
  bands: 'resistance band',
  'e-z curl bar': 'EZ-bar',
};

function mapCategory(source: string): string {
  if (source === 'stretching') return 'stretch';
  if (source === 'cardio') return 'cardio';
  return 'strength';
}

// Runs from prisma/seed.ts in dev and from dist/seed.js in the container.
function seedDataFile(name: string): string | undefined {
  return [`./seed-data/${name}`, `../prisma/seed-data/${name}`]
    .map((p) => fileURLToPath(new URL(p, import.meta.url)))
    .find(existsSync);
}

async function upsertCatalogExercise(ex: SourceExercise) {
  const data = {
    name: ex.name,
    category: mapCategory(ex.category),
    sourceCategory: ex.category,
    force: ex.force,
    level: ex.level,
    mechanic: ex.mechanic,
    equipment: EQUIPMENT_MAP[ex.equipment ?? ''] ?? ex.equipment ?? 'other',
    apparatus: deriveApparatus(ex.name, ex.equipment),
    instructions: JSON.stringify(ex.instructions),
    images: JSON.stringify(ex.images),
    isCustom: false,
  };
  await prisma.exercise.upsert({
    where: { id: ex.id },
    update: data,
    create: { id: ex.id, ...data },
  });

  const muscles = [
    ...ex.primaryMuscles.map((m) => ({ muscle: MUSCLE_MAP[m], role: 'primary' })),
    ...ex.secondaryMuscles.map((m) => ({ muscle: MUSCLE_MAP[m], role: 'secondary' })),
  ].filter((m) => m.muscle);

  await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: ex.id } });
  if (muscles.length) {
    await prisma.exerciseMuscle.createMany({
      data: muscles.map((m) => ({ exerciseId: ex.id, ...m })),
    });
  }
}

async function seedExercises() {
  const file = seedDataFile('exercises.json');
  if (!file) throw new Error('exercises.json not found in seed-data');
  const exercises: SourceExercise[] = JSON.parse(readFileSync(file, 'utf-8'));

  // Container startup fast-path: the catalog is already in place; a full
  // re-seed (e.g. after updating seed-data) can be forced with FORCE_SEED=1.
  // The apparatus count guards against skipping after a classifier update
  // that has not been backfilled yet.
  const [existing, withApparatus] = await Promise.all([
    prisma.exercise.count({ where: { isCustom: false } }),
    prisma.exercise.count({ where: { isCustom: false, apparatus: { not: null } } }),
  ]);
  if (existing >= exercises.length && withApparatus > 0 && process.env.FORCE_SEED !== '1') {
    console.log(`Catalog already seeded (${existing} exercises), skipping. Set FORCE_SEED=1 to re-seed.`);
    return;
  }

  for (const ex of exercises) {
    await upsertCatalogExercise(ex);
  }
  console.log(`Seeded ${exercises.length} exercises.`);
}

interface StapleExercise {
  id: string;
  name: string;
  category: string;
  mechanic: string;
  equipment: string;
  apparatus?: string;
  primary: string[];
  secondary: string[];
  images?: string[];
  instructions: string[];
}

/** Curated staples missing from free-exercise-db (home-gym / back-safe basics). */
async function seedStapleExercises() {
  const file = seedDataFile('staple-exercises.json');
  if (!file) return;
  const staples: StapleExercise[] = JSON.parse(readFileSync(file, 'utf-8'));

  // The main catalog owns any shared id: a staple upserted over a catalog
  // exercise wipes its images on every startup. Skip those staples, and
  // restore catalog rows an older seed already clobbered (sourceCategory
  // 'curated' on a catalog id).
  const catalogFile = seedDataFile('exercises.json');
  const catalog: SourceExercise[] = catalogFile ? JSON.parse(readFileSync(catalogFile, 'utf-8')) : [];
  const catalogById = new Map(catalog.map((e) => [e.id, e]));
  const clobbered = await prisma.exercise.findMany({
    where: { sourceCategory: 'curated', id: { in: [...catalogById.keys()] } },
    select: { id: true },
  });
  for (const row of clobbered) {
    await upsertCatalogExercise(catalogById.get(row.id)!);
    console.log(`Restored catalog exercise ${row.id} over stale staple copy.`);
  }

  let seeded = 0;
  for (const ex of staples) {
    if (catalogById.has(ex.id)) continue;
    const data = {
      name: ex.name,
      category: ex.category,
      sourceCategory: 'curated',
      mechanic: ex.mechanic,
      equipment: ex.equipment,
      apparatus: ex.apparatus ?? null,
      instructions: JSON.stringify(ex.instructions),
      images: JSON.stringify(ex.images ?? []),
      isCustom: false,
    };
    try {
      await prisma.exercise.upsert({ where: { id: ex.id }, update: data, create: { id: ex.id, ...data } });
    } catch (e) {
      // A user-created custom exercise (isCustom: true, own cuid) can already occupy this
      // name — the `name` unique constraint rejects the insert even though `id` differs.
      // Keep the user's exercise (it may already be referenced by logged workouts) and
      // skip the catalog duplicate rather than aborting the whole seed/boot.
      if ((e as { code?: string }).code === 'P2002') {
        console.warn(`Skipping staple "${ex.name}" (${ex.id}): name already in use by an existing exercise.`);
        continue;
      }
      throw e;
    }
    await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: ex.id } });
    await prisma.exerciseMuscle.createMany({
      data: [
        ...ex.primary.map((m) => ({ exerciseId: ex.id, muscle: m, role: 'primary' })),
        ...ex.secondary.map((m) => ({ exerciseId: ex.id, muscle: m, role: 'secondary' })),
      ],
    });
    seeded++;
  }
  console.log(`Seeded ${seeded}/${staples.length} staple exercises.`);
}

/**
 * `loadFactor` = implements per rep × sides the rep count covers; it seeds
 * `SetEntry.multiplier`, which scales volume (never e1RM or PRs).
 *
 * Everything not listed stays at the schema default of 1, which is already
 * correct for single-implement work (barbell, cable, machine, EZ-bar) and for
 * unloaded work, where no weight is logged at all. Only dumbbell/kettlebell
 * movements can need something else, and they are confirmed on first use
 * rather than guessed in bulk.
 *
 * The unilateral entries below (×4) reflect holding a pair with the rep count
 * performed per leg. Someone training them with a single dumbbell should use
 * the `update_exercise` MCP tool; this seed never overwrites a value that has
 * already been changed away from the default.
 */
const LOAD_FACTORS: Record<string, number> = {
  Goblet_Squat: 1, // one implement, both legs
  'One-Arm_Dumbbell_Row': 2, // one implement × two sides
  Dumbbell_Floor_Press: 2, // pair, moved together
  Dumbbell_Bench_Press_with_Neutral_Grip: 2,
  Chest_Supported_Dumbbell_Row: 2,
  Standing_Dumbbell_Calf_Raise: 2,
  Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench: 2,
  Hammer_Curls: 2,
  Split_Squat_with_Dumbbells: 4, // pair × two sides
  Dumbbell_Step_Ups: 4,
};

async function seedLoadFactors() {
  let applied = 0;
  const missing: string[] = [];
  for (const [id, loadFactor] of Object.entries(LOAD_FACTORS)) {
    const exists = await prisma.exercise.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      missing.push(id);
      continue;
    }
    // Entries of 1 are documentation — that is already the schema default, so
    // writing it would be a no-op that reports as "applied" on every boot.
    if (loadFactor === 1) continue;
    // Only touch rows still at the default, so a deliberate correction sticks.
    const res = await prisma.exercise.updateMany({
      where: { id, loadFactor: 1 },
      data: { loadFactor },
    });
    if (res.count) applied++;
  }
  console.log(`Load factors: ${applied} newly applied of ${Object.keys(LOAD_FACTORS).length} mapped.`);
  if (missing.length) console.warn(`Load factor ids not in catalog: ${missing.join(', ')}`);
}

/**
 * `defaultUnit` decides whether the live logger offers a reps stepper or a
 * seconds timer. It is a property of the movement, so it belongs on the
 * catalog: a "reps" input on an isometric hold made the user perform 15 hip
 * drops instead of a 15-second side bridge.
 *
 * Stretches are timed structurally. Beyond that only a short curated list of
 * isometric strength movements needs it — everything else is genuinely reps,
 * which is the schema default, so there is no bulk pass. Same shape as
 * LOAD_FACTORS above.
 *
 * Deliberately absent, despite names that suggest otherwise — all verified
 * against their catalog instructions:
 *   Push_Up_to_Side_Plank   dynamic rep
 *   Isometric_Wipers        "shift your body weight" side to side; force=push
 *   Prone_Manual_Hamstring  a partner-resisted curl, though force=static
 *   *_Hang_Clean / *_Snatch "hang" is the start position, not a hold
 *   *_Glute_Bridge / Butt_Lift  dynamic hip thrusts
 *
 * `force: 'static'` is a useful signal but not sufficient on its own (see
 * Prone_Manual_Hamstring), and it misses the carries entirely, so entries
 * stay individually verified rather than swept in by rule.
 */
const TIMED_EXERCISES = [
  'Plank',
  'Side_Bridge',
  'Side_Bridge_Hold',
  'Copenhagen_Plank',
  'Isometric_Chest_Squeezes',
  'Isometric_Neck_Exercise_-_Front_And_Back',
  'Isometric_Neck_Exercise_-_Sides',
  'Farmers_Walk',
  'Rickshaw_Carry',
  'Suitcase_Carry',
  // force='static' in the upstream catalog and confirmed against their
  // instructions ("statically hold ... for time", grip and balance holds).
  'Crucifix',
  'Plate_Pinch',
  'Downward_Facing_Balance',
  'Standing_Olympic_Plate_Hand_Squeeze',
];

async function seedDefaultUnits() {
  // Structural: a stretch is held, never repped.
  const stretches = await prisma.exercise.updateMany({
    where: { category: 'stretch', defaultUnit: 'reps' },
    data: { defaultUnit: 'seconds' },
  });
  // Curated: only touch rows still at the default so a correction sticks.
  const named = await prisma.exercise.updateMany({
    where: { id: { in: TIMED_EXERCISES }, defaultUnit: 'reps' },
    data: { defaultUnit: 'seconds' },
  });
  const total = await prisma.exercise.count({ where: { defaultUnit: 'seconds' } });
  console.log(`Timed exercises: ${stretches.count} stretches + ${named.count} isometric newly set (${total} total).`);
}

async function main() {
  await prisma.appSetting.upsert({
    where: { key: 'registrationOpen' },
    update: {},
    create: { key: 'registrationOpen', value: 'true' },
  });
  await seedExercises();
  await seedStapleExercises();
  await seedLoadFactors();
  await seedDefaultUnits();
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
