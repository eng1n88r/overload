import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.js';

// Stateless streamable-HTTP MCP endpoint: each POST re-authenticates via the
// API key and gets a fresh server instance scoped to that user.
export function mountMcp(app: FastifyInstance) {
  app.post('/mcp', async (request, reply) => {
    if (!request.user || request.authVia !== 'apiKey') {
      return reply.code(401).send({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: pass an API key as "Authorization: Bearer ovl_..."' },
        id: null,
      });
    }
    const server = buildMcpServer(request.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    request.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  // Stateless server: no SSE stream or session teardown endpoints.
  const methodNotAllowed = async (_req: unknown, reply: any) =>
    reply.code(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: stateless MCP endpoint, use POST' },
      id: null,
    });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
