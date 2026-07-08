import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ExternalClients } from '../clients/interfaces.js';
import { createMessengerClient, normalizeMessengerWebhook, verifyMessengerChallenge } from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { createMockClients, type MockClientOptions } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

export interface RouteOptions {
  fixturesRoot?: string;
  messengerVerifyToken?: string;
  metaPageId?: string;
  messengerPageAccessToken?: string;
  messengerGraphApiBaseUrl?: string;
  messengerFetchImpl?: typeof fetch;
  zaloOaId?: string;
  zaloAccessToken?: string;
  zaloApiBaseUrl?: string;
  zaloFetchImpl?: typeof fetch;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  mockClientOptions?: MockClientOptions;
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

  async function createWebhookClients(): Promise<ExternalClients> {
    return createMockClients(await getFixtures(), {
      ...options.mockClientOptions,
      channelClients: {
        messenger: createMessengerClient({
          pageAccessToken: options.messengerPageAccessToken,
          graphApiBaseUrl: options.messengerGraphApiBaseUrl,
          fetchImpl: options.messengerFetchImpl,
        }),
        zalo: createZaloClient({
          accessToken: options.zaloAccessToken,
          apiBaseUrl: options.zaloApiBaseUrl,
          fetchImpl: options.zaloFetchImpl,
        }),
      },
    });
  }

  async function deliverAssistantReply(input: {
    clients: ExternalClients;
    sessionId: string;
    externalUserId: string;
    responseText: string;
    channel: 'messenger' | 'zalo';
  }): Promise<void> {
    const sendResult =
      input.channel === 'messenger'
        ? await input.clients.messenger.sendText(input.externalUserId, input.responseText)
        : await input.clients.zalo.sendText(input.externalUserId, input.responseText);
    const turns = await store.listTurns(input.sessionId);
    const pendingAssistantTurn = [...turns]
      .reverse()
      .find((turn) => turn.role === 'assistant' && turn.deliveryStatus === 'pending');

    if (pendingAssistantTurn) {
      await store.updateTurnDeliveryStatus(
        pendingAssistantTurn.id,
        sendResult.ok ? 'sent' : 'failed',
        sendResult.value?.messageId ?? null,
      );
    }

    dashboard.emitEvent({
      id: `dash_${input.sessionId}_assistant_${Date.now()}`,
      sessionId: input.sessionId,
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: sendResult.ok ? 'sent' : 'failed' },
      createdAt: new Date().toISOString(),
    });
  }

  server.post('/chat/mock', async (request, reply) => {
    const parsed = chatPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: 'invalid_chat_payload',
        issues: parsed.error.issues,
      });
    }

    const clients = createMockClients(await getFixtures(), {
      ...options.mockClientOptions,
      channelClients: {
        messenger: {
          async sendText() {
            return { ok: false, errorCode: 'channel_client_not_configured', message: 'Messenger client not configured' };
          },
        },
        zalo: {
          async sendText() {
            return { ok: false, errorCode: 'channel_client_not_configured', message: 'Zalo client not configured' };
          },
        },
      },
    });
    return runAgentTurn({
      ...parsed.data,
      clients,
      store,
      dashboard,
      responseComposer: options.responseComposer,
      toolPlanner: options.toolPlanner,
    });
  });

  server.get('/webhooks/messenger', async (request, reply) => {
    const result = verifyMessengerChallenge(request.query as Record<string, unknown>, options.messengerVerifyToken ?? '');
    reply.code(result.statusCode).type('text/plain');
    return result.body;
  });

  server.post('/webhooks/messenger', async (request) => {
    const events = normalizeMessengerWebhook(request.body, options.metaPageId ?? '118976205445198');
    if (events.length === 0) return { received: 0 };

    const clients = await createWebhookClients();

    for (const event of events) {
      const sessionId = `messenger:${event.externalThreadId}`;
      const output = await runAgentTurn({
        sessionId,
        customerId: event.externalUserId,
        channel: event.channel,
        text: event.text,
        clients,
        store,
        dashboard,
        responseComposer: options.responseComposer,
        toolPlanner: options.toolPlanner,
      });
      await deliverAssistantReply({
        clients,
        sessionId,
        externalUserId: event.externalUserId,
        responseText: output.responseText,
        channel: 'messenger',
      });
    }

    return { received: events.length };
  });

  server.post('/webhooks/zalo', async (request) => {
    const events = normalizeZaloWebhook(request.body, options.zaloOaId);
    if (events.length === 0) return { received: 0 };

    const clients = await createWebhookClients();

    for (const event of events) {
      const sessionId = `zalo:${event.externalThreadId}`;
      const output = await runAgentTurn({
        sessionId,
        customerId: event.externalUserId,
        channel: event.channel,
        text: event.text,
        clients,
        store,
        dashboard,
        responseComposer: options.responseComposer,
        toolPlanner: options.toolPlanner,
      });
      await deliverAssistantReply({
        clients,
        sessionId,
        externalUserId: event.externalUserId,
        responseText: output.responseText,
        channel: 'zalo',
      });
    }

    return { received: events.length };
  });

  server.get('/dashboard/events/:sessionId', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { events: dashboard.getEvents(params.sessionId) };
  });

  server.get('/dashboard/stream', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const unsubscribe = dashboard.subscribe((event) => {
      reply.raw.write(`event: dashboard\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  server.get('/dashboard/sessions', async () => ({
    sessions: dashboard.listSessionSummaries(),
  }));

  server.get('/dashboard/sessions/:sessionId/turns', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { turns: await store.listTurns(params.sessionId) };
  });
}
