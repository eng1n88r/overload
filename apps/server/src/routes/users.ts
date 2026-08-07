import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';

/** Admin-only user management: the first account claims the instance and
 *  manages everyone else from Settings (create, reset password, promote,
 *  delete with all data, reopen registration). */
export default async function userRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireAdmin);

  r.get('/', async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    const counts = await Promise.all(
      users.map(async (u) => ({
        workouts: await prisma.workout.count({ where: { userId: u.id } }),
        plans: await prisma.plan.count({ where: { userId: u.id } }),
      })),
    );
    return {
      users: users.map((u, i) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        workouts: counts[i].workouts,
        plans: counts[i].plans,
      })),
    };
  });

  r.post(
    '/',
    {
      schema: {
        body: z.object({
          email: z.string().email(),
          name: z.string().min(1).max(100),
          password: z.string().min(8).max(200),
        }),
      },
    },
    async (request, reply) => {
      const { email, name, password } = request.body;
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing) return reply.code(409).send({ error: 'Email already registered' });
      const user = await prisma.user.create({
        data: { email: email.toLowerCase(), name, passwordHash: await argon2.hash(password), role: 'user' },
      });
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    },
  );

  r.patch(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          role: z.enum(['admin', 'user']).optional(),
          password: z.string().min(8).max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const target = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!target) return reply.code(404).send({ error: 'Not found' });
      const { role, password } = request.body;
      if (role === 'user' && target.role === 'admin') {
        const admins = await prisma.user.count({ where: { role: 'admin' } });
        if (admins <= 1) return reply.code(400).send({ error: 'Cannot demote the last admin' });
      }
      const user = await prisma.user.update({
        where: { id: target.id },
        data: {
          ...(role !== undefined ? { role } : {}),
          ...(password !== undefined ? { passwordHash: await argon2.hash(password) } : {}),
        },
      });
      if (password !== undefined) {
        // a password reset invalidates existing sessions for that user
        await prisma.session.deleteMany({ where: { userId: target.id } });
      }
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    },
  );

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.id === request.user!.id) {
      return reply.code(400).send({ error: 'Cannot delete your own account' });
    }
    // Workouts/body metrics/nutrition have no FK cascade to User; remove explicitly.
    // Plans, sessions and API keys cascade via the schema.
    await prisma.$transaction([
      prisma.workout.deleteMany({ where: { userId: target.id } }),
      prisma.bodyMetric.deleteMany({ where: { userId: target.id } }),
      prisma.nutritionLog.deleteMany({ where: { userId: target.id } }),
      prisma.user.delete({ where: { id: target.id } }),
    ]);
    return { ok: true };
  });

  r.get('/registration', async () => {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'registrationOpen' } });
    return { open: setting?.value === 'true' };
  });

  r.patch(
    '/registration',
    { schema: { body: z.object({ open: z.boolean() }) } },
    async (request) => {
      await prisma.appSetting.upsert({
        where: { key: 'registrationOpen' },
        update: { value: String(request.body.open) },
        create: { key: 'registrationOpen', value: String(request.body.open) },
      });
      return { open: request.body.open };
    },
  );
}
