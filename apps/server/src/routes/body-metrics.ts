import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { bodyMetricQuerySchema, bodyMetricUpsertSchema } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

function toDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export default async function bodyMetricRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', { schema: { querystring: bodyMetricQuerySchema } }, async (request) => {
    const { type, from, to, limit } = request.query;
    const metrics = await prisma.bodyMetric.findMany({
      where: {
        userId: request.user!.id,
        ...(type ? { type } : {}),
        ...(from || to
          ? { date: { ...(from ? { gte: toDay(from) } : {}), ...(to ? { lte: toDay(to) } : {}) } }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: limit,
    });
    return {
      metrics: metrics.map((m) => ({
        id: m.id,
        date: m.date.toISOString().slice(0, 10),
        type: m.type,
        value: m.value,
        unit: m.unit,
      })),
    };
  });

  r.get('/types', async (request) => {
    const rows = await prisma.bodyMetric.findMany({
      where: { userId: request.user!.id },
      distinct: ['type'],
      select: { type: true },
    });
    return { types: rows.map((t) => t.type) };
  });

  r.put('/', { schema: { body: bodyMetricUpsertSchema } }, async (request) => {
    const { date, type, value, unit } = request.body;
    const metric = await prisma.bodyMetric.upsert({
      where: {
        userId_date_type: { userId: request.user!.id, date: toDay(date), type },
      },
      update: { value, unit },
      create: { userId: request.user!.id, date: toDay(date), type, value, unit },
    });
    return { metric: { id: metric.id, date, type, value: metric.value, unit: metric.unit } };
  });

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const existing = await prisma.bodyMetric.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.bodyMetric.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}
