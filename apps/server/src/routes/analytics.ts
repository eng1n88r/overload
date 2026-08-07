import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getE1RMSeries, getMuscleWeeklySets, getPRs, getWeeklyVolume, weekStart } from '../services/analytics.js';
import { getRecoveryState } from '../services/recovery.js';

const weeksQuery = z.object({ weeks: z.coerce.number().int().min(1).max(260).default(12) });

export default async function analyticsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/volume', { schema: { querystring: weeksQuery } }, async (request) => {
    return { weeks: await getWeeklyVolume(request.user!.id, request.query.weeks) };
  });

  r.get('/muscle-volume', { schema: { querystring: weeksQuery } }, async (request) => {
    return { muscles: await getMuscleWeeklySets(request.user!.id, request.query.weeks) };
  });

  r.get(
    '/e1rm/:exerciseId',
    { schema: { params: z.object({ exerciseId: z.string() }) } },
    async (request) => {
      return { series: await getE1RMSeries(request.user!.id, request.params.exerciseId) };
    },
  );

  r.get('/prs', async (request) => {
    return { prs: await getPRs(request.user!.id) };
  });

  r.get('/recovery', async (request) => {
    return { muscles: await getRecoveryState(request.user!.id) };
  });

  r.get('/dashboard', async (request) => {
    const userId = request.user!.id;
    const [volume, muscles, recovery, recent, planned] = await Promise.all([
      getWeeklyVolume(userId, 12),
      getMuscleWeeklySets(userId, 4),
      getRecoveryState(userId),
      prisma.workout.findMany({
        where: { userId, status: 'completed' },
        orderBy: { date: 'desc' },
        take: 5,
        include: { exercises: { include: { exercise: { select: { name: true } } }, orderBy: { order: 'asc' } } },
      }),
      prisma.workout.findMany({
        where: { userId, status: { in: ['planned', 'in_progress'] } },
        orderBy: { date: 'asc' },
        take: 3,
        include: { exercises: { include: { exercise: { select: { name: true } } }, orderBy: { order: 'asc' } } },
      }),
    ]);

    const thisWeek = weekStart(new Date());
    const current = volume.find((w) => w.week === thisWeek);
    return {
      thisWeek: { volumeKg: current?.volumeKg ?? 0, sets: current?.sets ?? 0, workouts: current?.workouts ?? 0 },
      weeklyVolume: volume,
      muscleWeeklySets: muscles,
      recovery,
      recentWorkouts: recent.map((w) => ({
        id: w.id,
        date: w.date.toISOString(),
        name: w.name,
        exerciseNames: w.exercises.map((e) => e.exercise.name),
      })),
      upcomingWorkouts: planned.map((w) => ({
        id: w.id,
        date: w.date.toISOString(),
        name: w.name,
        status: w.status,
        exerciseNames: w.exercises.map((e) => e.exercise.name),
      })),
    };
  });
}
