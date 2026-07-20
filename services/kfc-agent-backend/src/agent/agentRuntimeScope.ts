import type { Runtime } from '@langchain/langgraph';
import { getConfig } from '@langchain/langgraph';
import {
  graphInput,
  type KfcAgentRuntimeResolver,
} from './agentStateGraphContracts.js';
import type {
  KfcAgentStateUpdate,
  KfcAgentStateValue,
} from './agentStateSchema.js';
import {
  runtimeDispatchFailure,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export type AgentRuntime =
  Runtime<{ runtime?: SingleAgentRuntimeContext }>;

const LANGGRAPH_RESUMING_CONFIG_KEY = '__pregel_resuming';

function runtimeMatchesGraphLookup(
  runtime: SingleAgentRuntimeContext,
  lookup: ReturnType<typeof graphInput>,
): boolean {
  return (
    runtime.turnInput.sessionId === lookup.sessionId &&
    runtime.turnInput.customerId === lookup.customerId &&
    runtime.turnInput.channel === lookup.channel &&
    (runtime.turnInput.externalMessageId ?? null) ===
      lookup.externalMessageId
  );
}

export function createAgentRuntimeScope(input: {
  resolveRuntime?: KfcAgentRuntimeResolver;
}) {
  const checkpointResumeRuntimesByRun =
    new WeakMap<object, WeakSet<SingleAgentRuntimeContext>>();
  const resolveRuntime = async (
    state: KfcAgentStateValue,
    runtime: AgentRuntime,
  ): Promise<SingleAgentRuntimeContext> => {
    const injected = runtime.context?.runtime;
    if (injected) return injected;
    const activeConfig = getConfig();
    const configuration = activeConfig.configurable;
    const runControl = activeConfig.control;
    const langGraphIsResuming =
      configuration?.[LANGGRAPH_RESUMING_CONFIG_KEY] === true;
    const lookup = graphInput(state, {
      allowMissingUntrackedText: true,
    });
    const resolved = await input.resolveRuntime?.(lookup);
    if (!resolved) throw new Error('agent_runtime_context_missing');
    if (!runtimeMatchesGraphLookup(resolved, lookup)) {
      throw new Error('agent_runtime_context_mismatch');
    }
    if (typeof state.text !== 'string') {
      if (!runControl) throw new Error('agent_graph_input_invalid');
      let authorizedRuntimes =
        checkpointResumeRuntimesByRun.get(runControl);
      if (langGraphIsResuming) {
        authorizedRuntimes ??= new WeakSet();
        authorizedRuntimes.add(resolved);
        checkpointResumeRuntimesByRun.set(
          runControl,
          authorizedRuntimes,
        );
      } else if (!authorizedRuntimes?.has(resolved)) {
        throw new Error('agent_graph_input_invalid');
      }
    }
    return resolved;
  };
  const invokeWithinTurnScope = async (
    state: KfcAgentStateValue,
    graphRuntime: AgentRuntime,
    invoke: (
      runtime: SingleAgentRuntimeContext,
    ) => Promise<KfcAgentStateUpdate>,
  ): Promise<KfcAgentStateUpdate> => {
    const runtime = await resolveRuntime(state, graphRuntime);
    const failure = await runtimeDispatchFailure(runtime);
    if (failure) return { failure };
    const update = await invoke(runtime);
    const completedFailure = await runtimeDispatchFailure(runtime);
    return completedFailure ? { failure: completedFailure } : update;
  };
  return { resolveRuntime, invokeWithinTurnScope };
}
