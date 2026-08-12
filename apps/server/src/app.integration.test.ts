import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Full-stack tests: real Fastify app + real SQLite test database.
const TEST_DB_FILE = 'test-integration.db';

let app: FastifyInstance;
let prisma: (typeof import('./lib/prisma.js'))['prisma'];
let sessionCookie: string;
let apiKey: string;
let workoutId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:./${TEST_DB_FILE}`;
  process.env.SESSION_SECRET = 'test-secret';
  // vitest runs with cwd = apps/server; prisma resolves the file: URL relative
  // to the schema directory, so the test db lands in prisma/. Start from a
  // clean file so a plain db push fully defines the schema.
  for (const suffix of ['', '-journal']) {
    rmSync(new URL(`../prisma/${TEST_DB_FILE}${suffix}`, import.meta.url), { force: true });
  }
  execSync('npx prisma db push --skip-generate', {
    env: process.env as NodeJS.ProcessEnv,
    stdio: 'pipe',
  });
  ({ prisma } = await import('./lib/prisma.js'));
  await prisma.exercise.create({
    data: {
      id: 'Test_Bench_Press',
      name: 'Test Bench Press',
      category: 'strength',
      equipment: 'barbell',
      mechanic: 'compound',
      muscles: {
        create: [
          { muscle: 'chest', role: 'primary' },
          { muscle: 'triceps', role: 'secondary' },
        ],
      },
    },
  });
  const { buildServer } = await import('./app.js');
  app = await buildServer({ logger: false });
}, 120000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  for (const suffix of ['', '-journal']) {
    try {
      rmSync(new URL(`../prisma/${TEST_DB_FILE}${suffix}`, import.meta.url));
    } catch {
      /* already gone */
    }
  }
});

describe('auth', () => {
  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('registers the first user as admin and starts a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'first@test.dev', name: 'First', password: 'password-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
    const cookie = res.cookies.find((c) => c.name === 'ovl_session');
    expect(cookie).toBeDefined();
    sessionCookie = cookie!.value;
  });

  it('closes registration after the first user', async () => {
    const open = await app.inject({ method: 'GET', url: '/api/v1/auth/registration-open' });
    expect(open.json()).toMatchObject({ open: false, firstUser: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'second@test.dev', name: 'Second', password: 'password-123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the admin manage users and their data', async () => {
    const auth = { cookies: { ovl_session: sessionCookie } };

    // create a second user
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      ...auth,
      payload: { email: 'kid@test.dev', name: 'Kid', password: 'kid-password-1' },
    });
    expect(created.statusCode).toBe(200);
    const kidId = created.json().user.id;

    // the new user can log in and is NOT allowed to manage users
    const kidLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'kid@test.dev', password: 'kid-password-1' },
    });
    expect(kidLogin.statusCode).toBe(200);
    const kidCookie = kidLogin.cookies.find((c) => c.name === 'ovl_session')!.value;
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      cookies: { ovl_session: kidCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    // kid logs a workout; admin sees the count
    const w = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: kidCookie },
      payload: { date: '2026-07-01', status: 'completed' },
    });
    expect(w.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/v1/users', ...auth });
    const kidRow = list.json().users.find((u: { id: string }) => u.id === kidId);
    expect(kidRow.workouts).toBe(1);

    // password reset invalidates the kid session
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${kidId}`,
      ...auth,
      payload: { password: 'new-password-99' },
    });
    expect(reset.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: kidCookie },
    });
    expect(stale.statusCode).toBe(401);

    // guards: cannot demote the last admin, cannot delete yourself
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', ...auth });
    const myId = me.json().user.id;
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${myId}`,
      ...auth,
      payload: { role: 'user' },
    });
    expect(demote.statusCode).toBe(400);
    const selfDelete = await app.inject({ method: 'DELETE', url: `/api/v1/users/${myId}`, ...auth });
    expect(selfDelete.statusCode).toBe(400);

    // delete the kid: user and workouts gone
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/users/${kidId}`, ...auth });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/users', ...auth });
    expect(after.json().users.some((u: { id: string }) => u.id === kidId)).toBe(false);

    // registration toggle round-trip
    const openIt = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/registration',
      ...auth,
      payload: { open: true },
    });
    expect(openIt.json().open).toBe(true);
    const closeIt = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/registration',
      ...auth,
      payload: { open: false },
    });
    expect(closeIt.json().open).toBe(false);
  });

  it('rejects bad credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'first@test.dev', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('identifies the user via session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('first@test.dev');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('sets, returns and clears the avatar', async () => {
    const png = `data:image/png;base64,${Buffer.from('avatar-bytes').toString('base64')}`;
    const set = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
      payload: { avatar: png },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().user.avatar).toBe(png);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
    });
    expect(me.json().user.avatar).toBe(png);

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
      payload: { avatar: 'https://example.com/pic.jpg' },
    });
    expect(bad.statusCode).toBe(400);

    const clear = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
      payload: { avatar: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().user.avatar).toBeNull();
  });

  it('issues an API key that authenticates as Bearer', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      cookies: { ovl_session: sessionCookie },
      payload: { name: 'test-key' },
    });
    expect(created.statusCode).toBe(200);
    apiKey = created.json().token;
    expect(apiKey.startsWith('ovl_')).toBe(true);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('first@test.dev');
  });

  it('rejects a revoked API key', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      cookies: { ovl_session: sessionCookie },
    });
    const keyId = list.json().keys[0].id;
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${keyId}`,
      cookies: { ovl_session: sessionCookie },
    });
    expect(revoke.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(me.statusCode).toBe(401);
    // re-issue for later tests
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      cookies: { ovl_session: sessionCookie },
      payload: { name: 'test-key-2' },
    });
    apiKey = again.json().token;
  });
});

describe('workouts', () => {
  it('creates a workout with nested sets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: {
        date: '2026-07-20T10:00:00Z',
        name: 'Test day',
        status: 'completed',
        externalId: 'it-1',
        exercises: [
          {
            exerciseId: 'Test_Bench_Press',
            sets: [
              { reps: 10, weightKg: 60 },
              { reps: 8, weightKg: 65, isWarmup: false },
              { reps: 12, weightKg: 40, isWarmup: true },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.workout.exercises[0].sets).toHaveLength(3);
    workoutId = body.workout.id;
  });

  it('is idempotent per externalId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: {
        date: '2026-07-20T10:00:00Z',
        status: 'completed',
        externalId: 'it-1',
        exercises: [],
      },
    });
    expect(res.json().created).toBe(false);
    expect(res.json().workout.id).toBe(workoutId);
  });

  it('rejects unknown exercise ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: {
        date: '2026-07-21T10:00:00Z',
        exercises: [{ exerciseId: 'Does_Not_Exist', sets: [] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with a minimal diff leaves status and exercises untouched', async () => {
    // regression: .partial() schemas used to re-fire defaults, resetting
    // status to planned and wiping the exercise list on any update
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { name: 'Renamed only' },
    });
    expect(res.statusCode).toBe(200);
    const w = res.json().workout;
    expect(w.name).toBe('Renamed only');
    expect(w.status).toBe('completed');
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0].sets.length).toBeGreaterThan(0);
  });

  it('accepts plain dates on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: { date: '2026-07-19', status: 'completed', externalId: 'it-plain-date', exercises: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workout.date.startsWith('2026-07-19')).toBe(true);
    // remove again so later aggregate assertions stay stable
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/workouts/${res.json().workout.id}`,
      cookies: { ovl_session: sessionCookie },
    });
  });

  it('lists workouts and appends live sets', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
    });
    expect(list.json().total).toBe(1);
    const weId = list.json().workouts[0].exercises[0].id;

    const setRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workouts/${workoutId}/exercises/${weId}/sets`,
      cookies: { ovl_session: sessionCookie },
      payload: { reps: 6, weightKg: 70 },
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json().set.order).toBe(3);
  });

  // The live logger asks how hard a set was during the rest that follows it,
  // so the rating lands on a row that already exists.
  it('rates a logged set after the fact, and can unrate it', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
    });
    const we = list.json().workouts[0].exercises[0];
    const setId = we.sets.at(-1).id;

    const rate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { rpe: 8.5 },
    });
    expect(rate.statusCode).toBe(200);
    expect(rate.json().set.rpe).toBe(8.5);

    // PATCH: an omitted field is left alone, an explicit null clears it.
    const note = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { note: 'last rep was a grind' },
    });
    expect(note.json().set.rpe).toBe(8.5);
    expect(note.json().set.note).toBe('last rep was a grind');

    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { rpe: null },
    });
    expect(clear.json().set.rpe).toBeNull();
  });

  it('refuses a rating outside the scale, or on someone else\'s set', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
    });
    const we = list.json().workouts[0].exercises[0];
    const setId = we.sets.at(-1).id;

    const tooHigh = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { rpe: 11 },
    });
    expect(tooHigh.statusCode).toBe(400);

    const noSession = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`,
      payload: { rpe: 7 },
    });
    expect(noSession.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workouts/${workoutId}/exercises/${we.id}/sets/does-not-exist`,
      cookies: { ovl_session: sessionCookie },
      payload: { rpe: 7 },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('analytics', () => {
  it('computes the dashboard from logged data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/dashboard',
      cookies: { ovl_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weeklyVolume.length).toBeGreaterThan(0);
    // 10x60 + 8x65 + 6x70 (warmup excluded) on week of 2026-07-20
    expect(body.weeklyVolume[0].volumeKg).toBe(10 * 60 + 8 * 65 + 6 * 70);
    expect(body.muscleWeeklySets.find((m: { muscle: string }) => m.muscle === 'chest')).toBeDefined();
    expect(body.recovery.length).toBeGreaterThan(0);
  });

  it('reports untrained weeks as zeros on a gap-free shared axis', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/muscle-volume?weeks=12',
      cookies: { ovl_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const muscles: { muscle: string; weeklyAvg: number; weeks: { week: string; sets: number }[] }[] =
      res.json().muscles;
    expect(muscles.length).toBeGreaterThan(0);

    // Every muscle is plotted against the same weeks, so the chart can compare them
    // directly and a muscle that stopped being trained flatlines instead of vanishing.
    const axis = muscles[0].weeks.map((w) => w.week);
    for (const m of muscles) expect(m.weeks.map((w) => w.week)).toEqual(axis);

    // Consecutive Mondays with no holes — a skipped week must be a zero, not a missing point.
    for (let i = 1; i < axis.length; i++) {
      const gap = Date.parse(`${axis[i]}T00:00:00Z`) - Date.parse(`${axis[i - 1]}T00:00:00Z`);
      expect(gap).toBe(7 * 24 * 3600 * 1000);
    }
    // Computed inline rather than imported: analytics.js pulls in prisma at module
    // load, before beforeAll points DATABASE_URL at the scratch database.
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    expect(axis[axis.length - 1]).toBe(monday.toISOString().slice(0, 10));
  });

  it('serves an e1RM series per exercise', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/e1rm/Test_Bench_Press',
      cookies: { ovl_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().series).toHaveLength(1);
    expect(res.json().series[0].e1rm).toBeGreaterThan(70);
  });
});

describe('mcp', () => {
  it('rejects requests without an API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists tools with a valid API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.tools.length).toBe(28);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('bulk_create_workouts');
    expect(names).toContain('update_exercise');
    expect(names).toContain('generate_workout');
    expect(names).toContain('log_set');
    expect(names).toContain('delete_workout');
    expect(names).toContain('get_dashboard');
    expect(names).toContain('generate_week');
    expect(names).toContain('resolve_exercise_names');
  });

  it('executes a tool call scoped to the key owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'query_workout_history', arguments: { limit: 5 } },
      },
    });
    expect(res.statusCode).toBe(200);
    const textOut = res.json().result.content[0].text as string;
    expect(textOut).toContain('total: 1');
    expect(textOut).toContain('Test Bench Press');
  });
});

describe('plans', () => {
  let planId: string;
  let dayId: string;

  it('creates a plan with template extensions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      cookies: { ovl_session: sessionCookie },
      payload: {
        name: 'IT Plan',
        weeks: 8,
        daysPerWeek: 3,
        deloadWeeks: [4],
        days: [
          {
            dayIndex: 0,
            name: 'Day A',
            weekday: 0,
            targetMuscles: ['chest'],
            template: [{ exerciseId: 'Test_Bench_Press', sets: 3, repsLow: 8, repsHigh: 10, targetWeightKg: 60, rir: 2, restSec: 120 }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json().plan;
    expect(plan.deloadWeeks).toEqual([4]);
    expect(plan.days[0].weekday).toBe(0);
    expect(plan.days[0].template[0].rir).toBe(2);
    planId = plan.id;
    dayId = plan.days[0].id;
  });

  it('PATCH with a minimal diff keeps days and daysPerWeek', async () => {
    // regression: partial() defaults used to reset daysPerWeek to 4 and wipe days
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/plans/${planId}`,
      cookies: { ovl_session: sessionCookie },
      payload: { notes: 'updated notes only' },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json().plan;
    expect(plan.notes).toBe('updated notes only');
    expect(plan.daysPerWeek).toBe(3);
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].id).toBe(dayId);
  });

  it('replacing days preserves identity for unchanged dayIndex', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/plans/${planId}`,
      cookies: { ovl_session: sessionCookie },
      payload: {
        days: [
          { dayIndex: 0, name: 'Day A renamed', targetMuscles: ['chest'], template: [] },
          { dayIndex: 1, name: 'Day B', targetMuscles: ['lats'], template: [] },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json().plan;
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0].id).toBe(dayId); // same dayIndex kept its identity
    expect(plan.days[0].name).toBe('Day A renamed');
  });
});

describe('loadFactor seeds set multiplier', () => {
  // Dedicated fixtures on an unrelated muscle, logged as `planned`, so neither
  // progression history (completed-only) nor the generator's chest picks shift.
  const PAIR = 'Test_LF_Pair';
  const SINGLE = 'Test_LF_Single';

  beforeAll(async () => {
    for (const [id, name, loadFactor] of [
      [PAIR, 'Test LF Pair', 2],
      [SINGLE, 'Test LF Single', 1],
    ] as const) {
      await prisma.exercise.create({
        data: {
          id,
          name,
          category: 'strength',
          equipment: 'dumbbells',
          loadFactor,
          muscles: { create: [{ muscle: 'forearms', role: 'primary' }] },
        },
      });
    }
  });

  async function logSet(exerciseId: string, set: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: {
        date: new Date().toISOString(),
        status: 'planned',
        exercises: [{ exerciseId, sets: [set] }],
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json().workout.exercises[0].sets[0];
  }

  it('omitted multiplier inherits the exercise loadFactor', async () => {
    expect((await logSet(PAIR, { reps: 10, weightKg: 30 })).multiplier).toBe(2);
  });

  it('an explicit multiplier always wins over loadFactor', async () => {
    expect((await logSet(PAIR, { reps: 10, weightKg: 30, multiplier: 1 })).multiplier).toBe(1);
    expect((await logSet(PAIR, { reps: 10, weightKg: 30, multiplier: 4 })).multiplier).toBe(4);
  });

  it('stays 1 for a single-implement exercise', async () => {
    expect((await logSet(SINGLE, { reps: 10, weightKg: 30 })).multiplier).toBe(1);
  });

  it('update_exercise changes it for future sets only', async () => {
    const before = await logSet(SINGLE, { reps: 10, weightKg: 30 });
    await prisma.exercise.update({ where: { id: SINGLE }, data: { loadFactor: 2 } });
    const after = await logSet(SINGLE, { reps: 10, weightKg: 30 });
    expect(before.multiplier).toBe(1);
    expect(after.multiplier).toBe(2);
    await prisma.exercise.update({ where: { id: SINGLE }, data: { loadFactor: 1 } });
  });
});

describe('unit handling and unloaded work', () => {
  const HOLD = 'Test_Timed_Hold';
  const BAND = 'Test_Band_Pull';

  beforeAll(async () => {
    await prisma.exercise.create({
      data: {
        id: HOLD,
        name: 'Test Timed Hold',
        category: 'strength',
        equipment: 'bodyweight',
        defaultUnit: 'seconds',
        muscles: { create: [{ muscle: 'abs', role: 'primary' }] },
      },
    });
    await prisma.exercise.create({
      data: {
        id: BAND,
        name: 'Test Band Pull',
        category: 'strength',
        equipment: 'resistance band',
        muscles: { create: [{ muscle: 'rear_delts', role: 'primary' }] },
      },
    });
  });

  async function post(exerciseId: string, set: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: {
        date: new Date().toISOString(),
        status: 'planned',
        exercises: [{ exerciseId, ...extra, sets: [set] }],
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json().workout.exercises[0];
  }

  it('resolves unit from the catalog default', async () => {
    expect((await post(HOLD, { durationSec: 30 })).unit).toBe('seconds');
    expect((await post(BAND, { reps: 15 })).unit).toBe('reps');
  });

  it('an explicit per-workout unit overrides the catalog default', async () => {
    expect((await post(BAND, { durationSec: 45 }, { unit: 'seconds' })).unit).toBe('seconds');
  });

  it('persists durationSec on a NON-cardio set and round-trips it', async () => {
    const we = await post(HOLD, { durationSec: 30 });
    expect(we.sets[0].durationSec).toBe(30);
    expect(we.sets[0].reps).toBeNull();
  });

  it('round-trips resistance, which used to be write-only', async () => {
    const we = await post(BAND, { reps: 15, resistance: 30 });
    expect(we.sets[0].resistance).toBe(30);
    // a band set carries no phantom weight
    expect(we.sets[0].weightKg).toBeNull();
  });

  it('the live-logging route persists resistance (it silently dropped it)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      cookies: { ovl_session: sessionCookie },
      payload: { date: new Date().toISOString(), status: 'in_progress', exercises: [{ exerciseId: BAND, sets: [] }] },
    });
    const w = created.json().workout;
    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/workouts/${w.id}/exercises/${w.exercises[0].id}/sets`,
      cookies: { ovl_session: sessionCookie },
      payload: { reps: 15, resistance: 30 },
    });
    expect(posted.statusCode).toBe(200);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/workouts/${w.id}`,
      cookies: { ovl_session: sessionCookie },
    });
    expect(fetched.json().workout.exercises[0].sets[0].resistance).toBe(30);
  });

  it('an unloaded set stores no weight', async () => {
    const we = await post(HOLD, { durationSec: 30 });
    expect(we.sets[0].weightKg).toBeNull();
  });
});

describe('generator', () => {
  it('generates a planned workout honoring progression from history', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: { muscles: ['chest'] },
    });
    expect(res.statusCode).toBe(200);
    const workout = res.json().workout;
    expect(workout.status).toBe('planned');
    expect(workout.mode).toBe('hypertrophy'); // user default
    expect(workout.exercises.length).toBeGreaterThan(0);
    const bench = workout.exercises.find(
      (e: { exerciseId: string }) => e.exerciseId === 'Test_Bench_Press',
    );
    // only catalog exercise for chest; double progression continues at last top weight
    expect(bench).toBeDefined();
    expect(bench.targetWeightKg).toBe(70);
    expect(bench.targetRepsLow).toBe(6);
    expect(bench.targetRepsHigh).toBe(10);
  });

  it('strength mode anchors weight to e1RM, uses 3-6 reps and a warm-up ramp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: { muscles: ['chest'], mode: 'strength' },
    });
    expect(res.statusCode).toBe(200);
    const workout = res.json().workout;
    expect(workout.mode).toBe('strength');
    const bench = workout.exercises.find(
      (e: { exerciseId: string }) => e.exerciseId === 'Test_Bench_Press',
    );
    expect(bench.targetRepsLow).toBe(3);
    expect(bench.targetRepsHigh).toBe(6);
    expect(bench.targetSets).toBe(5);
    // history: 10x60, 8x65, 6x70 -> e1RM ≈ 86.7; hypertrophy history is a
    // different rep zone, so the anchor applies: .95 * 86.7 / 1.2 ≈ 68.6 -> 67.5
    expect(bench.targetWeightKg).toBeGreaterThan(65);
    expect(bench.targetWeightKg).toBeLessThan(75);
    expect(bench.notes).toContain('Warm-up:');
  });

  it('power mode prescribes ~50% of e1RM with explosive cue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: { muscles: ['chest'], mode: 'power' },
    });
    expect(res.statusCode).toBe(200);
    const workout = res.json().workout;
    const bench = workout.exercises.find(
      (e: { exerciseId: string }) => e.exerciseId === 'Test_Bench_Press',
    );
    expect(bench.targetRepsHigh).toBe(5);
    // ~50% of e1RM ≈ 43 -> rounded to 2.5
    expect(bench.targetWeightKg).toBeGreaterThan(35);
    expect(bench.targetWeightKg).toBeLessThan(50);
    expect(bench.notes).toContain('velocity');
  });

  it('persists the user default training mode', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
      payload: { trainingMode: 'endurance' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().user.trainingMode).toBe('endurance');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: { muscles: ['chest'] },
    });
    expect(res.json().workout.mode).toBe('endurance');
    const bench = res.json().workout.exercises.find(
      (e: { exerciseId: string }) => e.exerciseId === 'Test_Bench_Press',
    );
    expect(bench.targetRepsLow).toBe(15);
    // reset for later tests
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      cookies: { ovl_session: sessionCookie },
      payload: { trainingMode: 'hypertrophy' },
    });
  });

  it('repeat calls with no explicit muscles return the same workout instead of duplicating (double-click safe)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().workout.id).toBe(first.json().workout.id);

    // explicit muscle targeting is exempt and still creates a new workout
    const explicit = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts/generate',
      cookies: { ovl_session: sessionCookie },
      payload: { muscles: ['chest'] },
    });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().workout.id).not.toBe(first.json().workout.id);
  });
});
