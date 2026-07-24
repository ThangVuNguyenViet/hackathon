import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  ChannelMediaDeliveryResult,
  ExternalClients,
  MessengerClient,
  MessengerSenderAction,
} from '../clients/interfaces.js';
import type { KfcCommerceGatewayClients } from '../clients/kfcCommerceGateway.js';
import {
  LifecycleError,
  type CreateLifecycleInput,
  type LifecycleBinding,
  type LifecycleInstance,
  type LifecycleTransition,
  type MutationContext,
  type SandboxLifecycleControls,
  projectLifecycleCommerceClients,
} from '../commerce/lifecycleProvider.js';
import { createCatalogObservationClients } from '../clients/catalogObservationClients.js';
import {
  fetchCatalogObservation,
  type CatalogObservation,
  type CommerceEnvironment,
} from '../catalog/catalogObservation.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { MessengerHistorySyncCoordinator } from '../channels/messengerHistory.js';
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { dashboardSessionTarget } from '../dashboard/sessionVisibility.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type {
  AgentMode,
  Channel,
  ConversationProfile,
  ConversationTurnMetadata,
  CustomerAccessContext,
  MonitorSessionIntelligence,
  ToolResult,
} from '../domain/types.js';
import { customerCommandFromVerifiedAction } from '../domain/customerCommand.js';
import { isKfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { runAgentTurn } from '../agent/kfcAgent.js';
import type { AgentState } from '../agent/agentState.js';
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
  type MonitorSessionIntelligenceJudge,
} from '../monitor/sessionIntelligence.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import {
  createMockClients,
  type MockClientOptions,
} from '../mock/createMockClients.js';
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from '../mock/mockedUpstreamProfile.js';
import type { ToolName } from '../ordering/types.js';
import {
  CustomerRunCoordinator,
  type CustomerRunObservation,
} from '../customerRuns/runtime.js';
import {
  kfcSessionMatchesCustomer,
  type CustomerRunStartRequest,
} from '../customerRuns/contracts.js';
import {
  MemoryStore,
  type ConversationStore,
  type WebhookDelivery,
} from '../persistence/memoryStore.js';
import {
  buildBoundedRecentTurns,
  sessionIdForConversationEvent,
} from '../session/sessionContext.js';
import {
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from '../presentation/channelPresentation.js';
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from '../showcase/showcase.js';
import type {
  HandlerResponse,
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
} from './routeHandlerContracts.js';

export function messengerDeliveryFailureForStorage(input: {
  errorCode?: string;
  errorMessage?: string;
}): string {
  if (input.errorCode === 'messenger_access_token_invalid') {
    return input.errorMessage ?? input.errorCode;
  }
  return (
    input.errorCode ?? input.errorMessage ?? 'assistant_reply_delivery_failed'
  );
}

export function eventFromMessengerDelivery(
  delivery: WebhookDelivery,
): ConversationEvent | undefined {
  const text = delivery.payload.text;
  if (typeof text !== 'string' || text.length === 0) return undefined;
  const eventType =
    delivery.payload.eventType === 'postback' ? 'postback' : 'message';
  return {
    channel: 'messenger',
    externalUserId: delivery.externalUserId,
    externalThreadId: delivery.externalThreadId,
    text,
    eventType,
    rawEventId: delivery.externalEventId,
    receivedAt: delivery.receivedAt,
    platformEventName: eventType,
    shouldRunAgent: true,
    rawEvent:
      typeof delivery.payload.rawEvent === 'object' &&
      delivery.payload.rawEvent !== null &&
      !Array.isArray(delivery.payload.rawEvent)
        ? (delivery.payload.rawEvent as Record<string, unknown>)
        : delivery.payload,
  };
}

export async function sendMessengerSenderAction(
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

export function dashboardEventId(sessionId: string, type: string): string {
  return `dash_${sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`;
}

export async function runReadinessCheck(
  check: () => Promise<ReadinessCheckResult>,
): Promise<ReadinessCheckResult> {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Readiness check failed',
    };
  }
}

export async function checkFixtures(
  fixturesRoot: string,
): Promise<ReadinessCheckResult> {
  try {
    const fixtures = await loadGeneratedFixtures(fixturesRoot);
    return {
      ok: fixtures.menuItems.length > 0 && fixtures.stores.length > 0,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Generated fixtures unavailable',
    };
  }
}

export function checkMessengerConfig(
  options: RouteOptions,
): ReadinessCheckResult {
  const missing = [
    !options.messengerVerifyToken ? 'MESSENGER_VERIFY_TOKEN' : undefined,
    !options.metaAppSecret ? 'META_APP_SECRET' : undefined,
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

export function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
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
    message:
      configured || !required ? undefined : `Missing ${missing.join(', ')}`,
  };
}

export function deeplinkForSession(
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
  if (sessionId.startsWith('kfc:')) {
    return {
      status: 'unavailable',
      url: null,
      reason: 'KFC chat deeplink disabled',
    };
  }

  const target = channelTargetForSession(sessionId);
  if (!target)
    return { status: 'unavailable', url: null, reason: 'Unknown channel' };

  if (target.channel === 'messenger') {
    if (!config.metaInboxUrlTemplate)
      return {
        status: 'unavailable',
        url: null,
        reason: 'Missing META_INBOX_URL_TEMPLATE',
      };
    if (!config.metaPageId)
      return {
        status: 'unavailable',
        url: null,
        reason: 'Missing META_PAGE_ID',
      };
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
    if (!config.zaloInboxUrlTemplate)
      return {
        status: 'unavailable',
        url: null,
        reason: 'Missing ZALO_INBOX_URL_TEMPLATE',
      };
    if (!config.zaloOaId)
      return { status: 'unavailable', url: null, reason: 'Missing ZALO_OA_ID' };
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

export function renderInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll('{pageId}', encodeURIComponent(values.pageId))
    .replaceAll('{externalUserId}', encodeURIComponent(values.externalUserId))
    .replaceAll('{sessionId}', encodeURIComponent(values.sessionId));
}

export type ChannelProfileTarget = {
  channel: 'messenger' | 'zalo';
  externalUserId: string;
};

export function channelTargetForSession(
  sessionId: string,
): ChannelProfileTarget | undefined {
  const target = dashboardSessionTarget(sessionId);
  const channel =
    target?.channel === 'messenger' || target?.channel === 'zalo'
      ? target.channel
      : undefined;
  if (target && channel) {
    return {
      channel,
      externalUserId: target.externalUserId,
    };
  }
  return undefined;
}

export function humanChannelTargetForSession(sessionId: string) {
  return dashboardSessionTarget(sessionId);
}
