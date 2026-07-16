import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type {
  ChannelMediaDeliveryResult,
  ExternalClients,
  MessengerClient,
  MessengerSenderAction,
} from "../clients/interfaces.js";
import type { KfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import {
  LifecycleError,
  type CreateLifecycleInput,
  type LifecycleBinding,
  type LifecycleInstance,
  type LifecycleTransition,
  type MutationContext,
  type SandboxLifecycleControls,
  projectLifecycleCommerceClients,
} from "../commerce/lifecycleProvider.js";
import { createCatalogObservationClients } from "../clients/catalogObservationClients.js";
import {
  fetchCatalogObservation,
  type CatalogObservation,
  type CommerceEnvironment,
} from "../catalog/catalogObservation.js";
import type { ConversationEvent } from "../channels/conversationEvent.js";
import type { MessengerHistorySyncCoordinator } from "../channels/messengerHistory.js";
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from "../channels/messenger.js";
import { createZaloClient, normalizeZaloWebhook } from "../channels/zalo.js";
import { DashboardEventBus } from "../dashboard/eventBus.js";
import { dashboardSessionTarget } from "../dashboard/sessionVisibility.js";
import type { GeneratedFixtures } from "../fixtures/schema.js";
import { loadGeneratedFixtures } from "../fixtures/loadFixtures.js";
import type {
  AgentMode,
  Channel,
  ConversationProfile,
  ConversationTurnMetadata,
  CustomerAccessContext,
  MonitorSessionIntelligence,
  ToolResult,
} from "../domain/types.js";
import { customerCommandFromVerifiedAction } from "../domain/customerCommand.js";
import {
  isKfcGenUiAttachment,
  normalizeGenUiActionToText,
} from "../genui/kfcGenUi.js";
import { runAgentTurn } from "../graph/buildGraph.js";
import type { AgentGraphState } from "../graph/state.js";
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
  type MonitorSessionIntelligenceJudge,
} from "../monitor/sessionIntelligence.js";
import type { ResponseComposer } from "../llm/responseComposer.js";
import type { SmallTalkRouter } from "../llm/smallTalkRouter.js";
import type { ToolPlanner } from "../llm/toolPlanner.js";
import type { AgentTracer } from "../observability/agentTracing.js";
import {
  createMockClients,
  type MockClientOptions,
} from "../mock/createMockClients.js";
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from "../mock/mockedUpstreamProfile.js";
import type { ToolName } from "../ordering/types.js";
import { CustomerRunCoordinator, type CustomerRunObservation } from "../customerRuns/runtime.js";
import {
  kfcSessionMatchesCustomer,
  type CustomerRunStartRequest,
} from "../customerRuns/contracts.js";
import {
  MemoryStore,
  type ConversationStore,
  type WebhookDelivery,
} from "../persistence/memoryStore.js";
import {
  buildBoundedRecentTurns,
  sessionIdForConversationEvent,
} from "../session/sessionContext.js";
import {
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from "../presentation/channelPresentation.js";
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from "../showcase/showcase.js";
import { isRecord, canonicalJson, sha256Fingerprint, kfcSessionIdSchema, kfcChatPayloadSchema, kfcGenUiActionPayloadSchema, kfcSmartMenuBatchPayloadSchema, messengerHistorySyncPayloadSchema, staleMessengerRecoveryPayloadSchema, sessionControlPayloadSchema, dashboardSessionDefaultLookbackMs, humanMessagePayloadSchema, lifecycleTransitionSchema, lifecycleEventPayloadSchema, confirmationResumePayloadSchema, kfcProofPreconditionsSchema, lifecycleErrorResponse, ReadinessCheckResult, ReadinessOptions, RouteOptions, HandlerResponse, MessengerWebhookEventProcessingResult, StaleMessengerDeliveryRecoveryResult, RouteHandlers, defaultFixturesRoot } from './routeHandlerContracts.js';
import { messengerDeliveryFailureForStorage, eventFromMessengerDelivery, sendMessengerSenderAction, dashboardEventId, checkCommerceGatewayReadiness, checkCatalogReadiness, runReadinessCheck, checkFixtures, checkMessengerConfig, checkZaloConfig, deeplinkForSession, renderInboxUrlTemplate, ChannelProfileTarget, channelTargetForSession, humanChannelTargetForSession } from './routeHandlerSupport.js';

import type { RouteHandlerContext } from './routeHandlerContext.js';

export function createChatRouteHandlers(context: RouteHandlerContext) {
  const { options, store, dashboard, showcase, streamingRunObservers, customerRuns, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn, processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal } = context;
  return {
    async chatKfcMessage(body: unknown) {
      const parsed = kfcChatPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: "invalid_kfc_chat_payload",
            issues: parsed.error.issues,
          },
        };
      }

      const responseProfile = parsed.data.metadata?.showcaseResponseMode === "text"
        ? "social" as const
        : parsed.data.metadata?.showcaseResponseMode === "genui"
          ? "genui" as const
          : undefined;
      return kfcAgentResponse({
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        clientMessageId: parsed.data.clientMessageId,
        text: parsed.data.text,
        metadata: {
          rawEvent: { source: "kfc_chat", ...parsed.data.metadata },
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
      if (!showcase) return { status: 503, body: { errorCode: "showcase_not_configured" } };
      try {
        return { status: 200, body: await showcase.catalog() };
      } catch (error) {
        return {
          status: 503,
          body: {
            errorCode: "showcase_catalog_unavailable",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async showcaseComplete(body: unknown) {
      if (!showcase) return { status: 503, body: { errorCode: "showcase_not_configured" } };
      try {
        return { status: 200, body: await showcase.complete(body) };
      } catch (error) {
        if (error instanceof ShowcaseValidationError || error instanceof z.ZodError) {
          return {
            status: error instanceof ShowcaseValidationError && error.code === "showcase_scenario_not_found" ? 404 : 422,
            body: { errorCode: error instanceof ShowcaseValidationError ? error.code : "invalid_showcase_result" },
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
            errorCode: "invalid_kfc_genui_action_payload",
            issues: parsed.error.issues,
          },
        };
      }

      const attachment = (await store.listTurns(parsed.data.sessionId))
        .slice()
        .reverse()
        .map((turn) => turn.metadata?.genUi)
        .find(
          (candidate) =>
            isKfcGenUiAttachment(candidate) &&
            candidate.id === parsed.data.action.attachmentId,
        );
      if (!attachment || !isKfcGenUiAttachment(attachment)) {
        return {
          status: 404,
          body: { errorCode: "action_not_found" },
        };
      }
      const actionSpec = attachment.actions.find(
        (candidate) => candidate.id === parsed.data.action.actionId,
      );
      if (!actionSpec) {
        return {
          status: 404,
          body: { errorCode: "action_not_found" },
        };
      }
      if (attachment.status !== "active") {
        return {
          status: 409,
          body: { errorCode: "stale_action" },
        };
      }
      const clientQuantity = parsed.data.action.payload?.quantity;
      if (
        clientQuantity !== undefined &&
        (typeof clientQuantity !== "number" ||
          !Number.isInteger(clientQuantity) ||
          clientQuantity < 1)
      ) {
        return {
          status: 422,
          body: { errorCode: "invalid_action_payload" },
        };
      }
      let trustedPayload: Record<string, unknown> = {
        ...(actionSpec.payload ?? {}),
      };
      let trustedValue = actionSpec.value ?? parsed.data.action.value;
      if (actionSpec.id === "add_items") {
        if (attachment.widgetKind !== "smartMenuPicker") {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        const batch = kfcSmartMenuBatchPayloadSchema.safeParse(parsed.data.action.payload);
        const allowedCodes = new Set(
          (Array.isArray(attachment.data.items) ? attachment.data.items : [])
            .filter(isRecord)
            .map((item) => item.code)
            .filter((code): code is string => typeof code === "string"),
        );
        if (!batch.success || batch.data.items.some((item) => !allowedCodes.has(item.itemCode))) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload = { items: batch.data.items };
        trustedValue = undefined;
      } else if (actionSpec.id === "add_item") {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const items = Array.isArray(attachment.data.items)
          ? attachment.data.items
          : [];
        const selectedItem = items.find(
          (item) =>
            isRecord(item) &&
            typeof requestedItemCode === "string" &&
            item.code === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return {
            status: 422,
            body: { errorCode: "invalid_action_payload" },
          };
        }
        trustedPayload.itemCode = selectedItem.code;
        trustedValue =
          typeof selectedItem.name === "string"
            ? selectedItem.name
            : trustedValue;
      }
      if (actionSpec.id === "remove_item" || actionSpec.id === "update_item_quantity") {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const cart = isRecord(attachment.data.cart) ? attachment.data.cart : {};
        const items = Array.isArray(cart.items) ? cart.items : [];
        const selectedItem = items.find(
          (item) => isRecord(item) && typeof requestedItemCode === "string" && item.itemCode === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload.itemCode = selectedItem.itemCode;
        trustedValue = typeof selectedItem.name === "string" ? selectedItem.name : trustedValue;
      }
      if (actionSpec.id === "select_payment_method") {
        const requestedMethodId = parsed.data.action.payload?.methodId;
        const methods = Array.isArray(attachment.data.methods) ? attachment.data.methods : [];
        const selectedMethod = methods.find(
          (method) => isRecord(method) && typeof requestedMethodId === "string" && method.methodId === requestedMethodId,
        );
        if (!isRecord(selectedMethod) || selectedMethod.supported !== true) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload.methodId = selectedMethod.methodId;
        trustedValue = typeof selectedMethod.displayName === "string" ? selectedMethod.displayName : trustedValue;
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
      const customerCommand = customerCommandFromVerifiedAction(trustedAction);
      if (!customerCommand) {
        return { status: 422, body: { errorCode: "invalid_action_payload" } };
      }

      return kfcAgentResponse({
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        clientMessageId: parsed.data.clientMessageId,
        text: normalizeGenUiActionToText(trustedAction),
        metadata: {
          customerCommand,
          rawEvent: {
            source: "kfc_genui_action",
          },
        },
      });
    },
    async chatKfcSessionUpdates(sessionId: string, afterTurnId?: string) {
      if (!sessionId.startsWith("kfc:")) {
        return { status: 400, body: { errorCode: "invalid_kfc_session" } };
      }
      const allTurns = await store.listTurns(sessionId);
      const cursorIndex = afterTurnId ? allTurns.findIndex((turn) => turn.id === afterTurnId) : -1;
      const turns = cursorIndex >= 0 ? allTurns.slice(cursorIndex + 1) : allTurns;
      const control = await store.getSessionControl(sessionId);
      return {
        status: 200,
        body: {
          sessionId,
          agentMode: control.agentMode,
          assignedAgentId: control.assignedAgentId,
          handoffStatus: await persistedHandoffStatus(sessionId, control.agentMode),
          turns,
        },
      };
    },

  };
}
