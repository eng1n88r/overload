import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { planCreateSchema, planUpdateSchema } from '@overload/shared';
import { prisma } from '../lib/prisma.js';
import {
  createPlanForUser,
  planInclude,
  serializePlan,
  updatePlanForUser,
  validateTemplateExercises,
} from '../services/plans.js';

export default async function planRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', async (request) => {
    const plans = await prisma.plan.findMany({
      where: { userId: request.user!.id },
      include: planInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return { plans: plans.map(serializePlan) };
  });

  r.get('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const plan = await prisma.plan.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
      include: planInclude,
    });
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    return { plan: serializePlan(plan) };
  });

  r.post('/', { schema: { body: planCreateSchema } }, async (request, reply) => {
    const body = request.body;
    const missing = await validateTemplateExercises(body.days);
    if (missing) return reply.code(400).send({ error: `Unknown exercise ids: ${missing.join(', ')}` });
    const plan = await createPlanForUser(request.user!.id, body, body.createdBy);
    return { plan: serializePlan(plan) };
  });

  r.patch(
    '/:id',
    { schema: { params: z.object({ id: z.string() }), body: planUpdateSchema } },
    async (request, reply) => {
      const body = request.body;
      if (body.days) {
        const missing = await validateTemplateExercises(body.days);
        if (missing) return reply.code(400).send({ error: `Unknown exercise ids: ${missing.join(', ')}` });
      }
      const plan = await updatePlanForUser(request.user!.id, request.params.id, body);
      if (!plan) return reply.code(404).send({ error: 'Not found' });
      return { plan: serializePlan(plan) };
    },
  );

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const existing = await prisma.plan.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.plan.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}
