import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { nutritionQuerySchema, nutritionUpsertSchema } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

function toDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function serialize(l: {
  id: string;
  date: Date;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  note: string | null;
}) {
  return {
    id: l.id,
    date: l.date.toISOString().slice(0, 10),
    calories: l.calories,
    proteinG: l.proteinG,
    carbsG: l.carbsG,
    fatG: l.fatG,
    note: l.note,
  };
}

export default async function nutritionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', { schema: { querystring: nutritionQuerySchema } }, async (request) => {
    const { from, to, limit } = request.query;
    const logs = await prisma.nutritionLog.findMany({
      where: {
        userId: request.user!.id,
        ...(from || to
          ? { date: { ...(from ? { gte: toDay(from) } : {}), ...(to ? { lte: toDay(to) } : {}) } }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: limit,
    });
    return { logs: logs.map(serialize) };
  });

  r.put('/', { schema: { body: nutritionUpsertSchema } }, async (request) => {
    const { date, calories, proteinG, carbsG, fatG, note } = request.body;
    const data = {
      calories: calories ?? null,
      proteinG: proteinG ?? null,
      carbsG: carbsG ?? null,
      fatG: fatG ?? null,
      note: note ?? null,
    };
    const log = await prisma.nutritionLog.upsert({
      where: { userId_date: { userId: request.user!.id, date: toDay(date) } },
      update: data,
      create: { userId: request.user!.id, date: toDay(date), ...data },
    });
    return { log: serialize(log) };
  });

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const existing = await prisma.nutritionLog.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.nutritionLog.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}
