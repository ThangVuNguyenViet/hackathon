import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ZaloOAuthRuntime } from '../channels/zaloOAuth.js';
import type { PvcfcPublicDataProvider } from '../businesses/pvcfc/public-data/pvcfcPublicDataProvider.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { TinyFishClient } from '../web/tinyFishClient.js';
import type { ConfirmationApprovalKeyRing } from './confirmationApprovalCapability.js';
import type { VerifiedMessengerGuestCheckoutIngress } from '../security/guestCheckoutAuthority.js';
import type {
  ChannelMediaDeliveryResult,
  ExternalClients,
  MessengerClient,
  MessengerSenderAction,
} from '../clients/interfaces.js';
import {
  createCatalogObservationClients,
  type ChatRecommendationContext,
  type RecommendationJourneyStore,
} from '../clients/catalogObservationClients.js';
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
  Cart,
  Channel,
  ConversationProfile,
  ConversationTurnMetadata,
  CustomerAccessContext,
  MonitorSessionIntelligence,
  ToolResult,
} from '../domain/types.js';
import { customerCommandFromVerifiedAction } from '../domain/customerCommand.js';
import { isKfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
  type MonitorSessionIntelligenceJudge,
} from '../monitor/sessionIntelligence.js';
import type {
  AgentModelIdentity,
  AgentProfileMode,
} from '../config/agentModelProfile.js';
import type { MonitorModelIdentity } from '../config/monitorModelProfile.js';
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
import type { AutomaticRecommendationHttpRuntime } from '../recommendations/serving/http-runtime.js';
import type { RuntimeProbe } from '../observability/runtimeProbe.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const kfcSessionIdSchema = z
  .string()
  .refine((value) => value.startsWith('kfc:'), {
    message: 'KFC chat sessions must use the kfc: prefix',
  });

export const kfcChatPayloadSchema = z
  .object({
    sessionId: kfcSessionIdSchema,
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(kfcSessionMatchesCustomer, {
    path: ['sessionId'],
    message: 'KFC session must match the supplied customer ID',
  });
export const pvcfcSessionIdSchema = z
  .string()
  .refine((value) => value.startsWith('pvcfc:'), {
    message: 'PVCFC chat sessions must use the pvcfc: prefix',
  });

export const pvcfcChatPayloadSchema = z
  .object({
    sessionId: pvcfcSessionIdSchema,
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const kfcGenUiActionPayloadSchema = z
  .object({
    sessionId: kfcSessionIdSchema,
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    action: z
      .object({
        attachmentId: z.string().min(1).max(256),
        actionId: z.string().min(1).max(256),
        value: z.string().max(1_000).optional(),
        payload: z.record(z.unknown()).optional(),
      })
      .strict(),
  })
  .strict()
  .refine(kfcSessionMatchesCustomer, {
    path: ['sessionId'],
    message: 'KFC session must match the supplied customer ID',
  });

export const kfcSmartMenuBatchPayloadSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemCode: z.string().min(1),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict()
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.items.forEach((item, index) => {
      if (seen.has(item.itemCode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'itemCode'],
          message: 'Item codes must be unique',
        });
      }
      seen.add(item.itemCode);
    });
  });

export const kfcCartDraftPayloadSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemCode: z.string().trim().min(1).max(128),
            quantity: z.number().int().min(0).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.items.forEach((item, index) => {
      if (seen.has(item.itemCode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'itemCode'],
          message: 'Item codes must be unique',
        });
      }
      seen.add(item.itemCode);
    });
  });

export const kfcModifierDraftPayloadSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(128),
    selections: z
      .array(
        z
          .object({
            groupId: z.string().trim().min(1).max(128),
            modifierId: z.string().trim().min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    payload.selections.forEach((selection, index) => {
      if (seen.has(selection.groupId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selections', index, 'groupId'],
          message: 'Modifier groups must be unique',
        });
      }
      seen.add(selection.groupId);
    });
  });

export const messengerHistorySyncPayloadSchema = z
  .object({
    limitConversations: z.number().int().positive().optional(),
    since: z.string().datetime({ offset: true }).optional(),
  })
  .optional();

export const staleMessengerRecoveryPayloadSchema = z
  .object({
    olderThanMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .optional();

export const sessionControlPayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
});

export const dashboardSessionDefaultLookbackMs = 24 * 60 * 60 * 1000;

export const humanMessagePayloadSchema = z
  .object({
    agentId: z.string().min(1),
    clientRequestId: z.string().min(1).max(200),
    text: z.string().min(1),
  })
  .strict();

export const lifecycleTransitionSchema: z.ZodType<LifecycleTransition> =
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('payment_pending'),
        attemptId: z.string().min(1),
        orderId: z.string().min(1).optional(),
      })
      .strict(),
    ...(
      [
        'payment_paid',
        'payment_failed',
        'payment_expired',
        'payment_cancelled',
        'order_accepted',
        'order_rejected',
        'order_preparing',
        'order_ready',
        'order_completed',
        'order_cancelled',
        'delivery_assigned',
        'delivery_started',
        'delivery_delivered',
        'delivery_cancelled',
        'delivery_failed',
      ] as const
    ).map((type) =>
      type === 'order_accepted' || type === 'order_rejected'
        ? z
            .object({
              type: z.literal(type),
              orderId: z.string().min(1).optional(),
            })
            .strict()
        : z.object({ type: z.literal(type) }).strict(),
    ),
    z
      .object({
        type: z.literal('delivery_pending'),
        attemptId: z.string().min(1),
        orderId: z.string().min(1).optional(),
      })
      .strict(),
  ]);

export const lifecycleEventPayloadSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(1).max(200),
    event: lifecycleTransitionSchema,
    traceId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
  })
  .strict();

export const confirmationResumePayloadSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(['approve', 'reject']),
    approvalCapability: z.string().min(1).max(8_192),
  })
  .strict();

export const kfcProofPreconditionsSchema = z
  .object({
    customerId: z.string().min(1),
    authenticated: z.boolean(),
    orderId: z.string().min(1).optional(),
    verifiedState: z.record(z.unknown()).optional(),
    providerProfile: mockedUpstreamApiProfileSchema.nullable().optional(),
  })
  .strict();

export function lifecycleErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof LifecycleError) {
    return {
      status: error.statusCode,
      body: { errorCode: error.code, message: error.message },
    };
  }
  return {
    status: 500,
    body: {
      errorCode: 'lifecycle_control_failed',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export interface ReadinessCheckResult {
  ok: boolean;
  message?: string;
  required?: boolean;
  configured?: boolean;
  observation?: Pick<
    CatalogObservation,
    | 'id'
    | 'sha256'
    | 'observedAt'
    | 'expiresAt'
    | 'itemCount'
    | 'modifierTreeCount'
    | 'providerFingerprint'
  >;
}

export interface ReadinessOptions {
  database?: () => Promise<ReadinessCheckResult>;
  messengerToken?: () => Promise<ReadinessCheckResult>;
  messengerRequired?: boolean;
  fixturesRoot?: string;
  openAiConfigured?: boolean;
  openAiRequired?: boolean;
  agentConfigured?: boolean;
  agentGatesReadiness?: boolean;
  monitorConfigured?: boolean;
  webSearch?: {
    configured: boolean;
    provider: 'tinyfish';
    mode: 'search-fetch';
  };
  zaloRequired?: boolean;
  langsmith?: {
    configured: boolean;
    project: string;
    endpoint: string;
    samplingRate: number;
  };
  commerce?: {
    mode: 'fixture' | 'gateway';
    baseUrl?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    requiredCapabilities?: string[];
    /**
     * Capabilities actually wired into this runtime's local provider adapter.
     * When omitted, compatibility callers are assumed to implement everything
     * they explicitly require.
     */
    implementedCapabilities?: string[];
  };
  pos?: {
    mode: 'disabled' | 'http';
    baseUrl?: string;
    token?: string;
    simulated?: boolean;
  };
  release?: {
    gitSha: string;
    deploymentId: string;
    builtAt: string;
    dirty: boolean;
  };
  runtime?: {
    agentProfileMode?: AgentProfileMode;
    commerceEnvironment?: CommerceEnvironment;
    agent: AgentModelIdentity;
    monitor?: MonitorModelIdentity;
  };
}

export interface RouteOptions {
  agent?: {
    model: BaseChatModel;
    identity: AgentModelIdentity;
  };
  automaticRecommendations?: AutomaticRecommendationHttpRuntime;
  automaticRecommendationContext?: (
    sessionId: string,
    cart: Cart,
  ) => ChatRecommendationContext | Promise<ChatRecommendationContext>;
  automaticRecommendationJourney?: (
    sessionId: string,
  ) => RecommendationJourneyStore;
  runtimeProbe?: RuntimeProbe;
  fixturesRoot?: string;
  demoAdminToken?: string;
  messengerVerifyToken?: string;
  metaAppSecret?: string;
  metaPageId?: string;
  messengerPageAccessToken?: string;
  metaInboxUrlTemplate?: string;
  messengerGraphApiBaseUrl?: string;
  messengerFetchImpl?: typeof fetch;
  zaloOaId?: string;
  zaloAppId?: string;
  zaloWebhookSecret?: string;
  zaloSetupToken?: string;
  zaloPublicBaseUrl?: string;
  zaloOAuth?: ZaloOAuthRuntime;
  zaloAccessToken?: string;
  zaloAccessTokenProvider?: () => Promise<string | undefined>;
  zaloInboxUrlTemplate?: string;
  zaloApiBaseUrl?: string;
  zaloFetchImpl?: typeof fetch;
  pvcfcPublicDataProvider?: PvcfcPublicDataProvider;
  pvcfcAgentModel?: BaseChatModel;
  pvcfcWebEvidenceClient?: TinyFishClient;
  monitorJudge?: MonitorSessionIntelligenceJudge;
  agentTracer?: AgentTracer;
  confirmationApprovalKeyRing?: ConfirmationApprovalKeyRing;
  defer?: (task: () => Promise<void>) => void;
  customerRunPaceMs?: number;
  customerRunMaxTextEvents?: number;
  customerRunSleep?: (milliseconds: number) => Promise<void>;
  mockClientOptions?: MockClientOptions;
  fixtures?: GeneratedFixtures;
  store?: ConversationStore;
  dashboard?: DashboardEventBus;
  messengerHistorySync?: MessengerHistorySyncCoordinator;
  readiness?: ReadinessOptions;
  kfcCommerceGateway?: KfcCommerceGatewayClients;
  kfcCommerceProvider?: Pick<
    ExternalClients,
    'cart' | 'inventory' | 'storeLocator' | 'fulfillment'
  > &
    Partial<Pick<ExternalClients, 'customer'>>;
  catalog?: {
    environment: CommerceEnvironment;
    sourceUrl: string;
    fetchImpl?: typeof fetch;
    fallbackTtlSeconds?: number;
  };
  lifecycle?: {
    environment: CommerceEnvironment;
    controls: Pick<SandboxLifecycleControls, 'create' | 'get' | 'transition'>;
    createInput(sessionId: string): Promise<CreateLifecycleInput>;
    binding(instanceId: string): Promise<LifecycleBinding>;
    activeForSession?(sessionId: string): Promise<LifecycleInstance | null>;
    proofForSession?(
      sessionId: string,
    ): Promise<{ instance: LifecycleInstance | null; audit: unknown[] }>;
  };
  showcase?: {
    source: ShowcaseScenarioSource;
    releaseSha: string;
    agent: AgentModelIdentity;
  };
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

export interface StaleMessengerDeliveryRecoveryResult {
  scanned: number;
  processed: number;
  failed: number;
  skipped: number;
  cutoff: string;
  deliveries: Array<{
    externalEventId: string;
    sessionId: string;
    status: MessengerWebhookEventProcessingResult['status'] | 'invalid';
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface RouteHandlers {
  store: ConversationStore;
  dashboard: DashboardEventBus;
  health(): HandlerResponse;
  ready(deep?: boolean): Promise<HandlerResponse>;
  lifecycleCreate(sessionId: string): Promise<HandlerResponse>;
  lifecycleGet(instanceId: string): Promise<HandlerResponse>;
  lifecycleEvent(instanceId: string, body: unknown): Promise<HandlerResponse>;
  messengerProofEnvelope(sessionId: string): Promise<HandlerResponse>;
  kfcProofPreconditions(
    sessionId: string,
    body: unknown,
  ): Promise<HandlerResponse>;
  confirmationResume(body: unknown): Promise<HandlerResponse>;
  chatKfcMessage(body: unknown): Promise<HandlerResponse>;
  chatKfcGenUiAction(body: unknown): Promise<HandlerResponse>;
  chatKfcStartRun(body: unknown): Promise<HandlerResponse>;
  chatKfcCancelRun(runId: string): Promise<HandlerResponse>;
  showcaseCatalog(): Promise<HandlerResponse>;
  showcaseComplete(body: unknown): Promise<HandlerResponse>;
  chatKfcSessionUpdates(
    sessionId: string,
    afterTurnId?: string,
  ): Promise<HandlerResponse>;
  messengerVerify(query: Record<string, unknown>): HandlerResponse<string>;
  messengerWebhook(
    body: unknown,
    verifiedIngress?: readonly VerifiedMessengerGuestCheckoutIngress[],
  ): Promise<HandlerResponse>;
  processMessengerEvent(
    event: ConversationEvent,
    verifiedIngress?: VerifiedMessengerGuestCheckoutIngress,
  ): Promise<MessengerWebhookEventProcessingResult>;
  recoverStaleMessengerDeliveries(
    body?: unknown,
  ): Promise<HandlerResponse<StaleMessengerDeliveryRecoveryResult>>;
  processMessengerAgentRun(
    runId: string,
    verifiedIngress?: readonly VerifiedMessengerGuestCheckoutIngress[],
    options?: { typingAlreadyStarted?: boolean },
  ): Promise<MessengerWebhookEventProcessingResult>;
  zaloWebhook(body: unknown): Promise<HandlerResponse>;
  messengerHistorySync(body: unknown): Promise<HandlerResponse>;
  messengerHistorySyncStatus(): HandlerResponse;
  dashboardHumanJoin(
    sessionId: string,
    body: unknown,
  ): Promise<HandlerResponse>;
  dashboardHumanMessage(
    sessionId: string,
    body: unknown,
  ): Promise<HandlerResponse>;
  dashboardResumeAi(sessionId: string, body: unknown): Promise<HandlerResponse>;
  dashboardSessionControl(sessionId: string): Promise<HandlerResponse>;
  dashboardEvents(sessionId: string): HandlerResponse;
  dashboardSessions(): Promise<HandlerResponse>;
  dashboardTurns(sessionId: string): Promise<HandlerResponse>;
}

export function defaultFixturesRoot(): string {
  if (existsSync(join(process.cwd(), 'fixtures/generated')))
    return process.cwd();
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}
