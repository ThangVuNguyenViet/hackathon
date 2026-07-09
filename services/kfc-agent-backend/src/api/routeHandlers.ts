import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ExternalClients, MessengerClient, MessengerSenderAction } from '../clients/interfaces.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { MessengerHistorySyncCoordinator } from '../channels/messengerHistory.js';
import { createMessengerClient, normalizeMessengerWebhook, verifyMessengerChallenge } from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { AgentMode, ConversationTurnMetadata } from '../domain/types.js';
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

const sessionControlPayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
});

const dashboardSessionDefaultLookbackMs = 4 * 60 * 60 * 1000;

const humanMessagePayloadSchema = z.object({
  agentId: z.string().min(1),
  text: z.string().min(1),
});

export interface ReadinessCheckResult {
  ok: boolean;
  message?: string;
  required?: boolean;
  configured?: boolean;
}

export interface ReadinessOptions {
  database?: () => Promise<ReadinessCheckResult>;
  messengerToken?: () => Promise<ReadinessCheckResult>;
  fixturesRoot?: string;
  openAiConfigured?: boolean;
  openAiRequired?: boolean;
  zaloRequired?: boolean;
}

export interface RouteOptions {
  fixturesRoot?: string;
  messengerVerifyToken?: string;
  metaPageId?: string;
  messengerPageAccessToken?: string;
  metaInboxUrlTemplate?: string;
  messengerGraphApiBaseUrl?: string;
  messengerFetchImpl?: typeof fetch;
  zaloOaId?: string;
  zaloAccessToken?: string;
  zaloInboxUrlTemplate?: string;
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

export interface MessengerWebhookEventProcessingResult {
  status: 'processed' | 'failed' | 'skipped';
  errorCode?: string;
  errorMessage?: string;
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
  processMessengerEvent(event: ConversationEvent): Promise<MessengerWebhookEventProcessingResult>;
  zaloWebhook(body: unknown): Promise<HandlerResponse>;
  messengerHistorySync(body: unknown): Promise<HandlerResponse>;
  messengerHistorySyncStatus(): HandlerResponse;
  dashboardHumanJoin(sessionId: string, body: unknown): Promise<HandlerResponse>;
  dashboardHumanMessage(sessionId: string, body: unknown): Promise<HandlerResponse>;
  dashboardResumeAi(sessionId: string, body: unknown): Promise<HandlerResponse>;
  dashboardSessionControl(sessionId: string): Promise<HandlerResponse>;
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
  }): Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }> {
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
      errorMessage: sendResult.ok ? undefined : sendResult.message,
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
      id: dashboardEventId(turn.sessionId, 'conversation_turn_created'),
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

  function emitSessionModeEvent(input: {
    sessionId: string;
    updateType: 'human_joined' | 'human_message_sent' | 'ai_resumed';
    agentMode: AgentMode;
    agentId?: string | null;
    text?: string;
  }): void {
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, 'session_updated'),
      sessionId: input.sessionId,
      type: 'session_updated',
      payload: {
        updateType: input.updateType,
        agentMode: input.agentMode,
        agentId: input.agentId ?? null,
        text: input.text,
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
      id: dashboardEventId(sessionId, 'customer_message_received'),
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

  async function pauseIfHumanJoined(sessionId: string, event: ConversationEvent): Promise<boolean> {
    const control = await store.getSessionControl(sessionId);
    if (control.agentMode !== 'human_paused') return false;
    await persistNonAgentInboundEvent(sessionId, event);
    dashboard.emitEvent({
      id: dashboardEventId(sessionId, 'assistant_reply_skipped'),
      sessionId,
      type: 'assistant_reply_skipped',
      payload: {
        reason: 'human_paused',
        agentMode: control.agentMode,
        agentId: control.assignedAgentId,
        channel: event.channel,
        externalMessageId: event.rawEventId,
        externalUserId: event.externalUserId,
        text: event.text,
      },
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  function latestUnansweredCustomerTurn(turns: Awaited<ReturnType<ConversationStore['listTurns']>>) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.role === 'assistant') return null;
      if (turn.role === 'user') return turn;
    }
    return null;
  }

  async function replyToLatestUnansweredCustomerTurn(sessionId: string): Promise<{
    replied: boolean;
    turnId?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const pendingTurn = latestUnansweredCustomerTurn(await store.listTurns(sessionId));
    if (!pendingTurn) return { replied: false };

    const target = channelTargetForSession(sessionId);
    if (!target) return { replied: false };

    const clients = await createWebhookClients();
    const output = await runAgentTurn({
      sessionId,
      customerId: pendingTurn.externalUserId ?? target.externalUserId,
      channel: pendingTurn.channel,
      text: pendingTurn.text,
      externalMessageId: pendingTurn.externalMessageId,
      metadata: pendingTurn.metadata,
      clients,
      store,
      dashboard,
      responseComposer: options.responseComposer,
      toolPlanner: options.toolPlanner,
    });
    const delivery = await deliverAssistantReply({
      clients,
      sessionId,
      externalUserId: pendingTurn.externalUserId ?? target.externalUserId,
      responseText: output.responseText,
      channel: target.channel,
    });
    return {
      replied: delivery.ok,
      turnId: pendingTurn.id,
      errorCode: delivery.errorCode,
      errorMessage: delivery.errorMessage,
    };
  }

  async function processMessengerEventInternal(event: ConversationEvent): Promise<MessengerWebhookEventProcessingResult> {
    const sessionId = sessionIdForConversationEvent(event);
    const delivery = await store.getWebhookDelivery('messenger', event.rawEventId);
    if (delivery?.status === 'processed') {
      return { status: 'skipped' };
    }

    let clients: ExternalClients | undefined;
    let typingStarted = false;
    try {
      await persistEventProfile(event);
      clients = await createWebhookClients();
      await sendMessengerSenderAction(clients.messenger, event.externalUserId, 'mark_seen', event.rawEventId);
      typingStarted = await sendMessengerSenderAction(clients.messenger, event.externalUserId, 'typing_on', event.rawEventId);
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

      if (await pauseIfHumanJoined(sessionId, event)) {
        await store.markWebhookDeliveryProcessed('messenger', event.rawEventId);
        return { status: 'processed' };
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
      const deliveryResult = await deliverAssistantReply({
        clients,
        sessionId,
        externalUserId: event.externalUserId,
        responseText: output.responseText,
        channel: 'messenger',
      });
      if (deliveryResult.ok) {
        await store.markWebhookDeliveryProcessed('messenger', event.rawEventId);
        return { status: 'processed' };
      }

      await store.markWebhookDeliveryFailed(
        'messenger',
        event.rawEventId,
        messengerDeliveryFailureForStorage(deliveryResult),
      );
      return {
        status: 'failed',
        errorCode: deliveryResult.errorCode ?? 'assistant_reply_delivery_failed',
        errorMessage: deliveryResult.errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Messenger webhook failure';
      await store.markWebhookDeliveryFailed('messenger', event.rawEventId, errorMessage);
      return { status: 'failed', errorCode: 'messenger_webhook_processing_failed', errorMessage };
    } finally {
      if (typingStarted && clients) {
        await sendMessengerSenderAction(clients.messenger, event.externalUserId, 'typing_off', event.rawEventId);
      }
    }
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
      const messengerToken = options.readiness?.messengerToken
        ? await runReadinessCheck(options.readiness.messengerToken)
        : undefined;
      const zalo = checkZaloConfig(options);
      const openai = {
        ok: options.readiness?.openAiRequired ? Boolean(options.readiness.openAiConfigured) : true,
        required: options.readiness?.openAiRequired ?? false,
        configured: options.readiness?.openAiConfigured ?? Boolean(options.responseComposer && options.toolPlanner),
      };
      const checks = messengerToken
        ? { database, fixtures, messenger, messengerToken, zalo, openai }
        : { database, fixtures, messenger, zalo, openai };
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
            async sendSenderAction() {
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
      const events = normalizeMessengerWebhook(body, options.metaPageId ?? '');
      const stats = { received: events.length, processed: 0, skippedDuplicates: 0, failed: 0 };
      if (events.length === 0) return { status: 200, body: stats };

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

        const result = await processMessengerEventInternal(event);
        if (result.status === 'processed') stats.processed += 1;
        else if (result.status === 'skipped') stats.skippedDuplicates += 1;
        else stats.failed += 1;
      }

      return { status: 200, body: stats };
    },
    async processMessengerEvent(event: ConversationEvent) {
      return processMessengerEventInternal(event);
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

          if (await pauseIfHumanJoined(sessionId, event)) {
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
    async dashboardHumanJoin(sessionId: string, body: unknown) {
      const parsed = sessionControlPayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { errorCode: 'invalid_session_control_payload', issues: parsed.error.issues } };

      const control = await store.setSessionControl(sessionId, {
        agentMode: 'human_paused',
        assignedAgentId: parsed.data.agentId ?? null,
      });
      emitSessionModeEvent({
        sessionId,
        updateType: 'human_joined',
        agentMode: control.agentMode,
        agentId: control.assignedAgentId,
      });
      return { status: 200, body: control };
    },
    async dashboardHumanMessage(sessionId: string, body: unknown) {
      const parsed = humanMessagePayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { errorCode: 'invalid_human_message_payload', issues: parsed.error.issues } };

      const channelTarget = channelTargetForSession(sessionId);
      if (!channelTarget) return { status: 400, body: { errorCode: 'unsupported_human_message_session' } };

      const turn = await store.appendTurn({
        sessionId,
        channel: channelTarget.channel,
        role: 'assistant',
        text: parsed.data.text,
        externalMessageId: null,
        externalUserId: channelTarget.externalUserId,
        deliveryStatus: 'pending',
        metadata: { authorType: 'human_agent', agentId: parsed.data.agentId },
      });
      emitConversationTurnCreatedEvent(turn);

      const delivery = await deliverAssistantReply({
        clients: createDeliveryClients(),
        sessionId,
        externalUserId: channelTarget.externalUserId,
        responseText: parsed.data.text,
        channel: channelTarget.channel,
      });
      if (!delivery.ok) {
        return {
          status: 502,
          body: {
            errorCode: delivery.errorCode ?? 'human_message_delivery_failed',
            errorMessage: delivery.errorMessage,
          },
        };
      }

      emitSessionModeEvent({
        sessionId,
        updateType: 'human_message_sent',
        agentMode: (await store.getSessionControl(sessionId)).agentMode,
        agentId: parsed.data.agentId,
        text: parsed.data.text,
      });
      return { status: 200, body: { ok: true, turnId: turn.id } };
    },
    async dashboardResumeAi(sessionId: string, body: unknown) {
      const parsed = sessionControlPayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { errorCode: 'invalid_session_control_payload', issues: parsed.error.issues } };

      const control = await store.setSessionControl(sessionId, {
        agentMode: 'ai_active',
        assignedAgentId: null,
      });
      emitSessionModeEvent({
        sessionId,
        updateType: 'ai_resumed',
        agentMode: control.agentMode,
        agentId: parsed.data.agentId ?? null,
      });
      const recovery = await replyToLatestUnansweredCustomerTurn(sessionId);
      if (recovery.errorCode) {
        return {
          status: 502,
          body: {
            ...control,
            recoveredUnanswered: false,
            errorCode: recovery.errorCode,
            errorMessage: recovery.errorMessage,
          },
        };
      }
      return { status: 200, body: { ...control, recoveredUnanswered: recovery.replied } };
    },
    async dashboardSessionControl(sessionId: string) {
      return { status: 200, body: await store.getSessionControl(sessionId) };
    },
    dashboardEvents(sessionId: string) {
      return { status: 200, body: { events: dashboard.getEvents(sessionId) } };
    },
    async dashboardSessions() {
      const updatedSince = new Date(Date.now() - dashboardSessionDefaultLookbackMs).toISOString();
      await syncMessengerHistoryForDashboard(updatedSince);
      const summaries = await Promise.all(
        dashboard.listSessionSummaries({ updatedSince }).map(async (summary) => {
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
            deeplink: deeplinkForSession(summary.sessionId, {
              metaPageId: options.metaPageId,
              metaInboxUrlTemplate: options.metaInboxUrlTemplate,
              zaloOaId: options.zaloOaId,
              zaloInboxUrlTemplate: options.zaloInboxUrlTemplate,
            }),
          };
        }),
      );
      return { status: 200, body: { sessions: summaries } };
    },
    async dashboardTurns(sessionId: string) {
      let turns = await store.listTurns(sessionId);
      if (sessionId.startsWith('messenger:') && turns.length === 0) {
        const updatedSince = new Date(Date.now() - dashboardSessionDefaultLookbackMs).toISOString();
        await syncMessengerHistoryForDashboard(updatedSince);
        turns = await store.listTurns(sessionId);
      }
      return { status: 200, body: { turns } };
    },
  };

  async function syncMessengerHistoryForDashboard(since: string): Promise<void> {
    if (!options.messengerHistorySync) return;
    try {
      await options.messengerHistorySync.sync({ since });
    } catch (error) {
      if (error instanceof Error && error.message === 'Messenger history sync is already running') return;
      throw error;
    }
  }
}

function messengerDeliveryFailureForStorage(input: { errorCode?: string; errorMessage?: string }): string {
  if (input.errorCode === 'messenger_access_token_invalid') {
    return input.errorMessage ?? input.errorCode;
  }
  return input.errorCode ?? input.errorMessage ?? 'assistant_reply_delivery_failed';
}

async function sendMessengerSenderAction(
  client: MessengerClient,
  recipientId: string,
  action: MessengerSenderAction,
  rawEventId: string,
): Promise<boolean> {
  const result = await client.sendSenderAction(recipientId, action);
  if (result.ok) {
    console.log('messenger_sender_action_sent', { action, rawEventId });
    return true;
  }

  console.warn('messenger_sender_action_failed', {
    action,
    rawEventId,
    errorCode: result.errorCode,
    message: result.message,
  });
  return false;
}

function dashboardEventId(sessionId: string, type: string): string {
  return `dash_${sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`;
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
  const missing = [
    !options.messengerVerifyToken ? 'MESSENGER_VERIFY_TOKEN' : undefined,
    !options.metaPageId ? 'META_PAGE_ID' : undefined,
    !options.messengerPageAccessToken ? 'META_PAGE_ACCESS_TOKEN' : undefined,
    !options.metaInboxUrlTemplate ? 'META_INBOX_URL_TEMPLATE' : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured,
    configured,
    required: true,
    message: configured ? undefined : `Missing ${missing.join(', ')}`,
  };
}

function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
  const required = options.readiness?.zaloRequired ?? true;
  const missing = [
    !options.zaloOaId ? 'ZALO_OA_ID' : undefined,
    !options.zaloAccessToken ? 'ZALO_ACCESS_TOKEN' : undefined,
    !options.zaloInboxUrlTemplate ? 'ZALO_INBOX_URL_TEMPLATE' : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured || !required,
    configured,
    required,
    message: configured || !required ? undefined : `Missing ${missing.join(', ')}`,
  };
}

function deeplinkForSession(
  sessionId: string,
  config: {
    metaPageId?: string;
    metaInboxUrlTemplate?: string;
    zaloOaId?: string;
    zaloInboxUrlTemplate?: string;
  },
): {
  status: 'available' | 'unavailable';
  url: string | null;
  reason?: string;
} {
  const target = channelTargetForSession(sessionId);
  if (!target) return { status: 'unavailable', url: null, reason: 'Unknown channel' };

  if (target.channel === 'messenger') {
    if (!config.metaInboxUrlTemplate) return { status: 'unavailable', url: null, reason: 'Missing META_INBOX_URL_TEMPLATE' };
    if (!config.metaPageId) return { status: 'unavailable', url: null, reason: 'Missing META_PAGE_ID' };
    return {
      status: 'available',
      url: renderInboxUrlTemplate(config.metaInboxUrlTemplate, {
        pageId: config.metaPageId,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  if (target.channel === 'zalo') {
    if (!config.zaloInboxUrlTemplate) return { status: 'unavailable', url: null, reason: 'Missing ZALO_INBOX_URL_TEMPLATE' };
    if (!config.zaloOaId) return { status: 'unavailable', url: null, reason: 'Missing ZALO_OA_ID' };
    return {
      status: 'available',
      url: renderInboxUrlTemplate(config.zaloInboxUrlTemplate, {
        pageId: config.zaloOaId,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  return { status: 'unavailable', url: null, reason: 'Unknown channel' };
}

function renderInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll('{pageId}', encodeURIComponent(values.pageId))
    .replaceAll('{externalUserId}', encodeURIComponent(values.externalUserId))
    .replaceAll('{sessionId}', encodeURIComponent(values.sessionId));
}

function channelTargetForSession(sessionId: string): { channel: 'messenger' | 'zalo'; externalUserId: string } | undefined {
  const separatorIndex = sessionId.indexOf(':');
  if (separatorIndex === -1) return undefined;
  const channel = sessionId.slice(0, separatorIndex);
  const externalUserId = sessionId.slice(separatorIndex + 1);
  if (!externalUserId) return undefined;
  if (channel === 'messenger' || channel === 'zalo') return { channel, externalUserId };
  return undefined;
}
