import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  ChannelMediaDeliveryResult,
  ExternalCallContext,
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
import {
  isRecord,
  canonicalJson,
  sha256Fingerprint,
  kfcSessionIdSchema,
  kfcChatPayloadSchema,
  kfcGenUiActionPayloadSchema,
  kfcSmartMenuBatchPayloadSchema,
  messengerHistorySyncPayloadSchema,
  staleMessengerRecoveryPayloadSchema,
  sessionControlPayloadSchema,
  dashboardSessionDefaultLookbackMs,
  humanMessagePayloadSchema,
  lifecycleTransitionSchema,
  lifecycleEventPayloadSchema,
  kfcProofPreconditionsSchema,
  lifecycleErrorResponse,
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
  HandlerResponse,
  MessengerWebhookEventProcessingResult,
  StaleMessengerDeliveryRecoveryResult,
  RouteHandlers,
  defaultFixturesRoot,
} from './routeHandlerContracts.js';
import {
  messengerDeliveryFailureForStorage,
  eventFromMessengerDelivery,
  sendMessengerSenderAction,
  dashboardEventId,
  runReadinessCheck,
  checkFixtures,
  checkMessengerConfig,
  checkZaloConfig,
  deeplinkForSession,
  renderInboxUrlTemplate,
  ChannelProfileTarget,
  channelTargetForSession,
  humanChannelTargetForSession,
} from './routeHandlerSupport.js';

export function createRouteCommerceRuntime(input: {
  options: RouteOptions;
  store: ConversationStore;
  dashboard: DashboardEventBus;
}) {
  const { options, store, dashboard } = input;
  let clientsPromise: ReturnType<typeof loadGeneratedFixtures> | undefined;

  function getFixtures() {
    if (options.fixtures) return Promise.resolve(options.fixtures);
    clientsPromise ??= loadGeneratedFixtures(
      options.fixturesRoot ?? defaultFixturesRoot(),
    );
    return clientsPromise;
  }

  async function withConfiguredCommerce(
    _sessionId: string,
    clients: ExternalClients,
  ): Promise<ExternalClients> {
    return clients;
  }

  async function createWebhookClients(
    sessionId: string,
  ): Promise<ExternalClients> {
    const clients = createMockClients(await getFixtures(), {
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
    return withConfiguredCommerce(sessionId, clients);
  }

  function createDeliveryClients(): Pick<
    ExternalClients,
    'messenger' | 'zalo'
  > {
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

  async function dashboardProfileForTarget(
    target: ChannelProfileTarget,
  ): Promise<ConversationProfile | undefined> {
    const existing = await store.getProfile(
      target.channel,
      target.externalUserId,
    );
    if (existing?.displayName) return existing;

    const clients = createDeliveryClients();
    const profileResult =
      target.channel === 'messenger'
        ? await clients.messenger.getProfile(target.externalUserId)
        : await clients.zalo.getProfile(target.externalUserId);
    if (!profileResult.ok) return existing;

    const profile = profileResult.value;
    if (!profile?.displayName && !profile?.avatarUrl) return existing;

    return store.upsertProfile({
      channel: target.channel,
      externalUserId: target.externalUserId,
      displayName: profile.displayName ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      profileSource: profile.profileSource,
      profileUpdatedAt: new Date().toISOString(),
    });
  }

  async function createFirstPartyKfcClients(
    sessionId: string,
    _metadata: ConversationTurnMetadata,
    profileOverride?: {
      providerProfile: z.infer<typeof mockedUpstreamApiProfileSchema> | null;
    },
  ): Promise<ExternalClients> {
    let fixtures = await getFixtures();
    const proofPreconditions = profileOverride
      ? undefined
      : await latestKfcProofPreconditions(sessionId);
    const mockedProfile = profileOverride
      ? (profileOverride.providerProfile ?? undefined)
      : proofPreconditions && isRecord(proofPreconditions.providerProfile)
        ? mockedUpstreamApiProfileSchema.parse(
            proofPreconditions.providerProfile,
          )
        : undefined;
    fixtures = applyMockedUpstreamFixtureOverrides(fixtures, mockedProfile);
    const unavailableItemCodes = new Set(
      mockedProfile?.unavailableItemCodes ?? [],
    );
    if (unavailableItemCodes.size > 0) {
      fixtures = structuredClone(fixtures);
      fixtures.menuItems = fixtures.menuItems.map((item) =>
        unavailableItemCodes.has(item.code)
          ? { ...item, available: false }
          : item,
      );
      fixtures.storeAvailability = fixtures.storeAvailability.map((entry) => ({
        ...entry,
        delivery: {
          ...entry.delivery,
          excludedItemIds: [
            ...new Set([
              ...entry.delivery.excludedItemIds,
              ...unavailableItemCodes,
            ]),
          ],
        },
      }));
    }
    const etaMinutes = mockedProfile?.deliveryEtaMinutes;
    const feeVnd = mockedProfile?.deliveryFeeVnd;
    const clients = createMockClients(fixtures, {
      ...options.mockClientOptions,
      ...mockedUpstreamClientOptions(mockedProfile),
      ...(etaMinutes !== undefined && etaMinutes > 0 && feeVnd !== undefined
        ? {
            fulfillmentQuoteProvider: () => ({
              ok: true as const,
              value: { feeVnd, etaMinutes },
              message: 'mocked_upstream_api_quote',
            }),
          }
        : {}),
      channelClients: {
        messenger: {
          async sendText() {
            return {
              ok: false,
              errorCode: 'kfc_first_party_no_messenger_delivery',
              message:
                'KFC first-party chat does not deliver through Messenger',
            };
          },
          async sendSenderAction() {
            return {
              ok: false,
              errorCode: 'kfc_first_party_no_messenger_delivery',
              message:
                'KFC first-party chat does not deliver through Messenger',
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: 'kfc_first_party_no_messenger_profile',
              message: 'KFC first-party chat does not use Messenger profiles',
            };
          },
        },
        zalo: {
          async sendText() {
            return {
              ok: false,
              errorCode: 'kfc_first_party_no_zalo_delivery',
              message: 'KFC first-party chat does not deliver through Zalo',
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: 'kfc_first_party_no_zalo_profile',
              message: 'KFC first-party chat does not use Zalo profiles',
            };
          },
        },
      },
    });
    return withConfiguredCommerce(sessionId, clients);
  }

  async function kfcProofAccessContext(
    sessionId: string,
    customerId: string,
  ): Promise<CustomerAccessContext | undefined> {
    const authenticatedAt = new Date();
    const expiresAt = new Date(authenticatedAt.getTime() + 60 * 60_000);
    return {
      tenantScope: 'kfc-vietnam',
      customerSurface: 'kfc-app-chat',
      sessionRef: sessionId,
      surfaceSubjectRef: 'not-applicable',
      kfcSubjectRef: customerId,
      authenticationState: 'authenticated',
      membershipState: 'member',
      channelAccountLinkState: 'not-applicable',
      subjectBindingState: 'verified',
      authenticationEvidence: {
        state: 'verified',
        method: 'first-party-demo-session',
        issuer: 'kfc-agent-backend',
        audience: 'kfc-agent-backend',
        authenticatedAt: authenticatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        evidenceRef: `first-party-demo:${sessionId}:${customerId}`,
      },
      authorizedScopes: [
        'customer:read',
        'membership:read',
        'membership:write',
        'order:read',
        'order:write',
        'payment:read',
        'payment:write',
        'handoff:write',
      ],
    };
  }

  async function latestKfcProofPreconditions(sessionId: string) {
    if (options.lifecycle?.environment !== 'sandbox') return undefined;
    const event = await store.getSandboxProofSession(sessionId);
    if (!event || Date.parse(event.expiresAt) <= Date.now()) return undefined;
    return event;
  }

  return {
    getFixtures,
    withConfiguredCommerce,
    createWebhookClients,
    createDeliveryClients,
    dashboardProfileForTarget,
    createFirstPartyKfcClients,
    kfcProofAccessContext,
    latestKfcProofPreconditions,
  };
}

export type RouteCommerceRuntime = ReturnType<
  typeof createRouteCommerceRuntime
>;
