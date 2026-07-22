import { describe, expect, it } from 'vitest';
import {
  privacySafeGraphTraceState,
  traceAgentGraphNode,
  traceAgentGraphNodes,
  traceAgentGraphRoute,
  traceAgentGraphRoutes,
} from '../../src/agent/agentGraphObservability.js';
import type {
  KfcAgentStateValue,
} from '../../src/agent/agentStateSchema.js';
import type {
  AgentRuntime,
} from '../../src/agent/agentRuntimeScope.js';
import type {
  SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';

interface TraceEvent {
  phase: 'end' | 'fail' | 'start';
  name: string;
  payload: unknown;
}

class CaptureSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: TraceEvent[],
  ) {}

  async startSpan(
    input: AgentTraceSpanInput,
  ): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({
      phase: 'end',
      name: this.name,
      payload: outputs,
    });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: error instanceof Error ? error.message : String(error),
    });
  }
}

const privateValue = 'PRIVATE-CUSTOMER-CONTENT-DO-NOT-TRACE';
const graphRuntime = {} as AgentRuntime;

function privateState(): KfcAgentStateValue {
  return {
    messages: [{ content: privateValue }],
    pendingToolCalls: [{
      id: 'private-call-id',
      toolName: 'selectAddress',
      arguments: {
        address: privateValue,
        phone: privateValue,
      },
    }],
    queuedToolCalls: [],
    graphExecutedToolResults: [],
    structuredAction: { privateValue },
    providerAttempts: 2,
    providerAttemptEvidence: [{
      attempt: 2,
      outcome: 'error',
      purpose: 'agent_decision',
      errorClass: 'rate_limited',
      retryable: true,
    }],
    providerFailure: {
      errorClass: 'rate_limited',
      retryable: true,
    },
    providerRetries: 1,
    semanticCorrections: 1,
    failure: privateValue,
    validationError: privateValue,
  } as unknown as KfcAgentStateValue;
}

function traceRuntime(events: TraceEvent[]): SingleAgentRuntimeContext {
  return {
    turnTrace: new CaptureSpan('agent_turn', events),
  } as unknown as SingleAgentRuntimeContext;
}

describe('agent graph observability', () => {
  it('projects only bounded counts and state flags', () => {
    expect(privacySafeGraphTraceState(privateState())).toEqual({
      providerAttempts: 2,
      providerRetries: 1,
      semanticCorrections: 1,
      pendingToolCallCount: 1,
      queuedToolCallCount: 0,
      executedToolResultCount: 0,
      hasStructuredAction: true,
      hasFailure: true,
      failureCategory: null,
      hasValidationError: true,
      validationErrorCategory: null,
      latestProviderAttempt: 2,
      latestProviderOutcome: 'error',
      latestProviderPurpose: 'agent_decision',
      latestProviderErrorClass: 'rate_limited',
      latestProviderRetryable: true,
      providerFailureErrorClass: 'rate_limited',
      providerFailureRetryable: true,
    });
  });

  it('maps only allowlisted validation errors to bounded categories', () => {
    expect(privacySafeGraphTraceState({
      validationError: 'structured_action_saved_address_ref_unavailable',
    })).toMatchObject({
      hasValidationError: true,
      validationErrorCategory: 'saved_address_authority_invalid',
    });
    expect(privacySafeGraphTraceState({
      validationError: privateValue,
    })).toMatchObject({
      hasValidationError: true,
      validationErrorCategory: null,
    });
  });

  it('maps allowlisted validation failures to bounded categories', () => {
    expect(privacySafeGraphTraceState({
      failure: 'agent_response_claim_unsupported',
    })).toMatchObject({
      hasFailure: true,
      failureCategory: 'response_grounding_invalid',
    });
    expect(privacySafeGraphTraceState({
      failure: privateValue,
    })).toMatchObject({
      hasFailure: true,
      failureCategory: null,
    });
  });

  it('emits the bounded validation category on node completion', async () => {
    const events: TraceEvent[] = [];
    const node = traceAgentGraphNode(
      'validate_tool_calls',
      async () => ({
        validationError: 'structured_action_saved_address_ref_unavailable',
      }),
      async () => traceRuntime(events),
    );

    await node(privateState(), graphRuntime);

    expect(events.at(-1)).toEqual({
      phase: 'end',
      name: 'validate_tool_calls',
      payload: expect.objectContaining({
        emittedValidationError: true,
        validationErrorCategory: 'saved_address_authority_invalid',
      }),
    });
    expect(JSON.stringify(events)).not.toContain(privateValue);
  });

  it('emits a bounded publication failure category on node completion', async () => {
    const events: TraceEvent[] = [];
    const node = traceAgentGraphNode(
      'validate_publication',
      async () => ({
        failure: 'agent_response_publication_rejected',
      }),
      async () => traceRuntime(events),
    );

    await node(privateState(), graphRuntime);

    expect(events.at(-1)).toEqual({
      phase: 'end',
      name: 'validate_publication',
      payload: expect.objectContaining({
        emittedFailure: true,
        failureCategory: 'response_publication_invalid',
      }),
    });
    expect(JSON.stringify(events)).not.toContain(privateValue);
  });

  it('traces node execution without serializing private state or updates', async () => {
    const events: TraceEvent[] = [];
    const state = privateState();
    const node = traceAgentGraphNode(
      'call_model',
      async () => ({
        responseText: privateValue,
      }),
      async () => traceRuntime(events),
    );

    await node(state, graphRuntime);

    expect(events).toEqual([
      {
        phase: 'start',
        name: 'call_model',
        payload: expect.objectContaining({
          name: 'call_model',
          runType: 'chain',
          inputs: expect.objectContaining({
            node: 'call_model',
            pendingToolCallCount: 1,
            hasFailure: true,
          }),
        }),
      },
      {
        phase: 'end',
        name: 'call_model',
        payload: {
          status: 'completed',
          updateKeys: ['graphTrace', 'responseText'],
          emittedFailure: false,
          emittedValidationError: false,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(privateValue);
  });

  it('traces conditional destinations without serializing route state', async () => {
    const events: TraceEvent[] = [];
    const route = traceAgentGraphRoute(
      'record_provider_retry',
      () => 'call_model',
    );
    const state = {
      ...privateState(),
      graphTrace: traceRuntime(events).turnTrace,
    } as KfcAgentStateValue;

    await expect(route(state)).resolves.toBe('call_model');

    expect(events).toEqual([
      {
        phase: 'start',
        name: 'route:record_provider_retry',
        payload: expect.objectContaining({
          inputs: expect.objectContaining({
            sourceNode: 'record_provider_retry',
            providerRetries: 1,
          }),
        }),
      },
      {
        phase: 'end',
        name: 'route:record_provider_retry',
        payload: { destination: 'call_model' },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(privateValue);
  });

  it('wraps every declared node and route name from exhaustive maps', async () => {
    const events: TraceEvent[] = [];
    const runtime = traceRuntime(events);
    const names = ['load_context', 'call_model'] as const;
    const nodes = traceAgentGraphNodes(
      names,
      {
        load_context: () => ({}),
        call_model: () => ({}),
      },
      async () => runtime,
    );
    const routes = traceAgentGraphRoutes(
      names,
      {
        load_context: () => 'call_model',
        call_model: () => 'persist_and_project',
      },
    );
    const state = {
      ...privateState(),
      graphTrace: runtime.turnTrace,
    } as KfcAgentStateValue;

    await nodes.call_model(state, graphRuntime);
    await routes.call_model(state);

    expect(Object.keys(nodes)).toEqual(names);
    expect(Object.keys(routes)).toEqual(names);
    expect(events.filter(({ phase }) => phase === 'start').map(
      ({ name }) => name,
    )).toEqual(['call_model', 'route:call_model']);
  });

  it('replaces thrown application details with a constant trace failure', async () => {
    const events: TraceEvent[] = [];
    const node = traceAgentGraphNode(
      'load_context',
      async () => {
        throw new Error(privateValue);
      },
      async () => traceRuntime(events),
    );

    await expect(node(
      privateState(),
      graphRuntime,
    )).rejects.toThrow(privateValue);

    expect(events.at(-1)).toEqual({
      phase: 'fail',
      name: 'load_context',
      payload: 'agent_graph_node_failed_closed',
    });
    expect(JSON.stringify(events)).not.toContain(privateValue);
  });
});
