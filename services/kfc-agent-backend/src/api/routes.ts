import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

export interface RouteOptions {
  fixturesRoot?: string;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function registerRoutes(server: FastifyInstance, options: RouteOptions = {}): void {
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  let clientsPromise: ReturnType<typeof loadGeneratedFixtures> | undefined;

  function getFixtures() {
    clientsPromise ??= loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
    return clientsPromise;
  }

  server.post('/chat/mock', async (request, reply) => {
    const parsed = chatPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: 'invalid_chat_payload',
        issues: parsed.error.issues,
      });
    }

    const clients = createMockClients(await getFixtures());
    return runAgentTurn({
      ...parsed.data,
      clients,
      store,
      dashboard,
    });
  });

  server.get('/dashboard/events/:sessionId', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { events: dashboard.getEvents(params.sessionId) };
  });

  server.get('/dashboard/sessions', async () => ({
    sessions: dashboard.listSessionSummaries(),
  }));

  server.get('/dashboard/sessions/:sessionId/turns', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { turns: await store.listTurns(params.sessionId) };
  });
}
