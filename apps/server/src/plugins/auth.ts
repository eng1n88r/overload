import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { sha256 } from '../lib/tokens.js';

export const SESSION_COOKIE = 'ovl_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const SESSION_RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;
const KEY_USED_THROTTLE_MS = 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    authVia: 'session' | 'apiKey' | null;
  }
  interface FastifyInstance {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function resolveSession(token: string): Promise<User | null> {
  const id = sha256(token);
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  if (session.expiresAt.getTime() - now < SESSION_RENEW_BELOW_MS) {
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(now + SESSION_TTL_MS) },
    });
  }
  return session.user;
}

async function resolveApiKey(token: string): Promise<User | null> {
  const keyHash = sha256(token);
  const key = await prisma.apiKey.findUnique({ where: { keyHash }, include: { user: true } });
  if (!key || key.revokedAt) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > KEY_USED_THROTTLE_MS) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  return key.user;
}

export default fp(async (app) => {
  app.decorateRequest('user', null);
  app.decorateRequest('authVia', null);

  app.addHook('onRequest', async (request) => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (sessionToken) {
      request.user = await resolveSession(sessionToken);
      if (request.user) {
        request.authVia = 'session';
        return;
      }
    }
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ovl_')) {
      request.user = await resolveApiKey(auth.slice('Bearer '.length));
      if (request.user) request.authVia = 'apiKey';
    }
  });

  app.decorate('requireUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.code(401).send({ error: 'Unauthorized' });
    } else if (request.user.role !== 'admin') {
      await reply.code(403).send({ error: 'Forbidden' });
    }
  });
});

export const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: false, // home-server over LAN http; flip via reverse proxy if exposed
  maxAge: SESSION_TTL_MS / 1000,
};

export { SESSION_TTL_MS };
