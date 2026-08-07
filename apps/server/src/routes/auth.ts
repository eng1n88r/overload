import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import argon2 from 'argon2';
import { loginBodySchema, registerBodySchema } from '@overload/shared';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { newSessionToken, sha256 } from '../lib/tokens.js';
import { SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from '../plugins/auth.js';

function toPublic(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    unitPreference: user.unitPreference,
    distanceUnitPreference: user.distanceUnitPreference,
    trainingMode: user.trainingMode,
    avatar: user.avatar,
  };
}

/** Small square avatar shipped as a data URL; the client downscales before upload. */
const avatarSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
  .max(200_000);

async function startSession(userId: string) {
  const token = newSessionToken();
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/register', { schema: { body: registerBodySchema } }, async (request, reply) => {
    const { email, name, password } = request.body;
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      const setting = await prisma.appSetting.findUnique({ where: { key: 'registrationOpen' } });
      if (setting?.value !== 'true') {
        return reply.code(403).send({ error: 'Registration is closed' });
      }
    }
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return reply.code(409).send({ error: 'Email already registered' });

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash: await argon2.hash(password),
        role: userCount === 0 ? 'admin' : 'user',
      },
    });
    if (userCount === 0) {
      // first account claims the instance; close the door behind it
      await prisma.appSetting.upsert({
        where: { key: 'registrationOpen' },
        update: { value: 'false' },
        create: { key: 'registrationOpen', value: 'false' },
      });
    }
    const token = await startSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
    return { user: toPublic(user) };
  });

  r.post('/login', { schema: { body: loginBodySchema } }, async (request, reply) => {
    const { email, password } = request.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    const token = await startSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
    return { user: toPublic(user) };
  });

  r.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await prisma.session.deleteMany({ where: { id: sha256(token) } });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  r.get('/me', { preHandler: app.requireUser }, async (request) => {
    return { user: toPublic(request.user!), equipment: JSON.parse(request.user!.equipment || '[]') };
  });

  r.patch(
    '/me',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          unitPreference: z.enum(['kg', 'lb']).optional(),
          distanceUnitPreference: z.enum(['km', 'mi']).optional(),
          equipment: z.array(z.string()).optional(),
          trainingMode: z.enum(['strength', 'hypertrophy', 'endurance', 'power']).optional(),
          avatar: avatarSchema.nullable().optional(),
        }),
      },
    },
    async (request) => {
      const { name, unitPreference, distanceUnitPreference, equipment, trainingMode, avatar } = request.body;
      const user = await prisma.user.update({
        where: { id: request.user!.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(unitPreference !== undefined ? { unitPreference } : {}),
          ...(distanceUnitPreference !== undefined ? { distanceUnitPreference } : {}),
          ...(equipment !== undefined ? { equipment: JSON.stringify(equipment) } : {}),
          ...(trainingMode !== undefined ? { trainingMode } : {}),
          ...(avatar !== undefined ? { avatar } : {}),
        },
      });
      return { user: toPublic(user), equipment: JSON.parse(user.equipment || '[]') };
    },
  );

  r.get('/registration-open', async () => {
    const userCount = await prisma.user.count();
    if (userCount === 0) return { open: true, firstUser: true };
    const setting = await prisma.appSetting.findUnique({ where: { key: 'registrationOpen' } });
    return { open: setting?.value === 'true', firstUser: false };
  });
}
