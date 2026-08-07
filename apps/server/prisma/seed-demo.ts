/**
 * Demo dataset — the one behind the screenshots in the README.
 *
 * Fills a database with ten weeks of plausible training for a fictional user so
 * the app can be shown, or tried, without anyone publishing their own log. It
 * is deliberately separate from `seed.ts`: that one seeds the exercise catalog
 * every install needs, this one invents a person.
 *
 * Never point it at a database you care about — it deletes the demo user and
 * everything owned by them before rebuilding, and it opens registration.
 *
 *   DATABASE_URL="file:./demo.db" npx prisma migrate deploy
 *   DATABASE_URL="file:./demo.db" npx tsx prisma/seed.ts       # catalog
 *   DATABASE_URL="file:./demo.db" npx tsx prisma/seed-demo.ts  # this file
 */
// Load .env from the working directory before Prisma Client initialises. Without
// this the generated client falls back to the .env beside the schema, so a seed
// run from the repo root quietly filled a different database than the one just
// migrated. src/index.ts has always done the same.
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@overload.example';
const DEMO_PASSWORD = 'overload-demo';
const WEEKS = 10;

/**
 * Deterministic noise. The dataset has to be reproducible: a screenshot that
 * differs run to run cannot be regenerated to match a README that describes it.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = rng(20260807);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const jitter = (n: number, by: number) => n + Math.round((rand() * 2 - 1) * by);

/** Day precision at UTC midnight, matching how the app stores workout dates. */
function dayUTC(daysAgo: number): Date {
  const d = new Date();
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(utc - daysAgo * 86400000);
}

interface Lift {
  id: string;
  sets: number;
  low: number;
  high: number;
  /** Working weight in kg at week 0; omitted for bodyweight and timed work. */
  start?: number;
  /** Weekly increment in kg. */
  step?: number;
  /** Held rather than repped. */
  seconds?: [number, number];
}

interface Day {
  name: string;
  weekday: number;
  muscles: string[];
  lifts: Lift[];
}

const DAYS: Day[] = [
  {
    name: 'Upper A — Press Focus',
    weekday: 0,
    muscles: ['chest', 'shoulders', 'triceps'],
    lifts: [
      { id: 'Barbell_Bench_Press_-_Medium_Grip', sets: 4, low: 5, high: 8, start: 70, step: 1.25 },
      { id: 'Incline_Dumbbell_Press', sets: 3, low: 8, high: 12, start: 24, step: 0.5 },
      { id: 'Standing_Military_Press', sets: 3, low: 6, high: 10, start: 40, step: 1 },
      { id: 'Side_Lateral_Raise', sets: 3, low: 12, high: 15, start: 10, step: 0.25 },
      { id: 'Triceps_Pushdown', sets: 3, low: 10, high: 12, start: 30, step: 0.75 },
    ],
  },
  {
    name: 'Lower A — Squat Focus',
    weekday: 1,
    muscles: ['quads', 'glutes', 'calves'],
    lifts: [
      { id: 'Barbell_Squat', sets: 4, low: 5, high: 8, start: 95, step: 2.5 },
      { id: 'Leg_Press', sets: 3, low: 10, high: 12, start: 160, step: 5 },
      { id: 'Lying_Leg_Curls', sets: 3, low: 10, high: 12, start: 40, step: 1 },
      { id: 'Standing_Calf_Raises', sets: 4, low: 12, high: 15, start: 60, step: 1.5 },
      { id: 'Hanging_Leg_Raise', sets: 3, low: 10, high: 15 },
    ],
  },
  {
    name: 'Upper B — Pull Focus',
    weekday: 3,
    muscles: ['lats', 'upper_back', 'biceps'],
    lifts: [
      { id: 'Pullups', sets: 4, low: 6, high: 10 },
      { id: 'Bent_Over_Barbell_Row', sets: 4, low: 6, high: 10, start: 65, step: 1.25 },
      { id: 'Wide-Grip_Lat_Pulldown', sets: 3, low: 10, high: 12, start: 55, step: 1.25 },
      { id: 'Face_Pull', sets: 3, low: 12, high: 15, start: 25, step: 0.5 },
      { id: 'Barbell_Curl', sets: 3, low: 8, high: 12, start: 30, step: 0.5 },
    ],
  },
  {
    name: 'Lower B — Hinge Focus',
    weekday: 4,
    muscles: ['hamstrings', 'glutes', 'lower_back'],
    lifts: [
      { id: 'Barbell_Deadlift', sets: 3, low: 3, high: 5, start: 120, step: 5 },
      { id: 'Romanian_Deadlift', sets: 3, low: 8, high: 10, start: 80, step: 2 },
      { id: 'Dumbbell_Lunges', sets: 3, low: 10, high: 12, start: 20, step: 0.5 },
      { id: 'Seated_Cable_Rows', sets: 3, low: 10, high: 12, start: 55, step: 1.25 },
      { id: 'Plank', sets: 3, low: 1, high: 1, seconds: [45, 80] },
    ],
  },
];

/** 1-based weeks where the block backs off. */
const DELOADS = [4, 8];

/** Round to the nearest plate jump so the numbers read like a real logbook. */
const plate = (kg: number) => Math.round(kg / 2.5) * 2.5;

function workingWeight(lift: Lift, week: number): number | null {
  if (lift.start == null) return null;
  const raw = lift.start + (lift.step ?? 0) * week;
  return plate(DELOADS.includes(week + 1) ? raw * 0.85 : raw);
}

async function wipe() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!existing) return;
  // Workouts have no user relation with a cascade, so clear them by hand.
  await prisma.workout.deleteMany({ where: { userId: existing.id } });
  await prisma.bodyMetric.deleteMany({ where: { userId: existing.id } });
  await prisma.nutritionLog.deleteMany({ where: { userId: existing.id } });
  await prisma.user.delete({ where: { id: existing.id } });
}

async function main() {
  await wipe();

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await argon2.hash(DEMO_PASSWORD),
      name: 'Sam Reyes',
      role: 'admin',
      unitPreference: 'kg',
      distanceUnitPreference: 'km',
      trainingMode: 'hypertrophy',
      equipment: JSON.stringify(['barbell', 'dumbbells', 'cable', 'machine', 'bodyweight', 'bench', 'pull-up bar']),
    },
  });

  const plan = await prisma.plan.create({
    data: {
      userId: user.id,
      name: 'Upper / Lower — Autumn Block',
      status: 'active',
      startDate: dayUTC(WEEKS * 7),
      weeks: 12,
      daysPerWeek: 4,
      deloadWeeks: JSON.stringify(DELOADS),
      createdBy: 'generator',
      notes:
        'Four days, upper/lower, deload on weeks 4 and 8.\n\n'
        + 'Bench and squat carry the block — everything else is there to support them, '
        + 'so if a session has to be cut short, cut the accessories.\n\n'
        + 'Add weight only when every set hits the top of its rep range with a rep left in '
        + 'the tank. Volume goes up by at most 10% week to week; past that the elbow starts '
        + 'complaining and the whole block stalls.',
      days: {
        create: DAYS.map((d, i) => ({
          dayIndex: i,
          name: d.name,
          weekday: d.weekday,
          targetMuscles: JSON.stringify(d.muscles),
          template: JSON.stringify(
            d.lifts.map((l) => ({ exerciseId: l.id, sets: l.sets, repsLow: l.low, repsHigh: l.high })),
          ),
        })),
      },
    },
  });

  const loadFactors = new Map(
    (await prisma.exercise.findMany({
      where: { id: { in: DAYS.flatMap((d) => d.lifts.map((l) => l.id)) } },
      select: { id: true, loadFactor: true },
    })).map((e) => [e.id, e.loadFactor]),
  );

  /** Sets for one exercise in one session; `upTo` truncates a session in progress. */
  function setsFor(lift: Lift, week: number, upTo = Infinity) {
    const weight = workingWeight(lift, week);
    const rows: {
      order: number; reps: number | null; weightKg: number | null; durationSec: number | null;
      isWarmup: boolean; multiplier: number; rpe: number | null; completedAt: Date | null;
    }[] = [];
    let order = 0;
    // The first heavy compound of a session gets its ramp-up logged.
    if (weight != null && weight >= 60) {
      for (const frac of [0.5, 0.75]) {
        rows.push({
          order: order++, reps: 5, weightKg: plate(weight * frac), durationSec: null,
          isWarmup: true, multiplier: loadFactors.get(lift.id) ?? 1, rpe: null, completedAt: new Date(),
        });
      }
    }
    for (let s = 0; s < lift.sets; s++) {
      if (rows.length >= upTo) break;
      const reps = lift.seconds
        ? null
        : Math.max(lift.low, Math.min(lift.high, lift.high - (s > 1 ? 1 : 0) - (rand() < 0.35 ? 1 : 0)));
      rows.push({
        order: order++,
        reps,
        weightKg: weight,
        durationSec: lift.seconds ? jitter((lift.seconds[0] + lift.seconds[1]) / 2, 8) : null,
        isWarmup: false,
        multiplier: loadFactors.get(lift.id) ?? 1,
        rpe: pick([7, 7.5, 8, 8, 8.5, 9]),
        completedAt: new Date(),
      });
    }
    return rows.slice(0, upTo);
  }

  // ---- ten weeks of completed sessions -----------------------------------
  let completed = 0;
  for (let week = 0; week < WEEKS; week++) {
    const weeksAgo = WEEKS - 1 - week;
    for (const [i, day] of DAYS.entries()) {
      // Everyone misses a session; a block with a perfect record looks fake.
      if (week > 1 && rand() < 0.08) continue;
      const daysAgo = weeksAgo * 7 + (6 - day.weekday) - 2;
      if (daysAgo <= 0) continue;
      const deload = DELOADS.includes(week + 1);
      await prisma.workout.create({
        data: {
          userId: user.id,
          date: dayUTC(daysAgo),
          name: day.name,
          status: 'completed',
          source: 'generated',
          mode: 'hypertrophy',
          durationSec: jitter(deload ? 2700 : 3600, 420),
          notes: week === WEEKS - 2 && i === 0 ? 'Bench felt fast today — moving up 2.5 kg next week.' : null,
          exercises: {
            create: day.lifts.map((lift, order) => ({
              exerciseId: lift.id,
              order,
              targetSets: deload ? Math.max(2, lift.sets - 1) : lift.sets,
              targetRepsLow: lift.low,
              targetRepsHigh: lift.high,
              sets: { create: setsFor(lift, week, deload ? lift.sets + 1 : Infinity) },
            })),
          },
        },
      });
      completed++;
    }
  }

  // ---- one session left open, part way through ---------------------------
  // This is the state the live logger screenshot is taken in: two exercises
  // done, the third half finished, the rest of the card still waiting.
  const today = DAYS[0];
  const doneThrough = 2;
  await prisma.workout.create({
    data: {
      userId: user.id,
      date: dayUTC(0),
      name: today.name,
      status: 'in_progress',
      source: 'generated',
      mode: 'hypertrophy',
      exercises: {
        create: today.lifts.map((lift, order) => ({
          exerciseId: lift.id,
          order,
          targetSets: lift.sets,
          targetRepsLow: lift.low,
          targetRepsHigh: lift.high,
          sets: {
            create:
              order < doneThrough ? setsFor(lift, WEEKS - 1)
                : order === doneThrough ? setsFor(lift, WEEKS - 1, 1)
                  : [],
          },
        })),
      },
    },
  });

  // ---- what's next -------------------------------------------------------
  for (const [offset, day] of [[1, DAYS[1]], [3, DAYS[2]]] as [number, Day][]) {
    await prisma.workout.create({
      data: {
        userId: user.id,
        date: dayUTC(-offset),
        name: day.name,
        status: 'planned',
        source: 'generated',
        mode: 'hypertrophy',
        exercises: {
          create: day.lifts.map((lift, order) => ({
            exerciseId: lift.id,
            order,
            targetSets: lift.sets,
            targetRepsLow: lift.low,
            targetRepsHigh: lift.high,
            targetWeightKg: workingWeight(lift, WEEKS - 1),
          })),
        },
      },
    });
  }

  // ---- body metrics ------------------------------------------------------
  const metrics: { userId: string; date: Date; type: string; value: number; unit: string }[] = [];
  for (let d = WEEKS * 7; d >= 0; d -= 2) {
    const t = 1 - d / (WEEKS * 7);
    metrics.push({
      userId: user.id, date: dayUTC(d), type: 'weight', unit: 'kg',
      value: Math.round((86.2 - 4.6 * t + (rand() - 0.5) * 0.7) * 10) / 10,
    });
  }
  for (let d = WEEKS * 7; d >= 0; d -= 14) {
    const t = 1 - d / (WEEKS * 7);
    metrics.push({ userId: user.id, date: dayUTC(d), type: 'waist', unit: 'cm', value: Math.round((92 - 5 * t) * 10) / 10 });
    metrics.push({ userId: user.id, date: dayUTC(d), type: 'chest', unit: 'cm', value: Math.round((104 + 2.5 * t) * 10) / 10 });
    metrics.push({ userId: user.id, date: dayUTC(d), type: 'right_biceps', unit: 'cm', value: Math.round((37 + 1.5 * t) * 10) / 10 });
  }
  await prisma.bodyMetric.createMany({ data: metrics });

  // ---- nutrition ---------------------------------------------------------
  const nutrition = [];
  for (let d = 34; d >= 0; d--) {
    if (rand() < 0.12) continue; // nobody logs every single day
    const protein = jitter(178, 14);
    const carbs = jitter(230, 45);
    const fat = jitter(72, 12);
    nutrition.push({
      userId: user.id,
      date: dayUTC(d),
      calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
      note: d === 6 ? 'Ate out — estimated.' : null,
    });
  }
  await prisma.nutritionLog.createMany({ data: nutrition });

  await prisma.appSetting.upsert({
    where: { key: 'registrationOpen' },
    update: { value: 'true' },
    create: { key: 'registrationOpen', value: 'true' },
  });

  console.log(
    `Demo data: ${user.name} <${DEMO_EMAIL}> / ${DEMO_PASSWORD}\n`
    + `  plan "${plan.name}" with ${DAYS.length} days\n`
    + `  ${completed} completed workouts, 1 in progress, 2 planned\n`
    + `  ${metrics.length} body metrics, ${nutrition.length} nutrition logs`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
