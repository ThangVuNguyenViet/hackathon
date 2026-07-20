import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MemorySaver } from '@langchain/langgraph';
import {
  createConfirmationResumeCoordinator,
} from '../api/confirmationResumeAuthority.js';
import {
  confirmationPausePointerForDurableEvent,
  persistCanonicalConfirmationPause,
} from '../api/confirmationPausePersistence.js';
import {
  createConversationStoreConfirmationResumeRepository,
} from '../api/confirmationResumeRepository.js';
import { sha256Fingerprint } from '../api/routeHandlerContracts.js';
import {
  reserveKfcSynchronousRequest,
} from '../api/synchronousRequestReservation.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Cart, Channel, CustomerAccessContext, DashboardEvent, Order } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type {
  AgentTurnInput,
  AgentTurnOutput,
} from '../graph/agentTurnState.js';
import { createAgentTraceContext } from '../graph/agentTraceContext.js';
import type { AgentGraphState } from '../graph/state.js';
import { toolExecutionContext } from '../graph/turnSupport.js';
import {
  verifiedStateToolTraceForPersistence,
} from '../graph/verifiedState.js';
import {
  createMockClients,
  type MockClientOptions,
  type MockedUpstreamApiProfile,
} from '../mock/createMockClients.js';
import {
  buildCurrentAgentApprovalBinding,
} from '../ordering/agentToolExecutor.js';
import { digestCommerceAction } from '../ordering/approvalReceipt.js';
import {
  isApprovalCapability,
} from '../agent/singleAgentRuntime.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import { MemoryStore, type StoredEvent } from '../persistence/memoryStore.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type { ResponseProfile } from '../presentation/responseProfile.js';
import type {
  GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import {
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../session/sessionContext.js';
import type { ScenarioScript } from './scenarioScript.js';

const maximumScenarioApprovalResumesPerTurn = 4;

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  toolTrace: ToolTraceEntry[];
  toolTraceByTurn: Array<{ turnIndex: number; entries: ToolTraceEntry[] }>;
  turnEvidence: ScenarioTurnEvidence[];
  persistedEvents: StoredEvent[];
  finalAgentState?: AgentGraphState;
  cart?: Cart;
  order?: Order;
}

export interface ScenarioTurnEvidence {
  turnIndex: number;
  input: string;
  durationMs: number;
  transcriptRevisionBefore: number;
  transcriptRevisionAfter: number;
  eventRevisionBefore: number;
  eventRevisionAfter: number;
  eventIdsBefore: string[];
  eventIds: string[];
  eventIdsAfter: string[];
  checkpointId: string | null;
  checkpointNamespace: string | null;
  checkpointThreadId: string | null;
  checkpointVerified: boolean;
  assistantText: string;
  genUi?: KfcGenUiAttachment;
  approvalRequested: boolean;
  approvalResumes: ScenarioApprovalResumeEvidence[];
  stateBefore: ScenarioEvidenceState;
  stateAfter: ScenarioEvidenceState;
}

export interface ScenarioApprovalResumeEvidence {
  requestId: string;
  capability: string;
  checkpointId: string;
  actionOutcome: 'succeeded';
  continuation: 'approval_required' | 'turn_completed';
  replayVerified: true;
}

export type ScenarioEvidenceState = Partial<Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'addressDraft'
  | 'fulfillment'
  | 'orderPreview'
  | 'order'
  | 'paymentAttempt'
  | 'handoff'
  | 'menuSearchResults'
  | 'activeMenuCollection'
  | 'menuItemDetail'
  | 'menuModifierOptions'
  | 'pendingSavedAddressRef'
  | 'promotionContext'
  | 'promotionOffers'
  | 'customerContext'
  | 'paymentMethodEvidence'
  | 'selectedPaymentMethod'
  | 'contentEvidence'
  | 'invoiceRequest'
  | 'cancellationStatusChecked'
  | 'commerceApprovalReceipts'
>>;

export interface RunScenarioOptions {
  agentModel: BaseChatModel;
  accessContext?: CustomerAccessContext;
  channelOverride?: Channel;
  responseProfileOverride?: ResponseProfile;
  guestCheckoutAuthorityForTurn?: (input: {
    sessionId: string;
    customerId: string;
    externalMessageId: string;
    turnIndex: number;
    runFence: RunCommitFence;
  }) => Promise<GuestCheckoutAuthority>;
  fixturesRoot?: string;
  initialVerifiedState?: Partial<AgentGraphState>;
  mockClientOptions?: MockClientOptions;
  tracer?: AgentTracer;
  traceRunId?: string;
  turnDeadlineMs?: number;
  testFulfillmentQuoteProvider?: MockClientOptions['fulfillmentQuoteProvider'];
  mockedUpstreamApiForTurn?: (turnIndex: number) => MockedUpstreamApiProfile | undefined;
  transformFixtures?: (fixtures: GeneratedFixtures) => GeneratedFixtures;
  /**
   * Test-harness-only approval policy. When enabled, every emitted canonical
   * pause is persisted and approved through the real durable coordinator.
   */
  autoApproveConfirmations?:
    | boolean
    | ((input: {
        turnIndex: number;
        capability: string;
        requestId: string;
      }) => boolean);
  /**
   * Required with autoApproveConfirmations. Never default or reuse a
   * production secret in the scenario harness.
   */
  confirmationSigningSecret?: string | Uint8Array;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

interface ScenarioCheckpointEvidence {
  id: string | null;
  namespace: string | null;
  threadId: string | null;
  verified: boolean;
}

async function exactScenarioCheckpointEvidence(input: {
  checkpointer: MemorySaver;
  sessionId: string;
  checkpointRunId: string;
}): Promise<ScenarioCheckpointEvidence> {
  const logical = langGraphConfigForRun(
    input.sessionId,
    input.checkpointRunId,
  ).configurable;
  const threadId = agentCheckpointThreadId({
    threadId: logical.thread_id,
    namespace: logical.checkpoint_ns,
  });
  const latest = await input.checkpointer.getTuple({
    configurable: {
      thread_id: threadId,
      checkpoint_ns: '',
    },
  });
  const checkpointId = latest?.checkpoint.id;
  if (!checkpointId) {
    return {
      id: null,
      namespace: null,
      threadId: null,
      verified: false,
    };
  }
  const exact = await input.checkpointer.getTuple({
    configurable: {
      thread_id: threadId,
      checkpoint_ns: '',
      checkpoint_id: checkpointId,
    },
  });
  const config = exact?.config.configurable;
  const verified =
    exact?.checkpoint.id === checkpointId &&
    config?.thread_id === threadId &&
    (config.checkpoint_ns ?? '') === '' &&
    config.checkpoint_id === checkpointId;
  return {
    id: checkpointId,
    namespace: '',
    threadId,
    verified,
  };
}

function traceDelta(
  before: ToolTraceEntry[],
  after: ToolTraceEntry[],
): ToolTraceEntry[] {
  if (
    after.length < before.length ||
    !before.every(
      (entry, index) =>
        scenarioTraceEntryIsSame(entry, after[index]),
    )
  ) {
    throw new Error('scenario_approval_tool_trace_not_contiguous');
  }
  return after.slice(before.length);
}

function scenarioTraceEntryIsSame(
  left: ToolTraceEntry,
  right: ToolTraceEntry | undefined,
): boolean {
  if (!right) return false;
  return JSON.stringify(verifiedStateToolTraceForPersistence(left)) ===
    JSON.stringify(verifiedStateToolTraceForPersistence(right));
}

function assertSingleApprovedSideEffect(input: {
  expectedCapability: string;
  before: ToolTraceEntry[];
  after: ToolTraceEntry[];
}): void {
  const approvalEntries = traceDelta(input.before, input.after).filter(
    ({ toolName }) => isApprovalCapability(toolName),
  );
  if (
    approvalEntries.length !== 1 ||
    approvalEntries[0]?.toolName !== input.expectedCapability ||
    approvalEntries[0].ok !== true
  ) {
    throw new Error('scenario_approval_side_effect_polarity_invalid');
  }
}

async function approvalBindingRemainsCurrent(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  pause: Parameters<
    NonNullable<
      Parameters<typeof createConfirmationResumeCoordinator>[0]['revalidate']
    >
  >[0];
  externalCallContext: Parameters<
    NonNullable<
      Parameters<typeof createConfirmationResumeCoordinator>[0]['revalidate']
    >
  >[1];
}): Promise<boolean> {
  const binding = await buildCurrentAgentApprovalBinding(
    input.turnInput.clients,
    input.pause.action,
    {
      ...toolExecutionContext(input.turnInput),
      approval: { principal: input.pause.principal },
      externalCallContext: input.externalCallContext,
      state: input.state,
      cart: input.state.cart,
      address: input.state.address,
      order: input.state.order,
      orderPreview: input.state.orderPreview,
    },
  );
  return (
    !('ok' in binding) &&
    await digestCommerceAction(binding) ===
      input.pause.approvalBindingDigest
  );
}

async function approveScenarioPause(input: {
  output: AgentTurnOutput;
  turnInput: AgentTurnInput;
  repository: ReturnType<
    typeof createConversationStoreConfirmationResumeRepository
  >;
  signingSecret: string | Uint8Array;
}): Promise<{
  output: AgentTurnOutput;
  evidence: ScenarioApprovalResumeEvidence;
}> {
  const pause = input.output.pause;
  if (!pause?.action) {
    throw new Error('scenario_canonical_approval_pause_missing');
  }
  const existingPause =
    await input.turnInput.store.getConfirmationPauseStorageSnapshot(
      pause.requestId,
    );
  if (!existingPause) {
    await persistCanonicalConfirmationPause({
      store: input.turnInput.store,
      sessionId: input.turnInput.sessionId,
      customerId: input.turnInput.customerId,
      channel: input.turnInput.channel,
      pause,
      accessContext: input.turnInput.accessContext,
      guestCheckoutAuthority:
        input.turnInput.guestCheckoutAuthority,
      checkpointer: input.turnInput.checkpointer,
      ...(input.turnInput.runGuard?.commitFence
        ? {
            runCommit: {
              fence: input.turnInput.runGuard.commitFence,
              state: input.output.state,
            },
          }
        : {}),
    });
  }

  const beforeTrace = [...(input.output.state.toolTrace ?? [])];
  let resumedOutput: AgentTurnOutput | undefined;
  let executionFailure: unknown;
  let executionCount = 0;
  const coordinator = createConfirmationResumeCoordinator({
    repository: input.repository,
    signingSecret: input.signingSecret,
    accessContext: async () => input.turnInput.accessContext,
    guestCheckoutAuthority: async () =>
      input.turnInput.guestCheckoutAuthority,
    revalidate: async (expectedPause, externalCallContext) => ({
      ok: await approvalBindingRemainsCurrent({
        turnInput: input.turnInput,
        state: input.output.state,
        pause: expectedPause,
        externalCallContext,
      }),
    }),
    execute: async (execution) => {
      executionCount += 1;
      try {
        const resumeFence: RunCommitFence = {
          kind: 'operation_lease',
          requestId: execution.pause.requestId,
          operation: 'confirmation_resume',
          bindingFingerprint:
            execution.executionFence.bindingFingerprint,
          attempt: execution.attempt,
          leaseToken: execution.executionFence.leaseToken,
          sessionAuthorityGeneration:
            execution.executionFence.sessionAuthorityGeneration,
        };
        const isCurrent = () =>
          input.turnInput.store.isRunCommitFenceCurrent({
            sessionId: input.turnInput.sessionId,
            fence: resumeFence,
            notAfter:
              input.turnInput.guestCheckoutAuthority?.expiresAt ??
              execution.pause.expiresAt,
          });
        resumedOutput = await runAgentTurn({
          ...input.turnInput,
          runGuard: {
            isCurrent,
            commitFence: resumeFence,
          },
          confirmationResume: {
            requestId: execution.pause.requestId,
            approved: execution.receipt.decision === 'approve',
            action: execution.pause.action,
            checkpoint: execution.checkpoint,
            commerceReceipt: execution.receipt,
            executionFence: execution.executionFence,
            signingSecret: execution.signingSecret,
            externalCallContext: execution.externalCallContext,
            abortExternalCalls: execution.abortExternalCalls,
          },
        });
        assertSingleApprovedSideEffect({
          expectedCapability: execution.pause.action.toolName,
          before: beforeTrace,
          after: resumedOutput.state.toolTrace ?? [],
        });
        if (resumedOutput.status === 'paused' && resumedOutput.pause) {
          await persistCanonicalConfirmationPause({
            store: input.turnInput.store,
            sessionId: input.turnInput.sessionId,
            customerId: input.turnInput.customerId,
            channel: input.turnInput.channel,
            pause: resumedOutput.pause,
            accessContext: input.turnInput.accessContext,
            guestCheckoutAuthority:
              input.turnInput.guestCheckoutAuthority,
            checkpointer: input.turnInput.checkpointer,
            runCommit: {
              fence: resumeFence,
              state: resumedOutput.state,
            },
          });
          const approvalPause =
            await confirmationPausePointerForDurableEvent({
              pause: resumedOutput.pause,
              store: input.turnInput.store,
            });
          return {
            actionOutcome: 'succeeded',
            continuation: 'approval_required',
            requestId: approvalPause.requestId,
            responseText: resumedOutput.responseText,
            approvalPause,
            orderId: resumedOutput.state.order?.id ?? null,
          };
        }
        return {
          actionOutcome: 'succeeded',
          continuation: 'turn_completed',
          requestId: execution.pause.requestId,
          responseText: resumedOutput.responseText,
          orderId: resumedOutput.state.order?.id ?? null,
        };
      } catch (error) {
        executionFailure = error;
        throw error;
      }
    },
    projectResult: async (result) => {
      if (result.continuation === 'turn_completed') return result;
      return {
        actionOutcome: result.actionOutcome,
        continuation: result.continuation,
        requestId: result.requestId,
        responseText: result.responseText,
        ...(result.orderId !== undefined
          ? { orderId: result.orderId }
          : {}),
        capability: result.approvalPause.capability,
        approvalCapability:
          `scenario-internal:${result.approvalPause.requestId}`,
        expiresAt: result.approvalPause.expiresAt,
      };
    },
  });
  const response = await coordinator({
    requestId: pause.requestId,
    decision: 'approve',
  });
  if (
    response.status !== 200 ||
    response.body.status !== 'completed' ||
    !resumedOutput ||
    executionCount !== 1
  ) {
    throw new Error(
      `scenario_confirmation_resume_failed:${
        executionFailure instanceof Error
          ? executionFailure.message
          : String(response.body.errorCode ?? response.status)
      }`,
    );
  }
  const replay = await coordinator({
    requestId: pause.requestId,
    decision: 'approve',
  });
  if (
    executionCount !== 1 ||
    JSON.stringify(replay) !== JSON.stringify(response)
  ) {
    throw new Error('scenario_confirmation_replay_mismatch');
  }
  const continuation =
    resumedOutput.status === 'paused'
      ? 'approval_required'
      : 'turn_completed';
  return {
    output: resumedOutput,
    evidence: {
      requestId: pause.requestId,
      capability: pause.action.toolName,
      checkpointId:
        Object.getOwnPropertyDescriptor(
          pause,
          'confirmationRecord',
        )?.value?.checkpointId ?? '',
      actionOutcome: 'succeeded',
      continuation,
      replayVerified: true,
    },
  };
}

export async function runScenario(
  script: ScenarioScript,
  options: RunScenarioOptions,
): Promise<ScenarioRunResult> {
  const sessionId = `replay_${script.id}`;
  if (
    options.autoApproveConfirmations &&
    (
      (
        !options.accessContext &&
        !options.guestCheckoutAuthorityForTurn
      ) ||
      !options.confirmationSigningSecret
    )
  ) {
    throw new Error(
      'scenario_confirmation_approval_authority_required',
    );
  }
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const loadedFixtures = await loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
  const fixtures = options.transformFixtures?.(loadedFixtures) ?? loadedFixtures;
  if (fixtures.menuItems.length < 80) {
    throw new Error(`Expected generated menu fixtures, received ${fixtures.menuItems.length}`);
  }
  const mockClientOptions: MockClientOptions = { ...(options.mockClientOptions ?? {}) };
  let currentMockedUpstreamApi: MockedUpstreamApiProfile | undefined;
  if (options.mockedUpstreamApiForTurn) {
    mockClientOptions.mockedUpstreamApiProvider = () => currentMockedUpstreamApi;
  }
  if (options.testFulfillmentQuoteProvider) {
    mockClientOptions.fulfillmentQuoteProvider = options.testFulfillmentQuoteProvider;
  }
  const clients = createMockClients(fixtures, mockClientOptions);
  const escalationReasons = new Set<string>();
  let currentCart: Cart | undefined;
  let currentOrder: Order | undefined;
  let currentHandoff: AgentGraphState['handoff'];
  let finalAgentState: AgentGraphState | undefined;
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const toolTraceByTurn: Array<{ turnIndex: number; entries: ToolTraceEntry[] }> = [];
  const turnEvidence: ScenarioTurnEvidence[] = [];
  let priorStateToolTrace: ToolTraceEntry[] = [];
  let priorEvidenceState = selectEvidenceState(options.initialVerifiedState);
  const checkpointer = new MemorySaver();
  const confirmationRepository =
    createConversationStoreConfirmationResumeRepository(store);

  if (options.initialVerifiedState) {
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: options.initialVerifiedState,
    });
  }

  for (const [index, turn] of script.userTurns.entries()) {
    const externalMessageId = `${script.id}:${turn.index}`;
    const checkpointRunId = `scenario:${crypto.randomUUID()}`;
    const reservation = await reserveKfcSynchronousRequest({
      store,
      sessionId,
      clientMessageId: externalMessageId,
      bindingFingerprint: await sha256Fingerprint({
        schemaVersion: 'kfc-scenario-turn-v1',
        scenarioId: script.id,
        turnIndex: turn.index,
        customerId: 'scenario_customer',
        channel: options.channelOverride ?? script.channel,
        text: turn.text,
        ...(options.traceRunId
          ? { probeRunId: options.traceRunId }
          : {}),
      }),
    });
    if (reservation.status !== 'ready') {
      throw new Error(
        `scenario_turn_reservation_not_ready:${reservation.response.status}`,
      );
    }
    const transcriptRevisionBefore = (await store.listTurns(sessionId)).length;
    const eventsBefore = await store.listEvents(sessionId);
    const eventRevisionBefore = eventsBefore.length;
    const stateBefore = priorEvidenceState;
    const startedAt = performance.now();
    currentMockedUpstreamApi = options.mockedUpstreamApiForTurn?.(turn.index);
    if (index === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    try {
      const guestCheckoutAuthority =
        await options.guestCheckoutAuthorityForTurn?.({
          sessionId,
          customerId: 'scenario_customer',
          externalMessageId,
          turnIndex: turn.index,
          runFence: reservation.fence.runGuard.commitFence,
        });
      const turnInput: AgentTurnInput = {
      sessionId,
      customerId: 'scenario_customer',
      channel: options.channelOverride ?? script.channel,
      responseProfile: options.responseProfileOverride,
      text: turn.text,
      externalMessageId,
      checkpointRunId,
      accessContext: options.accessContext,
      guestCheckoutAuthority,
      traceContext: createAgentTraceContext({
        scenarioId: script.id,
        ...(options.traceRunId ? { probeRunId: options.traceRunId } : {}),
      }),
      clients,
      store,
      dashboard,
      agentModel: options.agentModel,
      tracer: options.tracer,
      turnDeadlineMs: options.turnDeadlineMs,
      checkpointer,
      runGuard: reservation.fence.runGuard,
    };
    let output = await runAgentTurn(turnInput);
    const approvalResumes: ScenarioApprovalResumeEvidence[] = [];
    const resumedRequestIds = new Set<string>();
    while (output.status === 'paused') {
      const requestId = output.pause?.requestId;
      const capability = output.pause?.action?.toolName;
      const shouldApprove =
        requestId && capability
          ? typeof options.autoApproveConfirmations === 'function'
            ? options.autoApproveConfirmations({
                turnIndex: turn.index,
                capability,
                requestId,
              })
            : options.autoApproveConfirmations === true
          : false;
      if (!shouldApprove) break;
      if (!requestId || resumedRequestIds.has(requestId)) {
        throw new Error('scenario_confirmation_request_id_reused');
      }
      if (
        approvalResumes.length >=
        maximumScenarioApprovalResumesPerTurn
      ) {
        throw new Error('scenario_confirmation_resume_limit_exceeded');
      }
      resumedRequestIds.add(requestId);
      const resumed = await approveScenarioPause({
        output,
        turnInput,
        repository: confirmationRepository,
        signingSecret: options.confirmationSigningSecret!,
      });
      approvalResumes.push(resumed.evidence);
      output = resumed.output;
    }
    const durationMs = performance.now() - startedAt;
    const outputTrace = output.state.toolTrace ?? [];
    finalAgentState = output.state;
    priorEvidenceState = selectEvidenceState(output.state);
    const continuesPriorTrace =
      outputTrace.length >= priorStateToolTrace.length &&
      priorStateToolTrace.every((entry, traceIndex) =>
        scenarioTraceEntryIsSame(entry, outputTrace[traceIndex]),
      );
    const currentTurnEntries = continuesPriorTrace
      ? outputTrace.slice(priorStateToolTrace.length)
      : outputTrace;
    toolTrace.push(...currentTurnEntries);
    toolTraceByTurn.push({ turnIndex: turn.index, entries: currentTurnEntries });
    priorStateToolTrace = outputTrace;
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
    if (output.state.cart) currentCart = output.state.cart;
    if (output.state.order) currentOrder = output.state.order;
    currentHandoff = output.state.handoff;
    const turnsAfter = await store.listTurns(sessionId);
    const eventsAfter = await store.listEvents(sessionId);
    const checkpoint = await exactScenarioCheckpointEvidence({
      checkpointer,
      sessionId,
      checkpointRunId,
    });
    const assistantTurn = output.assistantTurnId
      ? turnsAfter.find(({ id }) => id === output.assistantTurnId)
      : undefined;
    turnEvidence.push({
      turnIndex: turn.index,
      input: turn.text,
      durationMs,
      transcriptRevisionBefore,
      transcriptRevisionAfter: turnsAfter.length,
      eventRevisionBefore,
      eventRevisionAfter: eventsAfter.length,
      eventIdsBefore: eventsBefore.map(({ id }) => id),
      eventIds: eventsAfter.slice(eventRevisionBefore).map(({ id }) => id),
      eventIdsAfter: eventsAfter.map(({ id }) => id),
      checkpointId: checkpoint.id,
      checkpointNamespace: checkpoint.namespace,
      checkpointThreadId: checkpoint.threadId,
      checkpointVerified: checkpoint.verified,
      assistantText: assistantTurn?.text ?? '',
      genUi: assistantTurn?.metadata?.genUi,
      approvalRequested:
        approvalResumes.length > 0 || output.status === 'paused',
      approvalResumes,
      stateBefore,
      stateAfter: priorEvidenceState,
    });
      await reservation.fence.complete({
        status: 200,
        body: {
          scenarioId: script.id,
          turnIndex: turn.index,
        },
      });
    } catch (error) {
      await reservation.fence.fail(error);
      throw error;
    }
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  const transcript = await store.listTurns(sessionId);
  const persistedEvents = await store.listEvents(sessionId);
  return {
    finalState: currentHandoff
      ? script.id === '05-khieu-nai-va-human-handoff'
        ? 'human_handoff_created'
        : 'human_review_required'
      : script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents,
    escalationReasons: [...escalationReasons],
    transcript,
    eventsBeforeFinalUserTurn,
    toolTrace,
    toolTraceByTurn,
    turnEvidence,
    persistedEvents,
    finalAgentState,
    cart: currentCart,
    order: currentOrder,
  };
}

function selectEvidenceState(
  state: Partial<AgentGraphState> | undefined,
): ScenarioEvidenceState {
  if (!state) return {};
  return structuredClone({
    cart: state.cart,
    address: state.address,
    addressDraft: state.addressDraft,
    fulfillment: state.fulfillment,
    orderPreview: state.orderPreview,
    order: state.order,
    paymentAttempt: state.paymentAttempt,
    handoff: state.handoff,
    menuSearchResults: state.menuSearchResults,
    activeMenuCollection: state.activeMenuCollection,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
    pendingSavedAddressRef: state.pendingSavedAddressRef,
    promotionContext: state.promotionContext,
    promotionOffers: state.promotionOffers,
    customerContext: state.customerContext,
    paymentMethodEvidence: state.paymentMethodEvidence,
    selectedPaymentMethod: state.selectedPaymentMethod,
    contentEvidence: state.contentEvidence,
    invoiceRequest: state.invoiceRequest,
    cancellationStatusChecked: state.cancellationStatusChecked,
    commerceApprovalReceipts: state.commerceApprovalReceipts,
  });
}
