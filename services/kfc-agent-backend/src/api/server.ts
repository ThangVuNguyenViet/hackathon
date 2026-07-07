import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type RouteOptions } from './routes.js';

export type BuildServerOptions = RouteOptions;

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  registerRoutes(server, options);

  return server;
}
