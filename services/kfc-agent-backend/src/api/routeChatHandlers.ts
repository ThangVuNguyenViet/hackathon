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
import {
  createTrustedCustomerActionEnvelope,
  customerCommandFromVerifiedAction,
} from '../domain/customerCommand.js';
import {
  opaqueProviderIdSchema,
  paymentMethodCollectionAuthoritySchema,
} from '../domain/opaqueProviderId.js';
import {
  digestTrustedKfcGenUiAction,
  isKfcGenUiAttachment,
  kfcGenUiVerifiedStateRevision,
} from '../genui/kfcGenUi.js';
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
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
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
  checkCommerceGatewayReadiness,
  checkCatalogReadiness,
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

import type { RouteHandlerContext } from './routeHandlerContext.js';

const clientItemSelectionSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(128),
    quantity: z.number().int().min(1).max(99).optional(),
  })
  .strict();

const clientQuantityUpdateSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(128),
    quantity: z.number().int().min(1).max(99),
  })
  .strict();

const clientItemRemovalSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(128),
  })
  .strict();

const clientPaymentMethodSchema = z
  .object({
    methodId: opaqueProviderIdSchema,
  })
  .strict();

function hasExactClientActionPayload(
  actionSpec: {
    id: string;
    payload?: Record<string, unknown>;
  },
  payload: Record<string, unknown> | undefined,
): boolean {
  switch (actionSpec.id) {
    case 'add_items':
      return kfcSmartMenuBatchPayloadSchema.safeParse(payload).success;
    case 'add_item':
      return clientItemSelectionSchema.safeParse(payload).success;
    case 'update_item_quantity':
      return clientQuantityUpdateSchema.safeParse(payload).success;
    case 'remove_item':
      return clientItemRemovalSchema.safeParse(payload).success;
    case 'select_payment_method': {
      if (!clientPaymentMethodSchema.safeParse(payload).success) return false;
      return (
        actionSpec.payload?.methodId === undefined ||
        canonicalJson(payload) === canonicalJson(actionSpec.payload)
      );
    }
    default:
      if (payload === undefined) return true;
      if (actionSpec.payload === undefined) {
        return z.object({}).strict().safeParse(payload).success;
      }
      return canonicalJson(payload) === canonicalJson(actionSpec.payload);
  }
}

export function createChatRouteHandlers(context: RouteHandlerContext) {
  const {
    options,
    store,
    dashboard,
    showcase,
    streamingRunObservers,
    customerRuns,
    getFixtures,
    withConfiguredCommerce,
    createWebhookClients,
    createDeliveryClients,
    dashboardProfileForTarget,
    createFirstPartyKfcClients,
    kfcProofAccessContext,
    latestKfcProofPreconditions,
    kfcAgentResponse,
    deferAiMonitorRefinement,
    deliverAssistantReply,
    persistEventProfile,
    turnMetadataFor,
    emitConversationTurnCreatedEvent,
    emitSessionModeEvent,
    emitSessionControlIntelligence,
    resumedOwnershipSummary,
    clearPersistedHandoff,
    persistedHandoffStatus,
    shouldEvaluateDashboardMonitorContext,
    ensureDashboardMonitorContext,
    persistNonAgentInboundEvent,
    pauseIfHumanJoined,
    latestUnansweredCustomerTurn,
    replyToLatestUnansweredCustomerTurn,
    processMessengerEventInternal,
    recoverStaleMessengerDeliveriesInternal,
    processMessengerAgentRunInternal,
  } = context;
  return {
    async chatKfcMessage(body: unknown) {
      const parsed = kfcChatPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: 'invalid_kfc_chat_payload',
            issues: parsed.error.issues,
          },
        };
      }

      const responseProfile =
        parsed.data.metadata?.showcaseResponseMode === 'text'
          ? ('social' as const)
          : parsed.data.metadata?.showcaseResponseMode === 'genui'
            ? ('genui' as const)
            : undefined;
      const auditMetadata = { ...(parsed.data.metadata ?? {}) };
      delete auditMetadata.customerCommand;
      delete auditMetadata.trustedCustomerAction;
      delete auditMetadata.source;
      return kfcAgentResponse({
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        clientMessageId: parsed.data.clientMessageId,
        text: parsed.data.text,
        metadata: {
          rawEvent: { ...auditMetadata, source: 'kfc_chat' },
          ...(responseProfile ? { responseProfile } : {}),
        },
      });
    },
    async chatKfcStartRun(body: unknown) {
      return customerRuns.start(body);
    },
    async chatKfcCancelRun(runId: string) {
      return customerRuns.cancel(runId);
    },
    async showcaseCatalog() {
      if (!showcase)
        return { status: 503, body: { errorCode: 'showcase_not_configured' } };
      try {
        return { status: 200, body: await showcase.catalog() };
      } catch (error) {
        return {
          status: 503,
          body: {
            errorCode: 'showcase_catalog_unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async showcaseComplete(body: unknown) {
      if (!showcase)
        return { status: 503, body: { errorCode: 'showcase_not_configured' } };
      try {
        return { status: 200, body: await showcase.complete(body) };
      } catch (error) {
        if (
          error instanceof ShowcaseValidationError ||
          error instanceof z.ZodError
        ) {
          return {
            status:
              error instanceof ShowcaseValidationError &&
              error.code === 'showcase_scenario_not_found'
                ? 404
                : 422,
            body: {
              errorCode:
                error instanceof ShowcaseValidationError
                  ? error.code
                  : 'invalid_showcase_result',
            },
          };
        }
        throw error;
      }
    },
    async chatKfcGenUiAction(body: unknown) {
      const parsed = kfcGenUiActionPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: 'invalid_kfc_genui_action_payload',
            issues: parsed.error.issues,
          },
        };
      }

      const accessContext = await kfcProofAccessContext(
        parsed.data.sessionId,
        parsed.data.customerId,
      );
      const access = authorizeCustomerAccess(accessContext, {
        channel: 'kfc',
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        scope: 'customer:read',
      });
      if (!access.allowed) {
        return {
          status: access.errorCode === 'authentication_required' ? 401 : 403,
          body: {
            errorCode: access.errorCode,
            message: access.message,
          },
        };
      }

      const sourceTurn = (await store.listTurns(parsed.data.sessionId))
        .slice()
        .reverse()
        .find((turn) => {
          const candidate = turn.metadata?.genUi;
          return (
            turn.role === 'assistant' &&
            turn.externalUserId === parsed.data.customerId &&
            isKfcGenUiAttachment(candidate) &&
            candidate.id === parsed.data.action.attachmentId
          );
        });
      const attachment = sourceTurn?.metadata?.genUi;
      if (!sourceTurn || !attachment || !isKfcGenUiAttachment(attachment)) {
        return {
          status: 404,
          body: { errorCode: 'action_not_found' },
        };
      }
      if (
        !attachment.authority ||
        attachment.authority.sessionId !== parsed.data.sessionId ||
        attachment.authority.customerId !== parsed.data.customerId ||
        attachment.expiresAt !== attachment.authority.expiresAt
      ) {
        return {
          status: 409,
          body: { errorCode: 'untrusted_action_authority' },
        };
      }
      const authority = attachment.authority;
      const issuedAtMs = Date.parse(authority.issuedAt);
      const expiresAtMs = Date.parse(authority.expiresAt);
      if (
        !Number.isFinite(issuedAtMs) ||
        !Number.isFinite(expiresAtMs) ||
        issuedAtMs >= expiresAtMs
      ) {
        return {
          status: 409,
          body: { errorCode: 'untrusted_action_authority' },
        };
      }
      if (expiresAtMs <= Date.now()) {
        return {
          status: 409,
          body: { errorCode: 'expired_action' },
        };
      }
      const actionSpec = attachment.actions.find(
        (candidate) => candidate.id === parsed.data.action.actionId,
      );
      if (!actionSpec) {
        return {
          status: 404,
          body: { errorCode: 'action_not_found' },
        };
      }
      if (attachment.status !== 'active') {
        return {
          status: 409,
          body: { errorCode: 'stale_action' },
        };
      }
      if (
        !hasExactClientActionPayload(actionSpec, parsed.data.action.payload)
      ) {
        return {
          status: 422,
          body: { errorCode: 'invalid_action_payload' },
        };
      }
      const clientQuantity = parsed.data.action.payload?.quantity;
      let trustedPayload: Record<string, unknown> = {
        ...(actionSpec.payload ?? {}),
      };
      let trustedValue = actionSpec.value ?? parsed.data.action.value;
      if (actionSpec.id === 'add_items') {
        if (attachment.widgetKind !== 'smartMenuPicker') {
          return { status: 422, body: { errorCode: 'invalid_action_payload' } };
        }
        const batch = kfcSmartMenuBatchPayloadSchema.safeParse(
          parsed.data.action.payload,
        );
        const allowedCodes = new Set(
          (Array.isArray(attachment.data.items) ? attachment.data.items : [])
            .filter(isRecord)
            .map((item) => item.code)
            .filter((code): code is string => typeof code === 'string'),
        );
        if (
          !batch.success ||
          batch.data.items.some((item) => !allowedCodes.has(item.itemCode))
        ) {
          return { status: 422, body: { errorCode: 'invalid_action_payload' } };
        }
        trustedPayload = { items: batch.data.items };
        trustedValue = undefined;
      } else if (actionSpec.id === 'add_item') {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const items = Array.isArray(attachment.data.items)
          ? attachment.data.items
          : [];
        const selectedItem = items.find(
          (item) =>
            isRecord(item) &&
            typeof requestedItemCode === 'string' &&
            item.code === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return {
            status: 422,
            body: { errorCode: 'invalid_action_payload' },
          };
        }
        trustedPayload.itemCode = selectedItem.code;
        trustedValue =
          typeof selectedItem.name === 'string'
            ? selectedItem.name
            : trustedValue;
      }
      if (
        actionSpec.id === 'remove_item' ||
        actionSpec.id === 'update_item_quantity'
      ) {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const cart = isRecord(attachment.data.cart) ? attachment.data.cart : {};
        const items = Array.isArray(cart.items) ? cart.items : [];
        const selectedItem = items.find(
          (item) =>
            isRecord(item) &&
            typeof requestedItemCode === 'string' &&
            item.itemCode === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return { status: 422, body: { errorCode: 'invalid_action_payload' } };
        }
        trustedPayload.itemCode = selectedItem.itemCode;
        trustedValue =
          typeof selectedItem.name === 'string'
            ? selectedItem.name
            : trustedValue;
      }
      if (actionSpec.id === 'select_payment_method') {
        const requestedMethodId = parsed.data.action.payload?.methodId;
        const methods = Array.isArray(attachment.data.methods)
          ? attachment.data.methods
          : [];
        const selectedMethods = methods.filter(
          (method) =>
            isRecord(method) &&
            typeof requestedMethodId === 'string' &&
            method.methodId === requestedMethodId,
        );
        const selectedMethod = selectedMethods[0];
        if (
          selectedMethods.length !== 1 ||
          !isRecord(selectedMethod) ||
          selectedMethod.supported !== true ||
          selectedMethod.supportStatus !== 'listed_supported'
        ) {
          return { status: 422, body: { errorCode: 'invalid_action_payload' } };
        }
        const collectionAuthority =
          paymentMethodCollectionAuthoritySchema.safeParse(
            attachment.data.paymentMethodCollection,
          );
        if (!collectionAuthority.success) {
          return {
            status: 422,
            body: { errorCode: 'invalid_action_payload' },
          };
        }
        trustedPayload = {
          selection: {
            methodId: selectedMethod.methodId,
            ...collectionAuthority.data,
          },
        };
        trustedValue =
          typeof selectedMethod.displayName === 'string'
            ? selectedMethod.displayName
            : trustedValue;
      }
      if (clientQuantity !== undefined) {
        trustedPayload.quantity = clientQuantity;
      }
      const trustedAction = {
        attachmentId: attachment.id,
        actionId: actionSpec.id,
        value: trustedValue,
        payload: trustedPayload,
      };
      const command = customerCommandFromVerifiedAction(trustedAction);
      if (!command) {
        return { status: 422, body: { errorCode: 'invalid_action_payload' } };
      }

      const actionDigest = await digestTrustedKfcGenUiAction({
        attachment,
        assistantTurnId: sourceTurn.id,
        action: trustedAction,
      });
      const sessionControl = await store.getSessionControl(
        parsed.data.sessionId,
      );
      if (sessionControl.agentMode === 'human_paused') {
        return {
          status: 409,
          body: {
            errorCode: 'trusted_genui_action_requires_ai_active_session',
            agentMode: sessionControl.agentMode,
          },
        };
      }
      if (
        !store.reserveIrreversibleOperation ||
        !store.completeIrreversibleOperation ||
        !store.failIrreversibleOperation
      ) {
        return {
          status: 503,
          body: { errorCode: 'genui_action_fence_unavailable' },
        };
      }
      const reservationInput = {
        requestId:
          authority.actionLifecycle === 'one_shot'
            ? `genui-action:${attachment.id}`
            : `genui-action:${attachment.id}:${actionDigest}`,
        sessionId: parsed.data.sessionId,
        operation: `genui_action:${actionSpec.id}`,
        bindingFingerprint: actionDigest,
      };
      let reservation;
      try {
        reservation =
          await store.reserveIrreversibleOperation(reservationInput);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('binding conflict')
        ) {
          return { status: 409, body: { errorCode: 'genui_action_conflict' } };
        }
        if (
          error instanceof Error &&
          error.message === 'session_ai_authority_unavailable'
        ) {
          return {
            status: 409,
            body: {
              errorCode: 'trusted_genui_action_requires_ai_active_session',
              agentMode: 'human_paused',
            },
          };
        }
        throw error;
      }
      if (reservation.status === 'completed') {
        const storedStatus = reservation.result.status;
        const storedBody = reservation.result.body;
        return {
          status: typeof storedStatus === 'number' ? storedStatus : 200,
          body: isRecord(storedBody)
            ? { ...storedBody, replayed: true }
            : { replayed: true },
        };
      }
      if (reservation.status !== 'reserved') {
        return { status: 409, body: { errorCode: 'genui_action_in_progress' } };
      }
      const latestVerifiedStateEvent = [
        ...(await store.listEvents(parsed.data.sessionId)),
      ]
        .reverse()
        .find(({ sourceType }) => sourceType === 'agent:verified_state');
      const latestVerifiedState =
        latestVerifiedStateEvent?.payload.verifiedState;
      if (
        !isRecord(latestVerifiedState) ||
        kfcGenUiVerifiedStateRevision(latestVerifiedState) !==
          authority.verifiedRevision
      ) {
        await store.failIrreversibleOperation(
          reservationInput,
          reservation,
          'Delivered GenUI authority no longer matches current verified state',
        );
        return {
          status: 409,
          body: { errorCode: 'stale_action_revision' },
        };
      }
      let trustedCustomerAction: ReturnType<
        typeof createTrustedCustomerActionEnvelope
      >;
      try {
        trustedCustomerAction = createTrustedCustomerActionEnvelope({
          source: 'kfc_genui_action',
          assistantTurnId: sourceTurn.id,
          attachmentId: attachment.id,
          actionDigest,
          verifiedRevision: authority.verifiedRevision,
          lifecycle: authority.actionLifecycle,
          command,
        });
      } catch (error) {
        await store.failIrreversibleOperation(
          reservationInput,
          reservation,
          error instanceof Error ? error.message : String(error),
        );
        return {
          status: 422,
          body: { errorCode: 'invalid_action_payload' },
        };
      }
      const invoke = () =>
        kfcAgentResponse({
          sessionId: parsed.data.sessionId,
          customerId: parsed.data.customerId,
          clientMessageId: parsed.data.clientMessageId,
          text: '',
          metadata: {
            rawEvent: {
              source: 'kfc_genui_action',
              assistantTurnId: sourceTurn.id,
              schemaVersion: authority.schemaVersion,
              verifiedRevision: authority.verifiedRevision,
              actionDigest,
            },
          },
          trustedCustomerAction,
        });
      try {
        const response = await invoke();
        if (
          response.status === 409 &&
          isRecord(response.body) &&
          (response.body.errorCode ===
            'trusted_genui_action_requires_ai_active_session' ||
            response.body.errorCode === 'agent_run_superseded')
        ) {
          await store.failIrreversibleOperation(
            reservationInput,
            reservation,
            response.body.errorCode === 'agent_run_superseded'
              ? 'Trusted GenUI action run was superseded'
              : 'Trusted GenUI action requires an AI-active session',
          );
          return response;
        }
        const completed = await store.completeIrreversibleOperation(
          reservationInput,
          reservation,
          {
            status: response.status,
            body: isRecord(response.body) ? response.body : {},
          },
        );
        if (completed.status !== 'completed') {
          return {
            status: 409,
            body: { errorCode: 'genui_action_in_progress' },
          };
        }
        return response;
      } catch (error) {
        await store.failIrreversibleOperation(
          reservationInput,
          reservation,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    async chatKfcSessionUpdates(sessionId: string, afterTurnId?: string) {
      if (!sessionId.startsWith('kfc:')) {
        return { status: 400, body: { errorCode: 'invalid_kfc_session' } };
      }
      const allTurns = await store.listTurns(sessionId);
      const cursorIndex = afterTurnId
        ? allTurns.findIndex((turn) => turn.id === afterTurnId)
        : -1;
      const turns =
        cursorIndex >= 0 ? allTurns.slice(cursorIndex + 1) : allTurns;
      const control = await store.getSessionControl(sessionId);
      return {
        status: 200,
        body: {
          sessionId,
          agentMode: control.agentMode,
          assignedAgentId: control.assignedAgentId,
          handoffStatus: await persistedHandoffStatus(
            sessionId,
            control.agentMode,
          ),
          turns,
        },
      };
    },
  };
}
