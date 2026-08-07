import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apiKeyCreateSchema } from '@overload/shared';
import { prisma } from '../lib/prisma.js';
import { newApiKey, sha256 } from '../lib/tokens.js';

export default async function apiKeyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.requireUser);

  r.get('/', async (request) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: request.user!.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
    };
  });

  r.post('/', { schema: { body: apiKeyCreateSchema } }, async (request) => {
    const token = newApiKey();
    const key = await prisma.apiKey.create({
      data: {
        userId: request.user!.id,
        name: request.body.name,
        keyHash: sha256(token),
        keyPrefix: token.slice(0, 12),
      },
    });
    // the only time the full token is ever returned
    return { id: key.id, name: key.name, token };
  });

  r.delete('/:id', { schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const key = await prisma.apiKey.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!key) return reply.code(404).send({ error: 'Not found' });
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    return { ok: true };
  });
}
