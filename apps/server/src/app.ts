import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/api-keys.js';
import exerciseRoutes from './routes/exercises.js';
import workoutRoutes from './routes/workouts.js';
import analyticsRoutes from './routes/analytics.js';
import bodyMetricRoutes from './routes/body-metrics.js';
import nutritionRoutes from './routes/nutrition.js';
import planRoutes from './routes/plans.js';
import userRoutes from './routes/users.js';
import { mountMcp } from './mcp/transport.js';

export async function buildServer(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me' });
  await app.register(authPlugin);

  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../prisma/seed-data/images', import.meta.url)),
    prefix: '/img/exercises/',
    maxAge: '7d',
  });

  app.get('/api/v1/health', async () => ({ status: 'ok', version: '0.1.0' }));
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(apiKeyRoutes, { prefix: '/api/v1/api-keys' });
  await app.register(exerciseRoutes, { prefix: '/api/v1/exercises' });
  await app.register(workoutRoutes, { prefix: '/api/v1/workouts' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(bodyMetricRoutes, { prefix: '/api/v1/body-metrics' });
  await app.register(nutritionRoutes, { prefix: '/api/v1/nutrition' });
  await app.register(planRoutes, { prefix: '/api/v1/plans' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  mountMcp(app);

  // Serve the built SPA when present (production container); Vite serves it in dev.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDist)) {
    // Nothing was compressing the bundles, so a cold load pulled ~700 KB of text
    // over the wire for what gzip turns into a fraction of that. Registered
    // before the static plugin so its replies go through the encoder.
    await app.register(fastifyCompress, {
      global: true,
      encodings: ['br', 'gzip', 'deflate'],
      threshold: 1024,
    });
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: false,
      maxAge: '1h',
      index: ['index.html'],
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.raw.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/mcp') &&
        !request.url.startsWith('/img/')
      ) {
        return reply.sendFile('index.html', webDist);
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
