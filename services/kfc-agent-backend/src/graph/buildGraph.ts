import {
  Command,
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTraceApplicability,
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  textOnlyPresentation
} from '../presentation/channelPresentation.js';
import { langGraphConfigForRun } from '../session/sessionContext.js';
import {
  applyPlannerSavedAddressDecision
} from './addressContext.js';
import {
  type AgentTurnGraphRuntimeResolver,
  type AgentTurnGraphState,
  type AgentTurnInput,
  type AgentTurnOutput,
  type IrreversibleConfirmationBinding
} from './agentTurnState.js';
import { activeTurnTraces } from './commerceExecution.js';
import {
  beginFreshShoppingJourney,
  clearRecoverableFulfillmentArgumentFailure,
  ensureAbnormalLargeOrderHandoff
} from './commerceLifecycle.js';
import { emitDerivedEvents, emitSessionIntelligence } from './commerceMonitoring.js';
import { executeNaturalLanguagePlan } from './naturalLanguageExecution.js';
import {
  compileAgentTurnStateGraph,
  type AgentTurnNodeOperations,
} from './nodes.js';
import { composeAssistantResponse } from './responseComposition.js';
import type { AgentGraphState } from './state.js';
import {
  handleStructuredCartAction,
  handleStructuredFulfillmentAction,
  handleStructuredOrderOrPaymentAction,
  structuredCommerceResponseSpec,
} from './structuredActions.js';
import { loadAgentTurnContext } from './turnContext.js';
import {
  planNaturalLanguageTurn
} from './turnPlanning.js';
import {
  confirmationBinding,
  customerCommand,
  emitDashboardEvent,
  hasPlannerBooleanEntity,
  isRunStillCurrent,
  pushEscalationReasons,
  stateRevision,
  tracePolicyDecision,
  traceProbeRunId,
  traceScenarioId,
  traceStateSummary
} from './turnSupport.js';
import {
  loadPriorVerifiedState,
  persistVerifiedStateSnapshot
} from './verifiedState.js';

export type {
  AgentTurnGraphRuntime,
  AgentTurnGraphRuntimeResolver,
  AgentTurnInput,
  AgentTurnOutput,
  IrreversibleConfirmationBinding,
  IrreversibleConfirmationResume,
  ReplyIntent
} from './agentTurnState.js';

const resolveConfiguredAgentTurnRuntime: AgentTurnGraphRuntimeResolver = (state, config) => {
  const input = config.configurable?.agentTurnInput;
  const turnTrace = config.configurable?.agentTurnTrace;
  if (!input || !turnTrace) {
    throw new Error(
      'Agent turn runtime dependencies are missing. Invoke runAgentTurn or provide a Studio runtime resolver.',
    );
  }
  const typedInput = input as AgentTurnInput;
  if (
    typedInput.sessionId !== state.sessionId ||
    typedInput.customerId !== state.customerId ||
    typedInput.channel !== state.channel ||
    (!typedInput.confirmationResume && typedInput.text !== state.text)
  ) {
    throw new Error('Agent turn graph input does not match the configured runtime input');
  }
  return {
    input: typedInput,
    turnTrace: turnTrace as AgentTraceSpan,
  };
};

const agentTurnNodeOperations: AgentTurnNodeOperations = {
  loadContext: loadAgentTurnContext,
  isRunStillCurrent,
  customerCommand,
  planNaturalLanguageTurn,
  applyPlannerSavedAddressDecision,
  hasPlannerBooleanEntity,
  beginFreshShoppingJourney,
  confirmationBinding,
  loadPriorVerifiedState,
  stateRevision,
  structuredCommerceResponseSpec,
  handleStructuredFulfillmentAction,
  handleStructuredOrderOrPaymentAction,
  handleStructuredCartAction,
  executeNaturalLanguagePlan,
  ensureAbnormalLargeOrderHandoff,
  clearRecoverableFulfillmentArgumentFailure,
  tracePolicyDecision,
  pushEscalationReasons,
  composeAssistantResponse,
  emitDerivedEvents,
  persistVerifiedStateSnapshot,
  emitDashboardEvent,
  traceStateSummary,
  emitSessionIntelligence,
};

export function createAgentTurnStateGraph(
  resolveRuntime: AgentTurnGraphRuntimeResolver = resolveConfiguredAgentTurnRuntime,
  checkpointer?: BaseCheckpointSaver,
) {
  if (!checkpointer) {
    throw new Error('A checkpoint saver is required; use MemorySaver only for explicit test or Studio graphs');
  }
  return compileAgentTurnStateGraph(resolveRuntime, checkpointer, agentTurnNodeOperations);
}
/** Explicit in-memory graph for unit tests. Server call paths must inject their durable saver. */
export const agentTurnGraph = createAgentTurnStateGraph(resolveConfiguredAgentTurnRuntime, new MemorySaver());
const checkpointGraphs = new WeakMap<BaseCheckpointSaver, ReturnType<typeof createAgentTurnStateGraph>>();
const storeCheckpointers = new WeakMap<ConversationStore, BaseCheckpointSaver>();
let testCheckpointerFactory: (() => BaseCheckpointSaver) | undefined;

export function enableInMemoryAgentTurnCheckpointsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('In-memory agent checkpoints may only be enabled when NODE_ENV=test');
  }
  testCheckpointerFactory = () => new MemorySaver();
}

function checkpointerForInput(input: AgentTurnInput): BaseCheckpointSaver {
  if (input.checkpointer) return input.checkpointer;
  if (!testCheckpointerFactory) {
    throw new Error('runAgentTurn requires an injected durable checkpoint saver');
  }
  let checkpointer = storeCheckpointers.get(input.store);
  if (!checkpointer) {
    checkpointer = testCheckpointerFactory();
    storeCheckpointers.set(input.store, checkpointer);
  }
  return checkpointer;
}

function agentTurnGraphFor(checkpointer: BaseCheckpointSaver) {
  let graph = checkpointGraphs.get(checkpointer);
  if (!graph) {
    graph = createAgentTurnStateGraph(resolveConfiguredAgentTurnRuntime, checkpointer);
    checkpointGraphs.set(checkpointer, graph);
  }
  return graph;
}

function isTraceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function traceApplicability(input: AgentTurnInput): AgentTraceApplicability {
  const configured = input.metadata?.rawEvent?.traceApplicability;
  const requirement = (value: unknown) =>
    value === 'required' || value === 'optional' ? value : 'forbidden';
  if (!isTraceRecord(configured)) {
    return {
      tool: 'forbidden',
      approval: 'forbidden',
      verifiedState: 'forbidden',
      genui: 'forbidden',
    };
  }
  return {
    tool: requirement(configured.tool),
    approval: requirement(configured.approval),
    verifiedState: requirement(configured.verifiedState),
    genui: requirement(configured.genui),
  };
}

function checkpointRunId(input: AgentTurnInput): string {
  if (input.confirmationRequestId) return `confirmation:${input.confirmationRequestId}`;
  if (input.externalMessageId?.trim()) return input.externalMessageId;
  return `ephemeral:${crypto.randomUUID()}`;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const resumesConfirmation = input.confirmationResume !== undefined;
  const startsConfirmation = customerCommand(input.metadata)?.kind === 'confirm_order';
  const confirmationRequestId = resumesConfirmation
    ? input.confirmationResume!.requestId
    : startsConfirmation
      ? crypto.randomUUID()
      : undefined;
  if (resumesConfirmation && !input.confirmationResume?.requestId.trim()) {
    throw new Error('Confirmation resume request id is required');
  }
  const checkpointer = checkpointerForInput(input);
  const runtimeInput: AgentTurnInput = {
    ...input,
    checkpointer,
    confirmationAuthority: input.confirmationAuthority ?? input.clients.confirmationAuthority,
    confirmationRequestId,
  };
  const scenarioId = traceScenarioId(input);
  const probeRunId = traceProbeRunId(input);
  const tracer = createSafeAgentTracer(input.tracer ?? createNoopAgentTracer(), (code, error) => {
    void input.store.appendEvent(input.sessionId, code, {
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  });
  const turnTrace = await tracer.startTurn({
    name: 'agent_turn',
    category: 'agent_loop',
    applicability: traceApplicability(input),
    inputs: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      latestUserMessage: input.text,
      metadata: input.metadata ?? null,
    },
    metadata: {
      session_id: input.sessionId,
      scenarioId: scenarioId ?? 'live-agent',
      probeRunId: probeRunId ?? null,
      clientMessageId: input.externalMessageId ?? null,
    },
    tags: ['kfc-agent-turn', `session:${input.sessionId}`, ...(scenarioId ? [`scenario:${scenarioId}`] : [])],
  });
  activeTurnTraces.set(runtimeInput, turnTrace);

  try {
    const checkpointConfig = langGraphConfigForRun(runtimeInput.sessionId, checkpointRunId(runtimeInput));
    const graphInput = resumesConfirmation
      ? new Command<unknown, Partial<AgentTurnGraphState>, never>({ resume: runtimeInput.confirmationResume })
      : {
        sessionId: runtimeInput.sessionId,
        customerId: runtimeInput.customerId,
        channel: runtimeInput.channel,
        text: runtimeInput.text,
        externalMessageId: runtimeInput.externalMessageId ?? null,
        metadata: runtimeInput.metadata ?? null,
      };
    const graph = agentTurnGraphFor(checkpointer);
    const graphResult = await graph.invoke(
      graphInput,
      {
        configurable: {
          ...checkpointConfig.configurable,
          agentTurnInput: runtimeInput,
          agentTurnTrace: turnTrace,
        },
      },
    );
    const interruption = (graphResult as unknown as {
      __interrupt__?: Array<{
        value?: {
          binding: IrreversibleConfirmationBinding;
          state: AgentGraphState;
        }
       }>;
    }).__interrupt__?.[0]?.value;
    if (interruption?.binding.kind === 'confirm_order') {
      const state = interruption.state;
      const responseText = '';
      const output: AgentTurnOutput = {
        state,
        responseText,
        presentation: textOnlyPresentation(responseText, runtimeInput.channel),
        replyIntent: 'general_reply',
        status: 'paused',
        pause: {
          capability: 'confirm_order',
          requestId: interruption.binding.requestId,
          binding: interruption.binding,
        },
      };
      await turnTrace.end({
        status: 'paused',
        capability: 'confirm_order',
        state: traceStateSummary(state),
      });
      return output;
    }
    const output = graphResult.output;
    await turnTrace.end({
      replyIntent: output.replyIntent,
      suppressed: output.suppressed ?? false,
      genUiKind: output.genUi?.widgetKind ?? null,
      state: traceStateSummary(output.state),
      responseText: output.responseText,
    });
    return { ...output, status: 'completed' };
  } catch (error) {
    await turnTrace.fail(error);
    throw error;
  } finally {
    activeTurnTraces.delete(runtimeInput);
  }
}
