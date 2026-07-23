import { MemorySaver } from '@langchain/langgraph';
import {
  createKfcAgentStateGraph,
  type KfcAgentGraphInput,
} from '../agent/agentStateGraph.js';
import type {
  SingleAgentRuntimeContext,
} from '../agent/singleAgentRuntime.js';
import {
  createAgentTurnExternalCallScope,
  defaultAgentTurnDeadlineMs,
} from '../agent/singleAgentRuntime.js';
import { buildServerOptionsFromEnv } from '../api/serverOptions.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadEnv } from '../config/env.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { createMockClients } from '../mock/createMockClients.js';
import { createNoopAgentTracer } from '../observability/agentTracing.js';
import { MemoryStore } from '../persistence/memoryStore.js';

const env = loadEnv();
const options = buildServerOptionsFromEnv(env);
if (!options.agent) {
  throw new Error('KFC agent model is required for LangGraph Studio');
}
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const clientsPromise = loadGeneratedFixtures(process.cwd()).then((fixtures) =>
  createMockClients(fixtures, options.mockClientOptions),
);
const noopTracer = createNoopAgentTracer();
const runtimeByRequest = new Map<
  string,
  Promise<SingleAgentRuntimeContext>
>();

function studioRequestKey(request: KfcAgentGraphInput): string {
  const externalMessageId = request.externalMessageId?.trim();
  if (!externalMessageId) {
    throw new Error('externalMessageId is required for LangGraph Studio');
  }
  return JSON.stringify([request.sessionId, externalMessageId]);
}

function resolveStudioRuntime(
  request: KfcAgentGraphInput,
): Promise<SingleAgentRuntimeContext> {
  const key = studioRequestKey(request);
  let runtime = runtimeByRequest.get(key);
  if (!runtime) {
    const externalCallScope = createAgentTurnExternalCallScope(
      defaultAgentTurnDeadlineMs,
    );
    let externalCallsDisposed = false;
    const disposeExternalCalls = () => {
      if (!externalCallsDisposed) {
        externalCallsDisposed = true;
        externalCallScope.context.signal.removeEventListener(
          'abort',
          disposeExternalCalls,
        );
        externalCallScope.dispose();
      }
      if (runtimeByRequest.get(key) === runtime) {
        runtimeByRequest.delete(key);
      }
    };
    runtime = (async () => ({
      turnInput: {
        ...request,
        responseProfile: request.metadata?.responseProfile,
        clients: await clientsPromise,
        store,
        dashboard,
      },
      turnTrace: await noopTracer.startTurn({
        name: 'studio_agent_turn',
        inputs: {
          sessionId: request.sessionId,
          customerId: request.customerId,
          channel: request.channel,
          latestUserMessage: request.text,
        },
        metadata: {
          source: 'langsmith_studio',
          clientMessageId: request.externalMessageId,
        },
        tags: ['kfc-agent-turn', 'langsmith-studio'],
      }),
      externalCallContext: externalCallScope.context,
      abortExternalCalls: externalCallScope.abort,
      disposeExternalCalls,
    }))();
    runtimeByRequest.set(key, runtime);
    externalCallScope.context.signal.addEventListener(
      'abort',
      disposeExternalCalls,
      { once: true },
    );
    if (externalCallScope.context.signal.aborted) {
      disposeExternalCalls();
    }
    void runtime.catch(() => disposeExternalCalls());
  }
  return runtime;
}

/**
 * Studio exports the same StateGraph used by production. Only runtime
 * dependencies are supplied by this fixture-backed resolver closure.
 */
export const agent = createKfcAgentStateGraph({
  model: options.agent.model,
  checkpointer: new MemorySaver(),
  resolveRuntime: resolveStudioRuntime,
});
