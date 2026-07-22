import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type RouteOptions } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export type BuildServerOptions = RouteOptions;

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });
  const parseJson = server.getDefaultJsonParser('error', 'error');

  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      request.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      parseJson(request, request.rawBody.toString('utf8'), done);
    },
  );

  server.addHook('onClose', async () => {
    await options.agentTracer?.flush();
  });

  server.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (request.method === 'OPTIONS') {
      await reply.code(204).send();
    }
  });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  registerRoutes(server, options);

  return server;
}
