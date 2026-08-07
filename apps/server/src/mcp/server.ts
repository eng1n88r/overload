import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { User } from '@prisma/client';
import {
  generateWorkoutSchema,
  planCreateSchema,
  planUpdateSchema,
  workoutCreateSchema,
  workoutUpdateSchema,
  setEntrySchema,
  num,
  numeric,
  MUSCLES,
  EQUIPMENT,
} from '@overload/shared';
import { prisma } from '../lib/prisma.js';
import { getE1RMSeries, getMuscleWeeklySets, getPRs, getWeeklyVolume, weekStart } from '../services/analytics.js';
import { getRecoveryState } from '../services/recovery.js';
import { generateWorkout } from '../services/generator/index.js';
import { createWorkoutForUser, exercisesCreateData, workoutInclude } from '../services/workouts.js';
import { createPlanForUser, planInclude, serializePlan, updatePlanForUser } from '../services/plans.js';
import { searchExercises } from '../services/exercise-search.js';

const SERVER_INSTRUCTIONS = `Overload is the user's personal training log. Typical flows:
- Explore: get_dashboard (session opener) / query_workout_history / get_exercise_stats.
- Program: resolve_exercise_names (dry-run name resolution) -> add_exercise_alias or create_exercise for gaps -> create_plan (days carry weekday anchors and per-exercise template: sets, reps, targetWeightKg, RIR, rest, per-side, seconds unit) -> generate_week or generate_workout to materialize sessions.
- Log: log_set during a session; log_body_metric / log_nutrition daily.
Conventions: weights are kg. Dates accept YYYY-MM-DD or full ISO. Update tools are true PATCH — omitted fields stay unchanged; arrays replace only when present. Exercise references accept catalog id, exact name, or alias.`;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: `ERROR: ${message}` }], isError: true };
}

/** Resolve an exercise by id, exact name (case-insensitive) or alias. */
async function resolveExercise(idOrName: string) {
  const byId = await prisma.exercise.findUnique({ where: { id: idOrName } });
  if (byId) return byId;
  const byName = await prisma.exercise.findFirst({ where: { name: idOrName } });
  if (byName) return byName;
  const alias = await prisma.exerciseAlias.findUnique({ where: { alias: idOrName }, include: { exercise: true } });
  return alias?.exercise ?? null;
}

async function loadSearchCatalog() {
  return prisma.exercise.findMany({ select: { id: true, name: true } });
}

/** Resolve a name/id/alias, falling back to fuzzy search suggestions. */
async function resolveWithSuggestions(idOrName: string) {
  const exact = await resolveExercise(idOrName);
  if (exact) return { resolved: exact, suggestions: [] as string[] };
  const catalog = await loadSearchCatalog();
  const matches = searchExercises(idOrName, catalog, 3);
  return { resolved: null, suggestions: matches.map((m) => `${m.name} [${m.id}]`) };
}

/** Map exercise references (id/name/alias) in a workout payload to catalog ids. */
async function resolveWorkoutExercises<T extends { exerciseId: string }>(
  exercises: T[],
): Promise<{ resolved: T[]; errors: string[] }> {
  const resolved: T[] = [];
  const errors: string[] = [];
  for (const we of exercises) {
    const r = await resolveWithSuggestions(we.exerciseId);
    if (r.resolved) {
      resolved.push({ ...we, exerciseId: r.resolved.id });
    } else {
      errors.push(`"${we.exerciseId}" not found${r.suggestions.length ? `; did you mean: ${r.suggestions.join(', ')}` : ''}`);
    }
  }
  return { resolved, errors };
}

function fmtSet(s: { reps: number | null; weightKg: number | null; durationSec: number | null; distanceM: number | null; isWarmup: boolean; multiplier: number }) {
  if (s.durationSec) {
    // Timed holds are seconds-scale; rounding them to minutes turned a 30s
    // side bridge into "1min" and a 15s hold into "0min".
    const dur = s.durationSec < 60 ? `${Math.round(s.durationSec)}s` : `${Math.round(s.durationSec / 60)}min`;
    return s.distanceM ? `${dur}/${(s.distanceM / 1000).toFixed(1)}km` : dur;
  }
  const kg = s.weightKg ? Math.round(s.weightKg * 100) / 100 : s.weightKg;
  const base = s.weightKg ? `${s.reps}x${kg}kg${s.multiplier > 1 ? `x${s.multiplier}` : ''}` : `${s.reps ?? 0}reps`;
  return s.isWarmup ? `(${base})` : base;
}

export function buildMcpServer(user: User): McpServer {
  const server = new McpServer({ name: 'overload', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS });
  const userId = user.id;

  // The full catalog as a cacheable resource (id | name | equipment/apparatus | primary muscles).
  server.registerResource(
    'exercise-catalog',
    'catalog://exercises',
    { title: 'Exercise catalog', description: 'All exercises: id | name | equipment (apparatus) | primary muscles', mimeType: 'text/plain' },
    async (uri) => {
      const exercises = await prisma.exercise.findMany({
        include: { muscles: { where: { role: 'primary' } } },
        orderBy: { name: 'asc' },
      });
      const lines = exercises.map(
        (e) => `${e.id} | ${e.name} | ${e.equipment}${e.apparatus ? ` (${e.apparatus})` : ''} | ${e.muscles.map((m) => m.muscle).join('/')}`,
      );
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: lines.join('\n') }] };
    },
  );

  // ---------- read tools ----------

  server.registerTool(
    'query_workout_history',
    {
      description:
        'List the user\'s workouts, newest first. Each line: date | status | name | exercise: sets (warmups in parentheses). Filter by date range, status or exercise.',
      inputSchema: {
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        status: z.enum(['planned', 'in_progress', 'completed', 'skipped']).optional(),
        exercise: z.string().optional().describe('exercise id, name or alias'),
        limit: numeric(num().int().min(1).max(100)).default(20),
        offset: numeric(num().int().min(0)).default(0),
      },
    },
    async ({ from, to, status, exercise, limit, offset }) => {
      let exerciseId: string | undefined;
      if (exercise) {
        const ex = await resolveExercise(exercise);
        if (!ex) return err(`Unknown exercise: ${exercise}`);
        exerciseId = ex.id;
      }
      const where = {
        userId,
        ...(from || to
          ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}) } }
          : {}),
        ...(status ? { status } : {}),
        ...(exerciseId ? { exercises: { some: { exerciseId } } } : {}),
      };
      const [total, workouts] = await Promise.all([
        prisma.workout.count({ where }),
        prisma.workout.findMany({ where, include: workoutInclude, orderBy: { date: 'desc' }, take: limit, skip: offset }),
      ]);
      const lines = workouts.map((w) => {
        const exs = w.exercises
          .map((we) => `${we.exercise.name}: ${we.sets.map(fmtSet).join(',') || 'no sets'}`)
          .join(' | ');
        return `${w.date.toISOString().slice(0, 10)} [${w.id}] ${w.status} ${w.name ?? ''} — ${exs}`;
      });
      return text(`total: ${total} (showing ${offset}-${offset + workouts.length})\n${lines.join('\n')}`);
    },
  );

  server.registerTool(
    'get_exercise_stats',
    {
      description: 'Stats for one exercise: e1RM trend (recent sessions), volume, and last 3 session details.',
      inputSchema: { exercise: z.string().describe('exercise id, name or alias') },
    },
    async ({ exercise }) => {
      const ex = await resolveExercise(exercise);
      if (!ex) return err(`Unknown exercise: ${exercise}`);
      const series = await getE1RMSeries(userId, ex.id);
      const recent = series.slice(-15);
      const last3 = await prisma.workoutExercise.findMany({
        where: { exerciseId: ex.id, workout: { userId, status: 'completed' } },
        include: { workout: { select: { date: true } }, sets: { orderBy: { order: 'asc' } } },
        orderBy: { workout: { date: 'desc' } },
        take: 3,
      });
      return text({
        exercise: { id: ex.id, name: ex.name, equipment: ex.equipment, mechanic: ex.mechanic },
        sessions: series.length,
        bestE1rm: series.length ? Math.max(...series.map((p) => p.e1rm)) : null,
        e1rmTrend: recent.map((p) => `${p.date}:${p.e1rm}kg(top ${p.topSetReps}x${p.topWeightKg})`).join(' '),
        lastSessions: last3.map((we) => ({
          date: we.workout.date.toISOString().slice(0, 10),
          sets: we.sets.map(fmtSet).join(','),
        })),
      });
    },
  );

  server.registerTool(
    'get_muscle_volume',
    {
      description: 'Weighted working sets per muscle per week (primary=1, secondary=0.5), with weekly average.',
      inputSchema: { weeks: numeric(num().int().min(1).max(52)).default(8) },
    },
    async ({ weeks }) => {
      const muscles = await getMuscleWeeklySets(userId, weeks);
      return text(
        muscles
          .map((m) => `${m.muscle}: avg ${m.weeklyAvg}/wk | ${m.weeks.map((w) => `${w.week}:${w.sets}`).join(' ')}`)
          .join('\n') || 'No strength data yet.',
      );
    },
  );

  server.registerTool(
    'get_recovery_state',
    { description: 'Current per-muscle recovery (100% = fully fresh) based on the last 7 days of training.', inputSchema: {} },
    async () => {
      const rec = await getRecoveryState(userId);
      return text(rec.map((m) => `${m.muscle}: ${m.recoveryPct}%${m.lastTrained ? ` (last ${m.lastTrained.slice(0, 10)})` : ''}`).join('\n'));
    },
  );

  server.registerTool(
    'get_weekly_volume',
    { description: 'Total working volume (kg), sets and workout count per week.', inputSchema: { weeks: numeric(num().int().min(1).max(260)).default(12) } },
    async ({ weeks }) => {
      const vol = await getWeeklyVolume(userId, weeks);
      return text(vol.map((w) => `${w.week}: ${w.volumeKg}kg, ${w.sets} sets, ${w.workouts} workouts`).join('\n') || 'No data.');
    },
  );

  server.registerTool(
    'get_prs',
    { description: 'Personal records for the most-trained exercises: max weight, best e1RM.', inputSchema: {} },
    async () => {
      const prs = await getPRs(userId, 20);
      return text(prs.map((p) => `${p.name} [${p.exerciseId}]: ${p.sessions} sessions, max ${p.maxWeightKg}kg, e1RM ${p.bestE1rm}kg (${p.bestE1rmDate}), last ${p.lastDate}`).join('\n') || 'No data.');
    },
  );

  server.registerTool(
    'get_body_metrics',
    {
      description: 'Body metrics (weight, waist, body_fat_pct, ... ) time series.',
      inputSchema: {
        type: z.string().optional().describe('metric type; omit for all types'),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: numeric(num().int().min(1).max(1000)).default(100),
      },
    },
    async ({ type, from, to, limit }) => {
      const metrics = await prisma.bodyMetric.findMany({
        where: {
          userId,
          ...(type ? { type } : {}),
          ...(from || to
            ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
            : {}),
        },
        orderBy: { date: 'desc' },
        take: limit,
      });
      return text(metrics.map((m) => `${m.date.toISOString().slice(0, 10)} ${m.type}: ${m.value}${m.unit}`).join('\n') || 'No metrics.');
    },
  );

  server.registerTool(
    'get_nutrition_summary',
    {
      description: 'Daily nutrition logs (calories/protein/carbs/fat) for a date range, newest first.',
      inputSchema: { from: z.string().date().optional(), to: z.string().date().optional(), limit: numeric(num().int().min(1).max(365)).default(30) },
    },
    async ({ from, to, limit }) => {
      const logs = await prisma.nutritionLog.findMany({
        where: {
          userId,
          ...(from || to
            ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
            : {}),
        },
        orderBy: { date: 'desc' },
        take: limit,
      });
      return text(
        logs.map((l) => `${l.date.toISOString().slice(0, 10)}: ${l.calories ?? '?'}kcal P${l.proteinG ?? '?'} C${l.carbsG ?? '?'} F${l.fatG ?? '?'}${l.note ? ` (${l.note})` : ''}`).join('\n') || 'No logs.',
      );
    },
  );

  server.registerTool(
    'get_active_plan',
    { description: 'The active training plan with its days and exercise templates.', inputSchema: {} },
    async () => {
      const plan = await prisma.plan.findFirst({ where: { userId, status: 'active' }, include: planInclude });
      if (!plan) return text('No active plan.');
      return text(serializePlan(plan));
    },
  );

  server.registerTool(
    'list_plans',
    { description: 'All plans (active and archived): id, name, status, dates.', inputSchema: {} },
    async () => {
      const plans = await prisma.plan.findMany({
        where: { userId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });
      return text(
        plans
          .map((p) => `[${p.id}] ${p.name} — ${p.status}, ${p.daysPerWeek}d/wk × ${p.weeks}wk, since ${p.startDate.toISOString().slice(0, 10)}`)
          .join('\n') || 'No plans.',
      );
    },
  );

  server.registerTool(
    'get_plan',
    { description: 'Full plan by id (works for archived plans too).', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const plan = await prisma.plan.findFirst({ where: { id, userId }, include: planInclude });
      if (!plan) return err(`Plan not found: ${id}`);
      return text(serializePlan(plan));
    },
  );

  server.registerTool(
    'get_dashboard',
    {
      description:
        'Session-opener rollup in one call: active plan summary, upcoming/in-progress workouts, recent workouts, recovery hotspots, latest body weight, this-week volume.',
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      const [plan, upcoming, recent, recovery, weight, volume] = await Promise.all([
        prisma.plan.findFirst({ where: { userId, status: 'active' }, include: planInclude }),
        prisma.workout.findMany({
          where: { userId, status: { in: ['planned', 'in_progress'] } },
          orderBy: { date: 'asc' },
          take: 5,
          include: { exercises: { include: { exercise: { select: { name: true } } }, orderBy: { order: 'asc' } } },
        }),
        prisma.workout.findMany({
          where: { userId, status: 'completed' },
          orderBy: { date: 'desc' },
          take: 3,
          include: { exercises: { include: { exercise: { select: { name: true } } }, orderBy: { order: 'asc' } } },
        }),
        getRecoveryState(userId),
        prisma.bodyMetric.findFirst({ where: { userId, type: 'weight' }, orderBy: { date: 'desc' } }),
        getWeeklyVolume(userId, 1),
      ]);
      const thisWeek = volume.find((w) => w.week === weekStart(now));
      return text({
        activePlan: plan
          ? { id: plan.id, name: plan.name, days: plan.days.map((d) => `[${d.id}] ${d.name}${d.weekday != null ? ` (wd${d.weekday})` : ''}`) }
          : null,
        upcomingWorkouts: upcoming.map((w) => `[${w.id}] ${w.date.toISOString().slice(0, 10)} ${w.status} ${w.name ?? ''}: ${w.exercises.map((e) => e.exercise.name).join(', ')}`),
        recentWorkouts: recent.map((w) => `[${w.id}] ${w.date.toISOString().slice(0, 10)} ${w.name ?? ''}: ${w.exercises.map((e) => e.exercise.name).join(', ')}`),
        leastRecovered: recovery.slice(0, 5).map((m) => `${m.muscle} ${m.recoveryPct}%`),
        latestWeightKg: weight?.value ?? null,
        thisWeek: thisWeek ? { volumeKg: thisWeek.volumeKg, sets: thisWeek.sets, workouts: thisWeek.workouts } : null,
      });
    },
  );

  server.registerTool(
    'list_exercises',
    {
      description: `Search the exercise catalog. \`search\` is fuzzy (token + synonym based, punctuation-insensitive); \`queries\` runs several searches in one call and returns best matches per query. Full catalog also available as the catalog://exercises resource. Muscles: ${MUSCLES.join(', ')}. Equipment: ${EQUIPMENT.join(', ')}.`,
      inputSchema: {
        search: z.string().optional(),
        queries: z.array(z.string()).max(30).optional().describe('multiple searches in one call, top matches per query'),
        muscle: z.string().optional(),
        equipment: z.string().optional(),
        category: z.enum(['strength', 'cardio', 'stretch']).optional(),
        limit: numeric(num().int().min(1).max(100)).default(25),
      },
    },
    async ({ search, queries, muscle, equipment, category, limit }) => {
      if (queries?.length) {
        const catalog = await loadSearchCatalog();
        const lines = queries.map((q) => {
          const matches = searchExercises(q, catalog, 3);
          return `${q}: ${matches.map((m) => `${m.name} [${m.id}]`).join(' | ') || 'NO MATCH'}`;
        });
        return text(lines.join('\n'));
      }
      let idFilter: string[] | undefined;
      if (search) {
        const catalog = await loadSearchCatalog();
        idFilter = searchExercises(search, catalog, limit).map((m) => m.id);
        if (!idFilter.length) return text('No matches.');
      }
      const exercises = await prisma.exercise.findMany({
        where: {
          ...(idFilter ? { id: { in: idFilter } } : {}),
          ...(muscle ? { muscles: { some: { muscle } } } : {}),
          ...(equipment ? { OR: [{ equipment }, { apparatus: equipment }] } : {}),
          ...(category ? { category } : {}),
        },
        include: { muscles: true },
        take: limit,
      });
      // preserve fuzzy ranking when searching
      const ordered = idFilter
        ? idFilter.map((id) => exercises.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e)
        : exercises.sort((a, b) => a.name.localeCompare(b.name));
      return text(
        ordered
          .map((e) => `[${e.id}] ${e.name} — ${e.equipment}${e.apparatus ? ` (${e.apparatus})` : ''}, ${e.mechanic ?? e.category}, primary: ${e.muscles.filter((m) => m.role === 'primary').map((m) => m.muscle).join('/') || '-'}`)
          .join('\n') || 'No matches.',
      );
    },
  );

  server.registerTool(
    'resolve_exercise_names',
    {
      description:
        'Dry-run exercise name resolution before an import: for each name, reports the resolved catalog exercise (via id, exact name, or alias) or the closest fuzzy suggestions. Pair with add_exercise_alias / create_exercise to fill gaps, then run bulk_create_workouts.',
      inputSchema: { names: z.array(z.string()).min(1).max(400) },
    },
    async ({ names }) => {
      const lines: string[] = [];
      let unresolved = 0;
      for (const name of [...new Set(names)]) {
        const r = await resolveWithSuggestions(name);
        if (r.resolved) {
          lines.push(`OK ${name} -> ${r.resolved.name} [${r.resolved.id}]`);
        } else {
          unresolved++;
          lines.push(`MISSING ${name}${r.suggestions.length ? ` — closest: ${r.suggestions.join(', ')}` : ''}`);
        }
      }
      return text(`${unresolved} unresolved of ${new Set(names).size}\n${lines.join('\n')}`);
    },
  );

  // ---------- write tools ----------

  const workoutShape = workoutCreateSchema.shape;

  server.registerTool(
    'create_workout',
    {
      description:
        'Create a workout (planned for the future, or completed with sets for history). Exercise references accept catalog id, exact name, or alias. Dates accept YYYY-MM-DD or full ISO. Set externalId for idempotent creation. Weights in kg.',
      inputSchema: workoutShape,
    },
    async (body) => {
      const parsed = workoutCreateSchema.parse(body);
      const { resolved, errors } = await resolveWorkoutExercises(parsed.exercises);
      if (errors.length) return err(errors.join('\n'));
      const { workout, created } = await createWorkoutForUser(userId, { ...parsed, exercises: resolved, source: 'mcp' });
      return text({ id: workout.id, created, date: workout.date.toISOString(), exercises: workout.exercises.length });
    },
  );

  server.registerTool(
    'bulk_create_workouts',
    {
      description:
        'Create many workouts at once (e.g. importing history). Exercise references accept id, exact name, or alias. Each workout should carry a unique externalId so re-runs are idempotent. Run resolve_exercise_names first as a dry run. Returns created/skipped counts and any errors.',
      inputSchema: { workouts: z.array(workoutCreateSchema).min(1).max(200) },
    },
    async ({ workouts }) => {
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const [i, w] of workouts.entries()) {
        try {
          const { resolved, errors: resolveErrors } = await resolveWorkoutExercises(w.exercises);
          if (resolveErrors.length) {
            errors.push(`#${i} (${w.date}): ${resolveErrors.join('; ')}`);
            continue;
          }
          const result = await createWorkoutForUser(userId, { ...w, exercises: resolved, source: 'mcp' });
          result.created ? created++ : skipped++;
        } catch (e) {
          errors.push(`#${i} (${w.date}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return text({ created, skippedExisting: skipped, errors });
    },
  );

  server.registerTool(
    'delete_workout',
    {
      description: 'Delete a workout by id (from query_workout_history). Permanent.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const existing = await prisma.workout.findFirst({ where: { id, userId } });
      if (!existing) return err(`Workout not found: ${id}`);
      await prisma.workout.delete({ where: { id } });
      return text({ id, deleted: true });
    },
  );

  server.registerTool(
    'log_set',
    {
      description:
        'Append one set to a workout during a session ("log 61kg x 10 on squat"). Finds the exercise in the workout (added on the fly if missing). Weights in kg; cardio uses durationSec/distanceM.',
      inputSchema: {
        workoutId: z.string().describe('target workout id; use the in-progress or planned workout from get_dashboard'),
        exercise: z.string().describe('exercise id, name or alias'),
        ...setEntrySchema.shape,
      },
    },
    async ({ workoutId, exercise, ...set }) => {
      const workout = await prisma.workout.findFirst({ where: { id: workoutId, userId } });
      if (!workout) return err(`Workout not found: ${workoutId}`);
      const r = await resolveWithSuggestions(exercise);
      if (!r.resolved) return err(`Exercise "${exercise}" not found${r.suggestions.length ? `; did you mean: ${r.suggestions.join(', ')}` : ''}`);
      let we = await prisma.workoutExercise.findFirst({
        where: { workoutId, exerciseId: r.resolved.id },
        include: { sets: { orderBy: { order: 'desc' }, take: 1 } },
      });
      if (!we) {
        const count = await prisma.workoutExercise.count({ where: { workoutId } });
        we = {
          ...(await prisma.workoutExercise.create({
            data: { workoutId, exerciseId: r.resolved.id, order: count },
          })),
          sets: [],
        };
      }
      const parsed = setEntrySchema.parse(set);
      const entry = await prisma.setEntry.create({
        data: {
          workoutExerciseId: we.id,
          order: (we.sets[0]?.order ?? -1) + 1,
          reps: parsed.reps ?? null,
          weightKg: parsed.weightKg ?? null,
          durationSec: parsed.durationSec ?? null,
          distanceM: parsed.distanceM ?? null,
          resistance: parsed.resistance ?? null,
          incline: parsed.incline ?? null,
          isWarmup: parsed.isWarmup,
          multiplier: parsed.multiplier ?? r.resolved.loadFactor,
          rpe: parsed.rpe ?? null,
          note: parsed.note ?? null,
          completedAt: parsed.completedAt ? new Date(parsed.completedAt) : new Date(),
        },
      });
      return text({ workoutId, exercise: r.resolved.name, set: entry.order + 1, logged: true });
    },
  );

  server.registerTool(
    'update_workout',
    {
      description:
        'PATCH a workout by id: omitted fields stay unchanged. `exercises`, when provided, replaces the full exercise list (fetch current state via query_workout_history first); exercise references accept id, exact name, or alias. For appending a single set during a session use log_set instead.',
      inputSchema: { id: z.string(), ...workoutUpdateSchema.shape },
    },
    async ({ id, ...rest }) => {
      const body = workoutUpdateSchema.parse(rest);
      const existing = await prisma.workout.findFirst({ where: { id, userId } });
      if (!existing) return err(`Workout not found: ${id}`);
      if (body.exercises) {
        const { resolved, errors } = await resolveWorkoutExercises(body.exercises);
        if (errors.length) return err(errors.join('\n'));
        body.exercises = resolved;
      }
      await prisma.workout.update({
        where: { id },
        data: {
          ...(body.date !== undefined ? { date: new Date(body.date) } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.durationSec !== undefined ? { durationSec: body.durationSec } : {}),
          ...(body.exercises !== undefined
            ? { exercises: { deleteMany: {}, create: await exercisesCreateData(body.exercises) } }
            : {}),
        },
      });
      return text({ id, updated: true });
    },
  );

  server.registerTool(
    'log_body_metric',
    {
      description: 'Log/overwrite a body metric for a day (type: weight, waist, body_fat_pct, ... ).',
      inputSchema: { date: z.string().date(), type: z.string(), value: numeric(num()), unit: z.string().default('kg') },
    },
    async ({ date, type, value, unit }) => {
      await prisma.bodyMetric.upsert({
        where: { userId_date_type: { userId, date: new Date(`${date}T00:00:00Z`), type } },
        update: { value, unit },
        create: { userId, date: new Date(`${date}T00:00:00Z`), type, value, unit },
      });
      return text({ date, type, value, unit, saved: true });
    },
  );

  server.registerTool(
    'log_nutrition',
    {
      description: 'Log/overwrite the nutrition entry for a day.',
      inputSchema: {
        date: z.string().date(),
        calories: numeric(num().int().min(0)).nullish(),
        proteinG: numeric(num().min(0)).nullish(),
        carbsG: numeric(num().min(0)).nullish(),
        fatG: numeric(num().min(0)).nullish(),
        note: z.string().max(500).nullish(),
      },
    },
    async ({ date, calories, proteinG, carbsG, fatG, note }) => {
      const data = { calories: calories ?? null, proteinG: proteinG ?? null, carbsG: carbsG ?? null, fatG: fatG ?? null, note: note ?? null };
      await prisma.nutritionLog.upsert({
        where: { userId_date: { userId, date: new Date(`${date}T00:00:00Z`) } },
        update: data,
        create: { userId, date: new Date(`${date}T00:00:00Z`), ...data },
      });
      return text({ date, saved: true });
    },
  );

  server.registerTool(
    'create_exercise',
    {
      description: `Add a custom exercise missing from the catalog. Muscles from: ${MUSCLES.join(', ')}.`,
      inputSchema: {
        name: z.string().min(1).max(200),
        category: z.enum(['strength', 'cardio', 'stretch']).default('strength'),
        equipment: z.string().default('other'),
        mechanic: z.enum(['compound', 'isolation']).nullish(),
        loadFactor: z
          .number()
          .int()
          .positive()
          .default(1)
          .describe('implements per rep × sides per rep count; seeds multiplier on logged sets (pair of dumbbells = 2, one DB worked per side = 2, two DBs per side = 4)'),
        defaultUnit: z
          .enum(['reps', 'seconds'])
          .default('reps')
          .describe("'seconds' for isometric holds and carries — the logger then offers a hold timer instead of a reps stepper"),
        primaryMuscles: z.array(z.string()).default([]),
        secondaryMuscles: z.array(z.string()).default([]),
        instructions: z.array(z.string()).default([]),
      },
    },
    async ({ name, category, equipment, mechanic, loadFactor, defaultUnit, primaryMuscles, secondaryMuscles, instructions }) => {
      const existing = await prisma.exercise.findUnique({ where: { name } });
      if (existing) return err(`Exercise already exists: [${existing.id}] ${existing.name}`);
      const badMuscles = [...primaryMuscles, ...secondaryMuscles].filter((m) => !(MUSCLES as readonly string[]).includes(m));
      if (badMuscles.length) return err(`Unknown muscles: ${badMuscles.join(', ')}`);
      const exercise = await prisma.exercise.create({
        data: {
          name,
          category,
          equipment,
          mechanic: mechanic ?? null,
          loadFactor,
          defaultUnit,
          instructions: JSON.stringify(instructions),
          isCustom: true,
          createdById: userId,
          muscles: {
            create: [
              ...primaryMuscles.map((m) => ({ muscle: m, role: 'primary' })),
              ...secondaryMuscles.map((m) => ({ muscle: m, role: 'secondary' })),
            ],
          },
        },
      });
      return text({ id: exercise.id, name: exercise.name, created: true });
    },
  );

  server.registerTool(
    'update_exercise',
    {
      description:
        'Correct catalog metadata on an exercise. loadFactor (implements per rep × sides per rep count) seeds SetEntry.multiplier; defaultUnit decides whether the logger offers a reps stepper or a seconds hold timer. Use when a movement is logged with the wrong tonnage, or when a timed hold is showing a reps input. Only affects sets logged after the change; existing sets are unchanged. PATCH semantics: omitted fields stay unchanged.',
      inputSchema: {
        exercise: z.string().describe('exercise id, name or alias'),
        loadFactor: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('1 = one implement (barbell, cable, goblet); 2 = pair moved together, or one implement worked per side; 4 = pair worked per side'),
        defaultUnit: z
          .enum(['reps', 'seconds'])
          .optional()
          .describe("'seconds' for planks, side bridges, dead hangs, carries and stretches"),
      },
    },
    async ({ exercise, loadFactor, defaultUnit }) => {
      const r = await resolveWithSuggestions(exercise);
      if (!r.resolved) {
        return err(`Exercise "${exercise}" not found${r.suggestions.length ? `; did you mean: ${r.suggestions.join(', ')}` : ''}`);
      }
      if (loadFactor === undefined && defaultUnit === undefined) {
        return err('Nothing to update: supply loadFactor and/or defaultUnit.');
      }
      const updated = await prisma.exercise.update({
        where: { id: r.resolved.id },
        data: {
          ...(loadFactor !== undefined ? { loadFactor } : {}),
          ...(defaultUnit !== undefined ? { defaultUnit } : {}),
        },
      });
      return text({
        id: updated.id,
        name: updated.name,
        loadFactor: updated.loadFactor,
        defaultUnit: updated.defaultUnit,
        note: 'applies to sets logged from now on; existing sets are unchanged',
      });
    },
  );

  server.registerTool(
    'add_exercise_alias',
    {
      description: 'Map an alternative exercise name (e.g. a name from another app\'s export) to a catalog exercise so history references resolve.',
      inputSchema: { alias: z.string().min(1).max(200), exercise: z.string().describe('catalog exercise id or name') },
    },
    async ({ alias, exercise }) => {
      const ex = await resolveExercise(exercise);
      if (!ex) return err(`Unknown exercise: ${exercise}`);
      await prisma.exerciseAlias.upsert({
        where: { alias },
        update: { exerciseId: ex.id },
        create: { alias, exerciseId: ex.id },
      });
      return text({ alias, exerciseId: ex.id, saved: true });
    },
  );

  /** Resolve template exerciseIds (id/name/alias) across a plan's days. */
  async function resolveTemplates<D extends { template: { exerciseId: string }[] }>(
    days: D[],
  ): Promise<{ days: D[]; errors: string[] }> {
    const out: D[] = [];
    const errors: string[] = [];
    for (const day of days) {
      const { resolved, errors: dayErrors } = await resolveWorkoutExercises(day.template);
      errors.push(...dayErrors);
      out.push({ ...day, template: resolved });
    }
    return { days: out, errors };
  }

  server.registerTool(
    'create_plan',
    {
      description:
        'Create a training plan (mesocycle) and make it active. Template exercises accept id, exact name, or alias; items support sets, repsLow/High, targetWeightKg, rir, restSec, perSide, unit (reps|seconds), notes. Days can carry a weekday (0=Mon..6=Sun) for generate_week; deloadWeeks marks reduced-volume weeks. Creating archives the previous active plan — if an active plan with the same name exists, the call is rejected unless confirmReplace is true (safe retries).',
      inputSchema: { ...planCreateSchema.shape, confirmReplace: z.boolean().default(false) },
    },
    async ({ confirmReplace, ...body }) => {
      const parsed = planCreateSchema.parse(body);
      const duplicate = await prisma.plan.findFirst({ where: { userId, name: parsed.name, status: 'active' } });
      if (duplicate && !confirmReplace) {
        return err(
          `An active plan named "${parsed.name}" already exists [${duplicate.id}] — this may be a retry. Use adjust_plan to modify it, or pass confirmReplace: true to archive it and create a new one.`,
        );
      }
      const { days, errors } = await resolveTemplates(parsed.days);
      if (errors.length) return err(errors.join('\n'));
      const plan = await createPlanForUser(userId, { ...parsed, days }, 'mcp');
      return text({ id: plan.id, name: plan.name, days: plan.days.length, active: true });
    },
  );

  server.registerTool(
    'adjust_plan',
    {
      description:
        'PATCH a plan by id: omitted fields stay unchanged. `days`, when present, replaces the day list but days keep their identity per dayIndex (existing ids survive). Template exercises accept id, exact name, or alias.',
      inputSchema: { id: z.string(), ...planUpdateSchema.shape },
    },
    async ({ id, ...rest }) => {
      const body = planUpdateSchema.parse(rest);
      if (body.days) {
        const { days, errors } = await resolveTemplates(body.days);
        if (errors.length) return err(errors.join('\n'));
        body.days = days;
      }
      const plan = await updatePlanForUser(userId, id, body);
      if (!plan) return err(`Plan not found: ${id}`);
      return text({ id, updated: true, days: plan.days.length });
    },
  );

  server.registerTool(
    'generate_week',
    {
      description:
        "Materialize a week of the active plan: creates one planned workout per plan day, dated by each day's weekday anchor (0=Mon..6=Sun; days without a weekday are spread across the week). weekStartDate must be a Monday (defaults to next Monday). Skips dates that already have a planned workout.",
      inputSchema: { weekStartDate: z.string().date().optional().describe('the Monday the week starts on') },
    },
    async ({ weekStartDate }) => {
      const plan = await prisma.plan.findFirst({ where: { userId, status: 'active' }, include: planInclude });
      if (!plan) return err('No active plan. Create one with create_plan first.');
      if (!plan.days.length) return err('Active plan has no days.');

      let monday: Date;
      if (weekStartDate) {
        monday = new Date(`${weekStartDate}T12:00:00Z`);
        if (monday.getUTCDay() !== 1) return err(`${weekStartDate} is not a Monday.`);
      } else {
        const now = new Date();
        const daysUntilMonday = ((8 - now.getUTCDay()) % 7) || 7;
        monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 12));
      }

      const fallbackSlots = [0, 2, 4, 1, 3, 5, 6]; // Mon/Wed/Fri first for unanchored days
      let fallbackIdx = 0;
      const created: string[] = [];
      const skipped: string[] = [];
      for (const day of plan.days) {
        const offset = day.weekday ?? fallbackSlots[fallbackIdx++ % fallbackSlots.length];
        const date = new Date(monday.getTime() + offset * 864e5);
        const dayStr = date.toISOString().slice(0, 10);
        const existing = await prisma.workout.findFirst({
          where: {
            userId,
            status: 'planned',
            date: { gte: new Date(`${dayStr}T00:00:00Z`), lte: new Date(`${dayStr}T23:59:59Z`) },
          },
        });
        if (existing) {
          skipped.push(`${dayStr} (${day.name}): already has planned workout [${existing.id}]`);
          continue;
        }
        const id = await generateWorkout(userId, { date, planDayId: day.id });
        created.push(`${dayStr} ${day.name} [${id}]`);
      }
      return text({ weekOf: monday.toISOString().slice(0, 10), created, skipped });
    },
  );

  server.registerTool(
    'generate_workout',
    {
      description:
        'Run the deterministic generator: creates a planned workout from a plan day template, explicit muscles, or (default) the freshest muscle group. mode picks the prescription math — strength (3-6 reps @ ~85-95% e1RM, warm-up ramp), hypertrophy (6-15 reps, default) or endurance (15-25 reps) — falling back to the plan day mode, then the user default. Returns the workout id — refine it with update_workout.',
      inputSchema: generateWorkoutSchema.shape,
    },
    async ({ date, planDayId, muscles, mode }) => {
      const id = await generateWorkout(userId, {
        date: date ? new Date(date) : undefined,
        planDayId,
        muscles,
        mode,
      });
      const workout = await prisma.workout.findUniqueOrThrow({ where: { id }, include: workoutInclude });
      return text({
        id,
        name: workout.name,
        exercises: workout.exercises.map((we) => ({
          exerciseId: we.exerciseId,
          name: we.exercise.name,
          target: `${we.targetSets}x${we.targetRepsLow}-${we.targetRepsHigh}${we.targetWeightKg ? `@${we.targetWeightKg}kg` : ''}`,
          notes: we.notes,
        })),
      });
    },
  );

  return server;
}
