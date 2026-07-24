import { AgentRunCoordinator } from './agentRuns/coordinator.js';
import type { ConversationEvent } from './channels/conversationEvent.js';
import {
  createMessengerClient,
  normalizeMessengerWebhook,
} from './channels/messenger.js';
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from './channels/messengerHistory.js';
import { normalizeZaloWebhook } from './channels/zalo.js';
import { DashboardEventBus } from './dashboard/eventBus.js';
import { dashboardSessionTarget } from './dashboard/sessionVisibility.js';
import type { HandlerResponse } from './api/routeHandlers.js';
import { verifyMetaWebhookSignature } from './security/webhookAuthenticity.js';
import { sessionIdForConversationEvent } from './session/sessionContext.js';
import { D1Store } from './persistence/d1Store.js';
import { initializeWorkerStore } from './workerStore.js';
import {
  readJson,
  scheduleDashboardEvent,
  workerDashboardSessionDefaultLookbackMs,
} from './workerHttp.js';
import { workerSessionResetHook } from './workerLifecycle.js';
import type {
  MessengerAgentRunWakeupJob,
  WorkerEnv,
  WorkerExecutionContext,
} from './worker.js';
import { sendBoundedWorkerQueueMessage } from './workerQueueEnvelope.js';
import { issueMessengerIngressClaim } from './security/messengerIngressClaim.js';
import type { ConversationStore } from './persistence/memoryStore.js';
import { startDeferredWork } from './runtime/deferredWork.js';

export async function enqueueMessengerWebhook(
  request: Request,
  env: WorkerEnv,
  store: ConversationStore,
  context?: WorkerExecutionContext,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return {
      status: 503,
      body: { errorCode: 'messenger_webhook_queue_not_configured' },
    };
  }

  if (!env.META_APP_SECRET) {
    return {
      status: 503,
      body: { errorCode: 'messenger_webhook_authenticity_not_configured' },
    };
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > 1_000_000) {
    return {
      status: 413,
      body: { errorCode: 'messenger_webhook_payload_too_large' },
    };
  }
  const signatureHeader = request.headers.get('x-hub-signature-256');
  if (
    !(await verifyMetaWebhookSignature({
      rawBody,
      signatureHeader,
      appSecret: env.META_APP_SECRET,
    }))
  ) {
    return {
      status: 401,
      body: { errorCode: 'invalid_messenger_webhook_signature' },
    };
  }
  const events = normalizeMessengerWebhook(
    JSON.parse(new TextDecoder().decode(rawBody)),
    env.META_PAGE_ID ?? '',
  );
  const stats = {
    received: events.length,
    queued: 0,
    skippedDuplicates: 0,
    failed: 0,
  };
  console.log('messenger_webhook_received', { received: events.length });
  if (events.length === 0) return { status: 200, body: stats };
  const dashboard = new DashboardEventBus({
    persistEvent: (event) => scheduleDashboardEvent(env, store, event, context),
  });

  for (const event of events) {
    const sessionId = sessionIdForConversationEvent(event);
    if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
      stats.skippedDuplicates += 1;
      console.log('messenger_webhook_duplicate_skipped', {
        rawEventId: event.rawEventId,
        sessionId,
      });
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
      console.log('messenger_webhook_duplicate_skipped', {
        rawEventId: event.rawEventId,
        sessionId,
      });
      continue;
    }

    try {
      const humanPaused =
        (await store.getSessionControl(sessionId)).agentMode === 'human_paused';
      if (!humanPaused) {
        scheduleImmediateMessengerTyping(env, event, context);
        const coordinator = new AgentRunCoordinator({ store, dashboard });
        const wakeup = await coordinator.recordPendingTurn(event, sessionId);
        const wakeupWithIngress: MessengerAgentRunWakeupJob = {
          ...wakeup,
          messengerExternalMessageId: event.rawEventId,
          messengerIngressClaim: await issueMessengerIngressClaim({
            event,
            sessionId,
            queueBinding: {
              kind: 'agent_run_wakeup',
              generation: wakeup.generation,
            },
            appSecret: env.META_APP_SECRET,
          }),
        };
        await sendBoundedWorkerQueueMessage(
          env.MESSENGER_WEBHOOK_QUEUE,
          wakeupWithIngress,
          { delaySeconds: 0 },
        );
        console.log('agent_run_wakeup_queued', {
          rawEventId: event.rawEventId,
          sessionId,
          generation: wakeup.generation,
          dueAt: wakeup.dueAt,
        });
      } else {
        await sendBoundedWorkerQueueMessage(env.MESSENGER_WEBHOOK_QUEUE, {
          channel: 'messenger_control_event',
          sessionId,
          externalMessageId: event.rawEventId,
          messengerIngressClaim: await issueMessengerIngressClaim({
            event,
            sessionId,
            queueBinding: { kind: 'messenger_control_event' },
            appSecret: env.META_APP_SECRET,
          }),
          queuedAt: new Date().toISOString(),
        });
      }
      stats.queued += 1;
      console.log('messenger_webhook_queued', {
        rawEventId: event.rawEventId,
        sessionId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Messenger queue send failed';
      await store.markWebhookDeliveryFailed(
        'messenger',
        event.rawEventId,
        message,
      );
      stats.failed += 1;
      console.error('messenger_webhook_queue_failed', {
        rawEventId: event.rawEventId,
        sessionId,
        message,
      });
    }
  }

  return { status: 200, body: stats };
}

export function scheduleImmediateMessengerTyping(
  env: WorkerEnv,
  event: ConversationEvent,
  context?: WorkerExecutionContext,
): void {
  const messenger = createMessengerClient({
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
    graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL,
    fetchImpl: env.MESSENGER_FETCH ?? fetch,
  });
  const task = startDeferredWork(async () => {
    const seen = await messenger.sendSenderAction(
      event.externalUserId,
      'mark_seen',
    );
    if (!seen.ok) {
      console.warn('messenger_immediate_mark_seen_failed', {
        rawEventId: event.rawEventId,
        errorCode: seen.errorCode,
        message: seen.message,
      });
    }
    const typing = await messenger.sendSenderAction(
      event.externalUserId,
      'typing_on',
    );
    if (!typing.ok) {
      console.warn('messenger_immediate_typing_failed', {
        rawEventId: event.rawEventId,
        errorCode: typing.errorCode,
        message: typing.message,
      });
    }
  });
  if (context) context.waitUntil(task);
  else void task;
}

export function staleDeliveryRecoveryOptionsFromUrl(url: URL): {
  olderThanMs?: number;
  limit?: number;
} {
  return {
    olderThanMs: numberSearchParam(url, 'olderThanMs'),
    limit: numberSearchParam(url, 'limit'),
  };
}

export function numberSearchParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createWorkerMessengerHistorySync(
  store: D1Store,
  dashboard: DashboardEventBus,
  env: WorkerEnv,
): MessengerHistorySyncCoordinator | undefined {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) return undefined;
  return new MessengerHistorySyncCoordinator(
    new MessengerHistorySyncService({
      pageId: env.META_PAGE_ID,
      store,
      dashboard,
      client: createMessengerHistoryClient({
        pageId: env.META_PAGE_ID,
        pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
        graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL || undefined,
        fetchImpl: env.MESSENGER_FETCH ?? fetch,
      }),
    }),
  );
}

export async function syncWorkerMessengerHistory(
  store: D1Store,
  dashboard: DashboardEventBus,
  env: WorkerEnv,
): Promise<void> {
  const sync = createWorkerMessengerHistorySync(store, dashboard, env);
  if (!sync) return;
  await sync.sync({
    since: new Date(
      Date.now() - workerDashboardSessionDefaultLookbackMs,
    ).toISOString(),
  });
}

export async function backfillWorkerMessengerProfiles(
  store: D1Store,
  env: WorkerEnv,
): Promise<
  HandlerResponse<{
    scanned: number;
    updated: number;
    skipped: number;
    failed: number;
    profiles: Array<{
      sessionId: string;
      externalUserId: string;
      displayName: string | null;
      status: 'updated' | 'skipped' | 'failed';
    }>;
  }>
> {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) {
    return {
      status: 503,
      body: { scanned: 0, updated: 0, skipped: 0, failed: 0, profiles: [] },
    };
  }

  const client = createMessengerHistoryClient({
    pageId: env.META_PAGE_ID,
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
    graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL || undefined,
    fetchImpl: env.MESSENGER_FETCH ?? fetch,
  });
  const existingProfiles = new Map(
    (await store.listProfiles()).map((profile) => [
      `${profile.channel}:${profile.externalUserId}`,
      profile,
    ]),
  );
  const messengerTargets = (
    await store.listDashboardSessionSummaries()
  ).flatMap((summary) => {
    const target = dashboardSessionTarget(summary.sessionId);
    return target?.channel === 'messenger'
      ? [
          {
            sessionId: summary.sessionId,
            externalUserId: target.externalUserId,
          },
        ]
      : [];
  });
  let conversationProfiles:
    | Awaited<ReturnType<NonNullable<typeof client.fetchConversationProfiles>>>
    | undefined;
  const result = {
    scanned: messengerTargets.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    profiles: [] as Array<{
      sessionId: string;
      externalUserId: string;
      displayName: string | null;
      status: 'updated' | 'skipped' | 'failed';
    }>,
  };

  for (const target of messengerTargets) {
    const existing = existingProfiles.get(`messenger:${target.externalUserId}`);
    if (existing?.displayName || existing?.avatarUrl) {
      result.skipped += 1;
      result.profiles.push({
        ...target,
        displayName: existing.displayName,
        status: 'skipped',
      });
      continue;
    }

    try {
      let profile = await client.fetchProfile?.(target.externalUserId);
      if (!profile) {
        conversationProfiles ??=
          (await client.fetchConversationProfiles?.()) ?? new Map();
        profile = conversationProfiles.get(target.externalUserId);
      }
      if (!profile) {
        result.failed += 1;
        result.profiles.push({
          ...target,
          displayName: null,
          status: 'failed',
        });
        continue;
      }
      await store.upsertProfile({
        channel: 'messenger',
        externalUserId: target.externalUserId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileSource: profile.profileSource,
        profileUpdatedAt: new Date().toISOString(),
      });
      result.updated += 1;
      result.profiles.push({
        ...target,
        displayName: profile.displayName,
        status: 'updated',
      });
    } catch {
      try {
        conversationProfiles ??=
          (await client.fetchConversationProfiles?.()) ?? new Map();
        const conversationProfile = conversationProfiles.get(
          target.externalUserId,
        );
        if (conversationProfile) {
          await store.upsertProfile({
            channel: 'messenger',
            externalUserId: target.externalUserId,
            displayName: conversationProfile.displayName,
            avatarUrl: conversationProfile.avatarUrl,
            profileSource: conversationProfile.profileSource,
            profileUpdatedAt: new Date().toISOString(),
          });
          result.updated += 1;
          result.profiles.push({
            ...target,
            displayName: conversationProfile.displayName,
            status: 'updated',
          });
          continue;
        }
      } catch {
        // Fall through and record the individual profile as failed.
      }
      result.failed += 1;
      result.profiles.push({ ...target, displayName: null, status: 'failed' });
    }
  }

  return { status: 200, body: result };
}

export async function enqueueZaloWebhook(
  request: Request,
  env: WorkerEnv,
  context?: WorkerExecutionContext,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return {
      status: 503,
      body: { errorCode: 'zalo_webhook_queue_not_configured' },
    };
  }

  const body = await readJson(request).catch(() => undefined);
  if (body === undefined) {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }

  let events: ReturnType<typeof normalizeZaloWebhook> = [];
  try {
    events = normalizeZaloWebhook(body, env.ZALO_OA_ID ?? '');
  } catch {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }
  if (events.length === 0) {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }

  const store = new D1Store(env.DB, workerSessionResetHook(env));
  await initializeWorkerStore(store, env.DB);
  const dashboard = new DashboardEventBus({
    persistEvent: (event) => scheduleDashboardEvent(env, store, event, context),
  });
  const stats = {
    received: events.length,
    queued: 0,
    skippedDuplicates: 0,
    failed: 0,
  };
  for (const event of events) {
    const sessionId = sessionIdForConversationEvent(event);
    if (event.profile?.displayName || event.profile?.avatarUrl) {
      await store.upsertProfile(event.profile);
    }
    const processAsControlEvent =
      !event.shouldRunAgent ||
      (await store.getSessionControl(sessionId)).agentMode === 'human_paused';
    if (!processAsControlEvent) {
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

      const coordinator = new AgentRunCoordinator({ store, dashboard });
      const wakeup = await coordinator.recordPendingTurn(event, sessionId);
      await sendBoundedWorkerQueueMessage(env.MESSENGER_WEBHOOK_QUEUE, wakeup, {
        delaySeconds: 0,
      });
    } else {
      await sendBoundedWorkerQueueMessage(env.MESSENGER_WEBHOOK_QUEUE, {
        channel: 'zalo_control_event',
        payload: body,
        queuedAt: new Date().toISOString(),
      });
    }
    stats.queued += 1;
  }
  return { status: 200, body: stats };
}
