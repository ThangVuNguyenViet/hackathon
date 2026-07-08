import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ExternalClients } from '../clients/interfaces.js';
import type { MessengerHistorySyncCoordinator } from '../channels/messengerHistory.js';
import { createMessengerClient, normalizeMessengerWebhook, verifyMessengerChallenge } from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { createMockClients, type MockClientOptions } from '../mock/createMockClients.js';
import { MemoryStore, type ConversationStore } from '../persistence/memoryStore.js';

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

const messengerHistorySyncPayloadSchema = z
  .object({
    limitConversations: z.number().int().positive().optional(),
    since: z.string().datetime({ offset: true }).optional(),
  })
  .optional();

export interface ReadinessCheckResult {
  ok: boolean;
  message?: string;
  required?: boolean;
  configured?: boolean;
}

export interface ReadinessOptions {
  database?: () => Promise<ReadinessCheckResult>;
  fixturesRoot?: string;
  openAiConfigured?: boolean;
  openAiRequired?: boolean;
}

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
  store?: ConversationStore;
  dashboard?: DashboardEventBus;
  messengerHistorySync?: MessengerHistorySyncCoordinator;
  readiness?: ReadinessOptions;
}

function defaultFixturesRoot(): string {
  if (existsSync(join(process.cwd(), 'fixtures/generated'))) return process.cwd();
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function registerRoutes(server: FastifyInstance, options: RouteOptions = {}): void {
  const store = options.store ?? new MemoryStore();
  const dashboard = options.dashboard ?? new DashboardEventBus();
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
  }): Promise<{ ok: boolean; errorCode?: string }> {
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

    return {
      ok: sendResult.ok,
      errorCode: sendResult.ok ? undefined : sendResult.errorCode ?? 'assistant_reply_delivery_failed',
    };
  }

  server.get('/ready', async (_request, reply) => {
    const database = await runReadinessCheck(options.readiness?.database ?? (async () => ({ ok: true })));
    const fixtures = await checkFixtures(options.readiness?.fixturesRoot ?? options.fixturesRoot ?? defaultFixturesRoot());
    const messenger = checkMessengerConfig(options);
    const openai = {
      ok: options.readiness?.openAiRequired ? Boolean(options.readiness.openAiConfigured) : true,
      required: options.readiness?.openAiRequired ?? false,
      configured: options.readiness?.openAiConfigured ?? Boolean(options.responseComposer && options.toolPlanner),
    };
    const checks = { database, fixtures, messenger, openai };
    const ok = Object.values(checks).every((check) => check.ok);

    return reply.code(ok ? 200 : 503).send({
      ok,
      service: 'kfc-agent-backend',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

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
    const stats = { received: events.length, processed: 0, skippedDuplicates: 0, failed: 0 };
    if (events.length === 0) return stats;

    let clients: ExternalClients | undefined;

    for (const event of events) {
      const sessionId = `messenger:${event.externalThreadId}`;
      if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
        stats.skippedDuplicates += 1;
        continue;
      }
      const reservation = await store.reserveWebhookDelivery({
        channel: 'messenger',
        externalEventId: event.rawEventId,
        externalThreadId: event.externalThreadId,
        externalUserId: event.externalUserId,
        sessionId,
        receivedAt: event.receivedAt,
        payload: {
          eventType: event.eventType,
          text: event.text,
          receivedAt: event.receivedAt,
        },
      });
      if (!reservation.reserved) {
        stats.skippedDuplicates += 1;
        continue;
      }

      try {
        clients ??= await createWebhookClients();
        const output = await runAgentTurn({
          sessionId,
          customerId: event.externalUserId,
          channel: event.channel,
          text: event.text,
          externalMessageId: event.rawEventId,
          clients,
          store,
          dashboard,
          responseComposer: options.responseComposer,
          toolPlanner: options.toolPlanner,
        });
        const delivery = await deliverAssistantReply({
          clients,
          sessionId,
          externalUserId: event.externalUserId,
          responseText: output.responseText,
          channel: 'messenger',
        });
        if (delivery.ok) {
          await store.markWebhookDeliveryProcessed('messenger', event.rawEventId);
          stats.processed += 1;
        } else {
          await store.markWebhookDeliveryFailed('messenger', event.rawEventId, delivery.errorCode ?? 'assistant_reply_delivery_failed');
          stats.failed += 1;
        }
      } catch (error) {
        await store.markWebhookDeliveryFailed(
          'messenger',
          event.rawEventId,
          error instanceof Error ? error.message : 'Unknown Messenger webhook failure',
        );
        stats.failed += 1;
      }
    }

    return stats;
  });

  server.post('/webhooks/zalo', async (request) => {
    const events = normalizeZaloWebhook(request.body, options.zaloOaId);
    const stats = { received: events.length, processed: 0, skippedDuplicates: 0, failed: 0 };
    if (events.length === 0) return stats;

    let clients: ExternalClients | undefined;

    for (const event of events) {
      const sessionId = `zalo:${event.externalThreadId}`;
      if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
        stats.skippedDuplicates += 1;
        continue;
      }
      const reservation = await store.reserveWebhookDelivery({
        channel: 'zalo',
        externalEventId: event.rawEventId,
        externalThreadId: event.externalThreadId,
        externalUserId: event.externalUserId,
        sessionId,
        receivedAt: event.receivedAt,
        payload: {
          eventType: event.eventType,
          text: event.text,
          receivedAt: event.receivedAt,
        },
      });
      if (!reservation.reserved) {
        stats.skippedDuplicates += 1;
        continue;
      }

      try {
        clients ??= await createWebhookClients();
        const output = await runAgentTurn({
          sessionId,
          customerId: event.externalUserId,
          channel: event.channel,
          text: event.text,
          externalMessageId: event.rawEventId,
          clients,
          store,
          dashboard,
          responseComposer: options.responseComposer,
          toolPlanner: options.toolPlanner,
        });
        const delivery = await deliverAssistantReply({
          clients,
          sessionId,
          externalUserId: event.externalUserId,
          responseText: output.responseText,
          channel: 'zalo',
        });
        if (delivery.ok) {
          await store.markWebhookDeliveryProcessed('zalo', event.rawEventId);
          stats.processed += 1;
        } else {
          await store.markWebhookDeliveryFailed('zalo', event.rawEventId, delivery.errorCode ?? 'assistant_reply_delivery_failed');
          stats.failed += 1;
        }
      } catch (error) {
        await store.markWebhookDeliveryFailed(
          'zalo',
          event.rawEventId,
          error instanceof Error ? error.message : 'Unknown Zalo webhook failure',
        );
        stats.failed += 1;
      }
    }

    return stats;
  });

  server.post('/admin/messenger/sync-history', async (request, reply) => {
    if (!options.messengerHistorySync) {
      return reply.code(503).send({ errorCode: 'messenger_history_sync_not_configured' });
    }
    const parsed = messengerHistorySyncPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ errorCode: 'invalid_messenger_history_sync_payload', issues: parsed.error.issues });
    }
    return options.messengerHistorySync.sync(parsed.data ?? {});
  });

  server.get('/admin/messenger/sync-history/status', async () => {
    return options.messengerHistorySync?.getStatus() ?? {
      running: false,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: 'Messenger history sync is not configured',
      lastResult: null,
    };
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

async function runReadinessCheck(check: () => Promise<ReadinessCheckResult>): Promise<ReadinessCheckResult> {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Readiness check failed',
    };
  }
}

async function checkFixtures(fixturesRoot: string): Promise<ReadinessCheckResult> {
  try {
    const fixtures = await loadGeneratedFixtures(fixturesRoot);
    return {
      ok: fixtures.menuItems.length > 0 && fixtures.stores.length > 0,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Generated fixtures unavailable',
    };
  }
}

function checkMessengerConfig(options: RouteOptions): ReadinessCheckResult {
  const configured = Boolean(options.messengerVerifyToken && options.messengerPageAccessToken);
  return {
    ok: configured,
    configured,
    required: true,
  };
}
