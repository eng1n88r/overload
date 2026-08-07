import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { exerciseListQuerySchema } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

export function serializeExercise(
  ex: Prisma.ExerciseGetPayload<{ include: { muscles: true } }>,
) {
  return {
    id: ex.id,
    name: ex.name,
    category: ex.category,
    force: ex.force,
    level: ex.level,
    mechanic: ex.mechanic,
    equipment: ex.equipment,
    apparatus: ex.apparatus,
    instructions: JSON.parse(ex.instructions) as string[],
    images: (JSON.parse(ex.images) as string[]).map((p) => `/img/exercises/${p}`),
    isCustom: ex.isCustom,
    primaryMuscles: ex.muscles.filter((m) => m.role === 'primary').map((m) => m.muscle),
    secondaryMuscles: ex.muscles.filter((m) => m.role === 'secondary').map((m) => m.muscle),
  };
}

export default async function exerciseRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', { schema: { querystring: exerciseListQuerySchema } }, async (request) => {
    const { search, muscle, equipment, category, limit, offset } = request.query;
    const where: Prisma.ExerciseWhereInput = {
      ...(search ? { name: { contains: search } } : {}),
      ...(category ? { category } : {}),
      // The filter value may be a broad equipment item or a specific apparatus.
      ...(equipment ? { OR: [{ equipment }, { apparatus: equipment }] } : {}),
      ...(muscle ? { muscles: { some: { muscle } } } : {}),
    };
    const [total, exercises] = await Promise.all([
      prisma.exercise.count({ where }),
      prisma.exercise.findMany({
        where,
        include: { muscles: true },
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
    ]);
    return { total, exercises: exercises.map(serializeExercise) };
  });

  r.get('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const ex = await prisma.exercise.findUnique({
      where: { id: request.params.id },
      include: { muscles: true, aliases: true },
    });
    if (!ex) return reply.code(404).send({ error: 'Not found' });
    return { exercise: { ...serializeExercise(ex), aliases: ex.aliases.map((a) => a.alias) } };
  });
}
