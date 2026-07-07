import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  return server;
}
