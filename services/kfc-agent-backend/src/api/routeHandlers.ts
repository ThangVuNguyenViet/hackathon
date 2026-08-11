import { createRouteCommerceRuntime } from './routeCommerceRuntime.js';
import {
  createRouteAgentRuntime,
  releaseStreamingRunObserver,
  streamingRunObserverKey,
} from './routeAgentRuntime.js';
import { createRouteMessengerRuntime } from './routeMessengerRuntime.js';
import type { RouteHandlerContext } from './routeHandlerContext.js';
import { createSystemRouteHandlers } from './routeSystemHandlers.js';
import { createChatRouteHandlers } from './routeChatHandlers.js';
import { createChannelRouteHandlers } from './routeChannelHandlers.js';
import { createDashboardRouteHandlers } from './routeDashboardHandlers.js';
import {
  confirmationApprovalPausePointerSchema,
} from './confirmationPausePersistence.js';
import { isRecord, type HandlerResponse, type RouteHandlers, type RouteOptions } from './routeHandlerContracts.js';
export * from './routeHandlerContracts.js';
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
  type RunCommitFence,
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

export function createRouteHandlers(options: RouteOptions = {}): RouteHandlers {
  const store = options.store ?? new MemoryStore();
  const dashboard = options.dashboard ?? new DashboardEventBus();
  const showcase = options.showcase
    ? new ShowcaseService({ ...options.showcase, store, tracer: options.agentTracer })
    : undefined;
  const streamingRunObservers = new Map<string, {
    observe: (observation: CustomerRunObservation) => Promise<void>;
    isCurrent: () => Promise<boolean>;
    commitFence: RunCommitFence;
  }>();
  const commerceRuntime = createRouteCommerceRuntime({ options, store, dashboard });
  const agentRuntime = createRouteAgentRuntime({
    options, store, dashboard, showcase, streamingRunObservers, ...commerceRuntime,
  });
  const { kfcAgentResponse } = agentRuntime;
  const messengerRuntime = createRouteMessengerRuntime({
    options, store, dashboard, ...commerceRuntime, ...agentRuntime,
  });

  let routeHandlers!: RouteHandlers;
  const customerRuns = new CustomerRunCoordinator({
    store,
    defer: options.defer,
    paceMs: options.customerRunPaceMs,
    maxTextEvents: options.customerRunMaxTextEvents,
    sleep: options.customerRunSleep,
    execute: async (request: CustomerRunStartRequest, run, observeRun, isCurrent) => {
      const commitFence = {
        kind: 'customer_run',
        runId: run.id,
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration,
      } as const;
      let response: HandlerResponse;
      if (request.input.kind === "text") {
        const responseProfile = request.metadata?.showcaseResponseMode === "text"
          ? "social" as const
          : request.metadata?.showcaseResponseMode === "genui"
            ? "genui" as const
            : undefined;
        response = await kfcAgentResponse({
            businessId: 'kfc',
            sessionId: request.sessionId,
            customerId: request.customerId,
            clientMessageId: request.clientMessageId,
            text: request.input.text,
            metadata: {
              rawEvent: { source: "kfc_stream", ...request.metadata },
              ...(responseProfile ? { responseProfile } : {}),
            },
            observeRun,
            runGuard: { isCurrent, commitFence },
          });
      } else {
        const observerKey = streamingRunObserverKey(
          request.sessionId,
          request.clientMessageId,
        );
        const observer = {
          observe: observeRun,
          isCurrent,
          commitFence,
        };
        streamingRunObservers.set(observerKey, observer);
        try {
          response = await routeHandlers.chatKfcGenUiAction({
            sessionId: request.sessionId,
            customerId: request.customerId,
            clientMessageId: request.clientMessageId,
            action: {
              attachmentId: request.input.attachmentId,
              actionId: request.input.actionId,
              ...(request.input.value === undefined ? {} : { value: request.input.value }),
              ...(request.input.payload === undefined ? {} : { payload: request.input.payload }),
            },
          });
        } finally {
          releaseStreamingRunObserver(
            streamingRunObservers,
            observerKey,
            observer,
          );
        }
      }
      if (
        isRecord(response.body) &&
        response.body.suppressed === true
      ) {
        return { status: 'superseded' };
      }
      if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) {
        throw new Error("KFC run execution failed");
      }
      if (typeof response.body.responseText !== "string") {
        throw new Error("KFC run response is missing customer text");
      }
      const parsedPause =
        response.body.pause === undefined
          ? undefined
          : confirmationApprovalPausePointerSchema.safeParse(
              response.body.pause,
            );
      if (parsedPause && !parsedPause.success) {
        throw new Error("KFC run response has an invalid approval pause");
      }
      const genUi = response.body.genUi;
      if (genUi !== undefined && !isKfcGenUiAttachment(genUi)) {
        throw new Error("KFC run response has invalid GenUI");
      }
      return {
        status: 'completed',
        responseText: response.body.responseText,
        ...(genUi ? { genUi } : {}),
        assistantTurnId:
          typeof response.body.assistantTurnId === "string"
            ? response.body.assistantTurnId
            : null,
        ...(parsedPause?.success
          ? { approvalPause: parsedPause.data }
          : {}),
      };
    },
  });

  const context: RouteHandlerContext = {
    options, store, dashboard, showcase, streamingRunObservers, customerRuns,
    ...commerceRuntime, ...agentRuntime, ...messengerRuntime,
  };
  routeHandlers = {
    store,
    dashboard,
    ...createSystemRouteHandlers(context),
    ...createChatRouteHandlers(context),
    ...createChannelRouteHandlers(context),
    ...createDashboardRouteHandlers(context),
  };
  return routeHandlers;


}
