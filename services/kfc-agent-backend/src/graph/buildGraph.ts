import {
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createKfcAgentStateGraph,
  type KfcAgentStateGraph,
} from '../agent/agentStateGraph.js';
import { runKfcAgentStateGraphTurn } from '../agent/agentStateGraphRunner.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
} from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  agentCheckpointRunId,
  langGraphConfigForRun,
} from '../session/sessionContext.js';
import {
  type AgentTurnInput,
  type AgentTurnOutput,
} from './agentTurnState.js';
import {
  traceProbeRunId,
  traceScenarioId,
  traceStateSummary,
  stateRevision,
} from './turnSupport.js';

export type {
  AgentTurnInput,
  AgentTurnOutput,
  IrreversibleConfirmationResume,
  ReplyIntent
} from './agentTurnState.js';

const storeCheckpointers = new WeakMap<ConversationStore, BaseCheckpointSaver>();
const agentGraphs = new WeakMap<
  BaseChatModel,
  WeakMap<BaseCheckpointSaver, KfcAgentStateGraph>
>();
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

function agentGraphFor(
  model: BaseChatModel,
  checkpointer: BaseCheckpointSaver,
): KfcAgentStateGraph {
  let byCheckpointer = agentGraphs.get(model);
  if (!byCheckpointer) {
    byCheckpointer = new WeakMap();
    agentGraphs.set(model, byCheckpointer);
  }
  let graph = byCheckpointer.get(checkpointer);
  if (!graph) {
    graph = createKfcAgentStateGraph({ model, checkpointer });
    byCheckpointer.set(checkpointer, graph);
  }
  return graph;
}

function checkpointRunId(input: AgentTurnInput): string {
  const resumedThreadId =
    input.confirmationResume?.checkpoint?.threadId;
  if (resumedThreadId) {
    const resumedRunId = agentCheckpointRunId(
      resumedThreadId,
      input.sessionId,
    );
    if (
      !resumedRunId ||
      (
        input.checkpointRunId !== undefined &&
        input.checkpointRunId !== resumedRunId
      )
    ) {
      throw new Error('agent_confirmation_checkpoint_mismatch');
    }
    return resumedRunId;
  }
  if (input.checkpointRunId !== undefined) {
    if (!input.checkpointRunId.trim()) {
      throw new Error('agent_checkpoint_run_id_invalid');
    }
    return input.checkpointRunId;
  }
  return `ephemeral:${crypto.randomUUID()}`;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const agentModel = input.agentModel;
  if (!agentModel) throw new Error('kfc_agent_not_configured');
  const resumesConfirmation = input.confirmationResume !== undefined;
  if (resumesConfirmation && !input.confirmationResume?.requestId.trim()) {
    throw new Error('Confirmation resume request id is required');
  }
  const confirmationRequestId =
    input.confirmationRequestId?.trim() || crypto.randomUUID();
  const checkpointer = checkpointerForInput(input);
  const resolvedCheckpointRunId = checkpointRunId(input);
  const runtimeInput: AgentTurnInput = {
    ...input,
    checkpointRunId: resolvedCheckpointRunId,
    checkpointer,
    confirmationRequestId,
  };
  const scenarioId = traceScenarioId(input);
  const probeRunId = traceProbeRunId(input);
  const rawEvent = input.metadata?.rawEvent;
  const trustedTraceContext = scenarioId !== undefined;
  const [
    messageDigest,
    metadataDigest,
    rawEventDigest,
    sessionIdDigest,
    customerIdDigest,
    clientMessageIdDigest,
  ] = await Promise.all([
    stateRevision(input.text),
    stateRevision(input.metadata ?? null),
    stateRevision(rawEvent ?? null),
    stateRevision(input.sessionId),
    stateRevision(input.customerId),
    stateRevision(input.externalMessageId ?? null),
  ]);
  const tracer = createSafeAgentTracer(input.tracer ?? createNoopAgentTracer(), (code, error) => {
    void input.store.appendEvent(input.sessionId, code, {
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  });
  const turnTrace = await tracer.startTurn({
    name: 'agent_turn',
    inputs: {
      ...(trustedTraceContext
        ? {
            sessionId: input.sessionId,
            customerId: input.customerId,
          }
        : {
            sessionIdDigest,
            customerIdDigest,
          }),
      channel: input.channel,
      latestUserMessagePresent: input.text.length > 0,
      latestUserMessageLength: input.text.length,
      latestUserMessageDigest: messageDigest,
      metadataPresent: input.metadata !== undefined,
      metadataDigest,
    },
    metadata: {
      ...(trustedTraceContext
        ? { session_id: input.sessionId }
        : { session_id_digest: sessionIdDigest }),
      scenarioId: scenarioId ?? 'live-agent',
      probeRunId: probeRunId ?? null,
      ...(trustedTraceContext
        ? { clientMessageId: input.externalMessageId ?? null }
        : { clientMessageIdDigest }),
      ...(rawEvent
        ? {
            rawEvent: {
              type: 'record',
              count: Object.keys(rawEvent).length,
              digest: rawEventDigest,
            },
          }
        : {}),
    },
    tags: [
      'kfc-agent-turn',
      trustedTraceContext
        ? `session:${input.sessionId}`
        : `session-digest:${sessionIdDigest}`,
      ...(scenarioId ? [`scenario:${scenarioId}`] : []),
    ],
  });

  try {
    const checkpointConfig = langGraphConfigForRun(
      runtimeInput.sessionId,
      resolvedCheckpointRunId,
    );
    return await runKfcAgentStateGraphTurn({
      graph: agentGraphFor(agentModel, checkpointer),
      turnInput: runtimeInput,
      turnTrace,
      checkpoint: {
        threadId: checkpointConfig.configurable.thread_id,
        namespace: checkpointConfig.configurable.checkpoint_ns,
      },
    });
  } catch (error) {
    await turnTrace.fail(error);
    throw error;
  }
}
