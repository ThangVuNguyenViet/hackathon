import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ExternalClients } from '../clients/interfaces.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { MessengerHistorySyncCoordinator } from '../channels/messengerHistory.js';
import { createMessengerClient, normalizeMessengerWebhook, verifyMessengerChallenge } from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { ConversationTurnMetadata } from '../domain/types.js';
import { normalizeGenUiActionToText } from '../genui/kfcGenUi.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { createMockClients, type MockClientOptions } from '../mock/createMockClients.js';
import { MemoryStore, type ConversationStore } from '../persistence/memoryStore.js';
import { sessionIdForConversationEvent } from '../session/sessionContext.js';

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

const genUiActionPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  action: z.object({
    attachmentId: z.string(),
    actionId: z.string(),
    value: z.string().optional(),
    payload: z.record(z.unknown()).optional(),
  }),
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
  fixtures?: GeneratedFixtures;
  store?: ConversationStore;
  dashboard?: DashboardEventBus;
  messengerHistorySync?: MessengerHistorySyncCoordinator;
  readiness?: ReadinessOptions;
}

export interface HandlerResponse<T = unknown> {
  status: number;
  body: T;
  contentType?: string;
}

export interface RouteHandlers {
  store: ConversationStore;
  dashboard: DashboardEventBus;
  health(): HandlerResponse;
  ready(): Promise<HandlerResponse>;
  chatMock(body: unknown): Promise<HandlerResponse>;
  chatGenUiAction(body: unknown): Promise<HandlerResponse>;
  messengerVerify(query: Record<string, unknown>): HandlerResponse<string>;
  messengerWebhook(body: unknown): Promise<HandlerResponse>;
  zaloWebhook(body: unknown): Promise<HandlerResponse>;
  messengerHistorySync(body: unknown): Promise<HandlerResponse>;
  messengerHistorySyncStatus(): HandlerResponse;
  dashboardEvents(sessionId: string): HandlerResponse;
  dashboardSessions(): Promise<HandlerResponse>;
  dashboardTurns(sessionId: string): Promise<HandlerResponse>;
}

function defaultFixturesRoot(): string {
  if (existsSync(join(process.cwd(), 'fixtures/generated'))) return process.cwd();
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function createRouteHandlers(options: RouteOptions = {}): RouteHandlers {
  const store = options.store ?? new MemoryStore();
  const dashboard = options.dashboard ?? new DashboardEventBus();
  let clientsPromise: ReturnType<typeof loadGeneratedFixtures> | undefined;

  function getFixtures() {
    if (options.fixtures) return Promise.resolve(options.fixtures);
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

  function createDeliveryClients(): Pick<ExternalClients, 'messenger' | 'zalo'> {
    return {
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
    };
  }

  async function deliverAssistantReply(input: {
    clients: Pick<ExternalClients, 'messenger' | 'zalo'>;
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

  async function persistEventProfile(event: ConversationEvent): Promise<void> {
    if (event.profile?.displayName || event.profile?.avatarUrl) {
      await store.upsertProfile(event.profile);
    }
  }

  function turnMetadataFor(event: ConversationEvent): ConversationTurnMetadata | null {
    if (!event.platformEventName && !event.attachments?.length && !event.rawEvent) return null;
    return {
      platformEventName: event.platformEventName,
      attachments: event.attachments,
      rawEvent: event.rawEvent,
    };
  }

  function emitConversationTurnCreatedEvent(turn: {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    channel: ConversationEvent['channel'];
    deliveryStatus: 'received' | 'pending' | 'sent' | 'failed' | 'not_applicable';
    externalMessageId: string | null;
    externalUserId: string | null;
    text: string;
    metadata?: ConversationTurnMetadata | null;
  }): void {
    dashboard.emitEvent({
      id: `dash_${turn.sessionId}_conversation_turn_created_${dashboard.getEvents(turn.sessionId).length + 1}`,
      sessionId: turn.sessionId,
      type: 'conversation_turn_created',
      payload: {
        turnId: turn.id,
        role: turn.role,
        channel: turn.channel,
        deliveryStatus: turn.deliveryStatus,
        externalMessageId: turn.externalMessageId,
        externalUserId: turn.externalUserId,
        text: turn.text,
        metadata: turn.metadata ?? null,
      },
      createdAt: new Date().toISOString(),
    });
  }

  async function persistNonAgentInboundEvent(sessionId: string, event: ConversationEvent): Promise<void> {
    const turn = await store.appendTurn({
      sessionId,
      channel: event.channel,
      role: 'user',
      text: event.text,
      externalMessageId: event.rawEventId,
      externalUserId: event.externalUserId,
      deliveryStatus: 'received',
      metadata: turnMetadataFor(event),
    });
    dashboard.emitEvent({
      id: `dash_${sessionId}_customer_message_received_${dashboard.getEvents(sessionId).length + 1}`,
      sessionId,
      type: 'customer_message_received',
      payload: {
        turnId: turn.id,
        channel: turn.channel,
        externalMessageId: turn.externalMessageId,
        externalUserId: turn.externalUserId,
        text: turn.text,
        metadata: turn.metadata,
      },
      createdAt: new Date().toISOString(),
    });
    emitConversationTurnCreatedEvent(turn);
  }

  return {
    store,
    dashboard,
    health() {
      return { status: 200, body: { ok: true, service: 'kfc-agent-backend' } };
    },
    async ready() {
      const database = await runReadinessCheck(options.readiness?.database ?? (async () => ({ ok: true })));
      const fixtures = options.fixtures
        ? { ok: options.fixtures.menuItems.length > 0 && options.fixtures.stores.length > 0 }
        : await checkFixtures(options.readiness?.fixturesRoot ?? options.fixturesRoot ?? defaultFixturesRoot());
      const messenger = checkMessengerConfig(options);
      const zalo = checkZaloConfig(options);
      const openai = {
        ok: options.readiness?.openAiRequired ? Boolean(options.readiness.openAiConfigured) : true,
        required: options.readiness?.openAiRequired ?? false,
        configured: options.readiness?.openAiConfigured ?? Boolean(options.responseComposer && options.toolPlanner),
      };
      const checks = { database, fixtures, messenger, zalo, openai };
      const ok = Object.values(checks).every((check) => check.ok);

      return {
        status: ok ? 200 : 503,
        body: {
          ok,
          service: 'kfc-agent-backend',
          checks,
          timestamp: new Date().toISOString(),
        },
      };
    },
    async chatMock(body: unknown) {
      const parsed = chatPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: 'invalid_chat_payload',
            issues: parsed.error.issues,
          },
        };
      }

      const clients = createMockClients(await getFixtures(), {
        ...options.mockClientOptions,
        channelClients: {
          messenger: {
            async sendText() {
              return { ok: false, errorCode: 'channel_client_not_configured', message: 'Messenger client not configured' };
            },
            async getProfile() {
              return { ok: false, errorCode: 'channel_client_not_configured', message: 'Messenger client not configured' };
            },
          },
          zalo: {
            async sendText() {
              return { ok: false, errorCode: 'channel_client_not_configured', message: 'Zalo client not configured' };
            },
            async getProfile() {
              return { ok: false, errorCode: 'channel_client_not_configured', message: 'Zalo client not configured' };
            },
          },
        },
      });
      return {
        status: 200,
        body: await runAgentTurn({
          ...parsed.data,
          clients,
          store,
          dashboard,
          responseComposer: options.responseComposer,
          toolPlanner: options.toolPlanner,
        }),
      };
    },
    async chatGenUiAction(body: unknown) {
      const parsed = genUiActionPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: 'invalid_genui_action_payload',
            issues: parsed.error.issues,
          },
        };
      }

      const clients = createMockClients(await getFixtures(), options.mockClientOptions);
      return {
        status: 200,
        body: await runAgentTurn({
          sessionId: parsed.data.sessionId,
          customerId: parsed.data.customerId,
          channel: parsed.data.channel,
          text: normalizeGenUiActionToText(parsed.data.action),
          clients,
          store,
          dashboard,
          metadata: { rawEvent: { genUiAction: parsed.data.action } },
          responseComposer: options.responseComposer,
          toolPlanner: options.toolPlanner,
        }),
      };
    },
    messengerVerify(query: Record<string, unknown>) {
      const result = verifyMessengerChallenge(query, options.messengerVerifyToken ?? '');
      return { status: result.statusCode, body: result.body, contentType: 'text/plain' };
    },
    async messengerWebhook(body: unknown) {
      const events = normalizeMessengerWebhook(body, options.metaPageId ?? '118976205445198');
      const stats = { received: events.length, processed: 0, skippedDuplicates: 0, failed: 0 };
      if (events.length === 0) return { status: 200, body: stats };

      let clients: ExternalClients | undefined;

      for (const event of events) {
        const sessionId = sessionIdForConversationEvent(event);
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
          await persistEventProfile(event);
          clients ??= await createWebhookClients();
          const profileResult = await clients.messenger.getProfile(event.externalUserId);
          if (profileResult.ok) {
            const profile = profileResult.value;
            await store.upsertProfile({
              channel: 'messenger',
              externalUserId: event.externalUserId,
              displayName: profile?.displayName ?? null,
              avatarUrl: profile?.avatarUrl ?? null,
              profileSource: profile?.profileSource ?? 'messenger_profile_api',
              profileUpdatedAt: new Date().toISOString(),
            });
          }
          const output = await runAgentTurn({
            sessionId,
            customerId: event.externalUserId,
            channel: event.channel,
            text: event.text,
            externalMessageId: event.rawEventId,
            metadata: turnMetadataFor(event),
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

      return { status: 200, body: stats };
    },
    async zaloWebhook(body: unknown) {
      const events = normalizeZaloWebhook(body, options.zaloOaId);
      const stats = { received: events.length, processed: 0, skippedDuplicates: 0, failed: 0 };
      if (events.length === 0) return { status: 200, body: stats };

      let clients: ExternalClients | undefined;

      for (const event of events) {
        const sessionId = sessionIdForConversationEvent(event);
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
          await persistEventProfile(event);

          if (!event.shouldRunAgent) {
            await persistNonAgentInboundEvent(sessionId, event);
            const deliveryClients = createDeliveryClients();
            const acknowledgement = event.acknowledgementText;
            if (acknowledgement) {
              const assistantTurn = await store.appendTurn({
                sessionId,
                channel: event.channel,
                role: 'assistant',
                text: acknowledgement,
                externalMessageId: null,
                externalUserId: event.externalUserId,
                deliveryStatus: 'pending',
                metadata: null,
              });
              emitConversationTurnCreatedEvent(assistantTurn);
              const delivery = await deliverAssistantReply({
                clients: deliveryClients,
                sessionId,
                externalUserId: event.externalUserId,
                responseText: acknowledgement,
                channel: 'zalo',
              });
              if (!delivery.ok) {
                await store.markWebhookDeliveryFailed('zalo', event.rawEventId, delivery.errorCode ?? 'assistant_reply_delivery_failed');
                stats.failed += 1;
                continue;
              }
            }
            await store.markWebhookDeliveryProcessed('zalo', event.rawEventId);
            stats.processed += 1;
            continue;
          }

          clients ??= await createWebhookClients();
          const output = await runAgentTurn({
            sessionId,
            customerId: event.externalUserId,
            channel: event.channel,
            text: event.text,
            externalMessageId: event.rawEventId,
            metadata: turnMetadataFor(event),
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

      return { status: 200, body: stats };
    },
    async messengerHistorySync(body: unknown) {
      if (!options.messengerHistorySync) {
        return { status: 503, body: { errorCode: 'messenger_history_sync_not_configured' } };
      }
      const parsed = messengerHistorySyncPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return { status: 400, body: { errorCode: 'invalid_messenger_history_sync_payload', issues: parsed.error.issues } };
      }
      return { status: 200, body: await options.messengerHistorySync.sync(parsed.data ?? {}) };
    },
    messengerHistorySyncStatus() {
      return {
        status: 200,
        body: options.messengerHistorySync?.getStatus() ?? {
          running: false,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastError: 'Messenger history sync is not configured',
          lastResult: null,
        },
      };
    },
    dashboardEvents(sessionId: string) {
      return { status: 200, body: { events: dashboard.getEvents(sessionId) } };
    },
    async dashboardSessions() {
      const summaries = await Promise.all(
        dashboard.listSessionSummaries().map(async (summary) => {
          const [channel, externalUserId] = summary.sessionId.split(':', 2);
          const profile =
            channel === 'messenger' || channel === 'zalo'
              ? await store.getProfile(channel, externalUserId)
              : undefined;
          return {
            ...summary,
            externalUserId: externalUserId ?? null,
            displayName: profile?.displayName ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            deeplink: deeplinkForSession(summary.sessionId),
          };
        }),
      );
      return { status: 200, body: { sessions: summaries } };
    },
    async dashboardTurns(sessionId: string) {
      return { status: 200, body: { turns: await store.listTurns(sessionId) } };
    },
  };
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

function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
  const configured = Boolean(options.zaloOaId && options.zaloAccessToken);
  return {
    ok: configured,
    configured,
    required: true,
  };
}

function deeplinkForSession(sessionId: string): {
  status: 'available' | 'unavailable';
  url: string | null;
  reason?: string;
} {
  if (sessionId.startsWith('messenger:')) {
    return { status: 'unavailable', url: null, reason: 'messenger_deeplink_unverified' };
  }
  if (sessionId.startsWith('zalo:')) {
    return { status: 'unavailable', url: null, reason: 'zalo_deeplink_unverified' };
  }
  return { status: 'unavailable', url: null, reason: 'unknown_channel' };
}
