import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  generateWorkoutSchema,
  setEntrySchema,
  setUpdateSchema,
  workoutCreateSchema,
  workoutListQuerySchema,
  workoutUpdateSchema,
} from '@overload/shared';
import { prisma } from '../lib/prisma.js';
import { generateWorkout } from '../services/generator/index.js';
import {
  createWorkoutForUser,
  exercisesCreateData,
  serializeWorkout,
  validateExerciseIds,
  workoutInclude,
} from '../services/workouts.js';

export default async function workoutRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', { schema: { querystring: workoutListQuerySchema } }, async (request) => {
    const { from, to, status, exerciseId, limit, offset } = request.query;
    const where: Prisma.WorkoutWhereInput = {
      userId: request.user!.id,
      ...(from || to
        ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
      ...(status ? { status } : {}),
      ...(exerciseId ? { exercises: { some: { exerciseId } } } : {}),
    };
    const [total, workouts] = await Promise.all([
      prisma.workout.count({ where }),
      prisma.workout.findMany({
        where,
        include: workoutInclude,
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);
    return { total, workouts: workouts.map(serializeWorkout) };
  });

  r.get('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const workout = await prisma.workout.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
      include: workoutInclude,
    });
    if (!workout) return reply.code(404).send({ error: 'Not found' });
    return { workout: serializeWorkout(workout) };
  });

  r.post('/', { schema: { body: workoutCreateSchema } }, async (request, reply) => {
    const body = request.body;
    const missing = await validateExerciseIds(body.exercises);
    if (missing) return reply.code(400).send({ error: `Unknown exercise ids: ${missing.join(', ')}` });
    const { workout, created } = await createWorkoutForUser(request.user!.id, body);
    return { workout: serializeWorkout(workout), created };
  });

  r.patch(
    '/:id',
    { schema: { params: z.object({ id: z.string() }), body: workoutUpdateSchema } },
    async (request, reply) => {
      const existing = await prisma.workout.findFirst({
        where: { id: request.params.id, userId: request.user!.id },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      const body = request.body;
      if (body.exercises) {
        const missing = await validateExerciseIds(body.exercises);
        if (missing) return reply.code(400).send({ error: `Unknown exercise ids: ${missing.join(', ')}` });
      }
      const workout = await prisma.workout.update({
        where: { id: existing.id },
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
        include: workoutInclude,
      });
      return { workout: serializeWorkout(workout) };
    },
  );

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const existing = await prisma.workout.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.workout.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  r.post('/generate', { schema: { body: generateWorkoutSchema } }, async (request, reply) => {
    const { date, planDayId, muscles, mode } = request.body;
    const id = await generateWorkout(request.user!.id, {
      date: date ? new Date(date) : undefined,
      planDayId,
      muscles,
      mode,
    });
    const workout = await prisma.workout.findUniqueOrThrow({ where: { id }, include: workoutInclude });
    return { workout: serializeWorkout(workout) };
  });

  r.post('/:id/start', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const existing = await prisma.workout.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const workout = await prisma.workout.update({
      where: { id: existing.id },
      data: { status: 'in_progress' },
      include: workoutInclude,
    });
    return { workout: serializeWorkout(workout) };
  });

  r.post(
    '/:id/complete',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ durationSec: z.number().int().positive().nullish() }),
      },
    },
    async (request, reply) => {
      const existing = await prisma.workout.findFirst({
        where: { id: request.params.id, userId: request.user!.id },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      const workout = await prisma.workout.update({
        where: { id: existing.id },
        data: { status: 'completed', durationSec: request.body.durationSec ?? existing.durationSec },
        include: workoutInclude,
      });
      return { workout: serializeWorkout(workout) };
    },
  );

  // Live logging: append one set to a workout exercise.
  r.post(
    '/:id/exercises/:weId/sets',
    {
      schema: {
        params: z.object({ id: z.string(), weId: z.string() }),
        body: setEntrySchema,
      },
    },
    async (request, reply) => {
      const we = await prisma.workoutExercise.findFirst({
        where: { id: request.params.weId, workoutId: request.params.id, workout: { userId: request.user!.id } },
        include: {
          sets: { orderBy: { order: 'desc' }, take: 1 },
          exercise: { select: { loadFactor: true } },
        },
      });
      if (!we) return reply.code(404).send({ error: 'Not found' });
      const b = request.body;
      const set = await prisma.setEntry.create({
        data: {
          workoutExerciseId: we.id,
          order: (we.sets[0]?.order ?? -1) + 1,
          reps: b.reps ?? null,
          weightKg: b.weightKg ?? null,
          durationSec: b.durationSec ?? null,
          distanceM: b.distanceM ?? null,
          // Dropped here until now: the live logger posts every set through
          // this route, so band resistance never reached the database.
          resistance: b.resistance ?? null,
          incline: b.incline ?? null,
          isWarmup: b.isWarmup,
          multiplier: b.multiplier ?? we.exercise.loadFactor,
          rpe: b.rpe ?? null,
          note: b.note ?? null,
          completedAt: b.completedAt ? new Date(b.completedAt) : new Date(),
        },
      });
      return { set: { id: set.id, order: set.order } };
    },
  );

  // Revise a logged set. The live logger asks for RPE during the rest that
  // follows the set, so the value arrives after the row already exists.
  r.patch(
    '/:id/exercises/:weId/sets/:setId',
    {
      schema: {
        params: z.object({ id: z.string(), weId: z.string(), setId: z.string() }),
        body: setUpdateSchema,
      },
    },
    async (request, reply) => {
      const set = await prisma.setEntry.findFirst({
        where: {
          id: request.params.setId,
          workoutExerciseId: request.params.weId,
          workoutExercise: { workoutId: request.params.id, workout: { userId: request.user!.id } },
        },
      });
      if (!set) return reply.code(404).send({ error: 'Not found' });
      const b = request.body;
      const updated = await prisma.setEntry.update({
        where: { id: set.id },
        // PATCH: an omitted field stays as it was; an explicit null clears it.
        data: {
          ...(b.rpe !== undefined ? { rpe: b.rpe } : {}),
          ...(b.note !== undefined ? { note: b.note } : {}),
        },
      });
      return { set: { id: updated.id, rpe: updated.rpe, note: updated.note } };
    },
  );

  r.delete(
    '/:id/exercises/:weId/sets/:setId',
    { schema: { params: z.object({ id: z.string(), weId: z.string(), setId: z.string() }) } },
    async (request, reply) => {
      const set = await prisma.setEntry.findFirst({
        where: {
          id: request.params.setId,
          workoutExerciseId: request.params.weId,
          workoutExercise: { workoutId: request.params.id, workout: { userId: request.user!.id } },
        },
      });
      if (!set) return reply.code(404).send({ error: 'Not found' });
      await prisma.setEntry.delete({ where: { id: set.id } });
      return { ok: true };
    },
  );
}
