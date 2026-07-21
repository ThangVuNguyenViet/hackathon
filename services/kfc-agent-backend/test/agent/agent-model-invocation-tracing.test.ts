import {
  AIMessage,
  HumanMessage,
} from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import {
  invokeAgentModel,
} from '../../src/agent/agentModelInvocation.js';
import type {
  SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import type {
  AgentTurnInput,
} from '../../src/graph/agentTurnState.js';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';

type InvocationModel =
  Parameters<typeof invokeAgentModel>[0]['model'];

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

function runtime(turnTrace: AgentTraceSpan): SingleAgentRuntimeContext {
  const controller = new AbortController();
  return {
    turnInput: {} as AgentTurnInput,
    turnTrace,
    externalCallContext: {
      deadlineAt: Date.now() + 10_000,
      signal: controller.signal,
    },
    abortExternalCalls: (reason) => controller.abort(reason),
    disposeExternalCalls: () => undefined,
  };
}

function modelReturning(response: unknown): InvocationModel {
  return {
    invoke: vi.fn(async () => response),
  } as unknown as InvocationModel;
}

function modelThrowing(error: unknown): InvocationModel {
  return {
    invoke: vi.fn(async () => {
      throw error;
    }),
  } as unknown as InvocationModel;
}

function invocationState(providerAttempts = 0) {
  return {
    providerAttempts,
    providerAttemptEvidence: [],
    turnDeadlineAt: Date.now() + 10_000,
  };
}

const privateCustomerContent =
  'PRIVATE-CUSTOMER-CONTENT-MUST-NEVER-ENTER-TRACE';
const privateToolName = 'privateToolNameMustNeverEnterTrace';

describe('agent model invocation tracing', () => {
  it('emits a separate privacy-safe llm span for a successful attempt', async () => {
    const events: TraceEvent[] = [];
    const response = new AIMessage({
      content: privateCustomerContent,
      tool_calls: [{
        id: 'private-tool-call-id',
        name: privateToolName,
        args: {
          phone: privateCustomerContent,
        },
      }],
    });

    const result = await invokeAgentModel({
      model: modelReturning(response),
      messages: [new HumanMessage(privateCustomerContent)],
      observation: { kind: 'planning' },
      runtime: runtime(new CaptureSpan('agent_turn', events)),
      state: invocationState(),
    });

    expect(result).toMatchObject({
      providerAttempts: 1,
      providerAttemptEvidence: [{
        attempt: 1,
        outcome: 'success',
        purpose: 'agent_decision',
      }],
    });
    expect(events).toEqual([
      {
        phase: 'start',
        name: 'agent_model_attempt',
        payload: {
          name: 'agent_model_attempt',
          runType: 'llm',
          inputs: {
            attempt: 1,
            purpose: 'agent_decision',
          },
          metadata: {},
          tags: ['agent-model-attempt'],
        },
      },
      {
        phase: 'end',
        name: 'agent_model_attempt',
        payload: {
          attempt: 1,
          purpose: 'agent_decision',
          outcome: 'success',
          toolCallCount: 1,
        },
      },
    ]);
    const serializedTrace = JSON.stringify(events);
    expect(serializedTrace).not.toContain(privateCustomerContent);
    expect(serializedTrace).not.toContain(privateToolName);
    expect(serializedTrace).not.toContain('private-tool-call-id');
  });

  it('closes invalid-response and retry attempts with bounded outcomes', async () => {
    const events: TraceEvent[] = [];
    const turnTrace = new CaptureSpan('agent_turn', events);
    const invalid = await invokeAgentModel({
      model: modelReturning(new HumanMessage(privateCustomerContent)),
      messages: [],
      observation: { kind: 'response_composition' },
      runtime: runtime(turnTrace),
      state: invocationState(),
    });
    const providerError = Object.assign(
      new Error(privateCustomerContent),
      { name: 'RequestError', statusCode: 400 },
    );
    const failedRetry = await invokeAgentModel({
      model: modelThrowing(providerError),
      messages: [],
      observation: { kind: 'planning' },
      runtime: runtime(turnTrace),
      state: invocationState(1),
    });

    expect(invalid).toMatchObject({
      providerAttempts: 1,
      failure: 'agent_model_response_invalid',
    });
    expect(failedRetry).toMatchObject({
      providerAttempts: 2,
      providerFailure: {
        errorClass: 'client_error',
        retryable: false,
      },
      providerFailureDiagnostic: {
        stage: 'model_invoke',
        httpStatus: 400,
        errorType: 'request_error',
      },
    });
    expect(events.filter(({ phase }) => phase === 'end')).toEqual([
      {
        phase: 'end',
        name: 'agent_model_attempt',
        payload: {
          attempt: 1,
          purpose: 'response_composition',
          outcome: 'invalid_response',
          toolCallCount: 0,
        },
      },
      {
        phase: 'end',
        name: 'agent_model_attempt',
        payload: {
          attempt: 2,
          purpose: 'agent_decision',
          outcome: 'error',
          errorClass: 'client_error',
          retryable: false,
          diagnostic: {
            stage: 'model_invoke',
            httpStatus: 400,
            errorType: 'request_error',
          },
          toolCallCount: 0,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(privateCustomerContent);
  });

  it.each(['start', 'end'] as const)(
    'does not alter application behavior when trace %s fails',
    async (failurePoint) => {
      const model = modelReturning(new AIMessage('safe response'));
      const child: AgentTraceSpan = {
        async startSpan() {
          return this;
        },
        async end() {
          if (failurePoint === 'end') {
            throw new Error(privateCustomerContent);
          }
        },
        async fail() {
          throw new Error(privateCustomerContent);
        },
      };
      const turnTrace: AgentTraceSpan = {
        async startSpan() {
          if (failurePoint === 'start') {
            throw new Error(privateCustomerContent);
          }
          return child;
        },
        async end() {},
        async fail() {},
      };

      await expect(invokeAgentModel({
        model,
        messages: [],
        observation: { kind: 'planning' },
        runtime: runtime(turnTrace),
        state: invocationState(),
      })).resolves.toMatchObject({
        providerAttempts: 1,
        providerAttemptEvidence: [{
          attempt: 1,
          outcome: 'success',
          purpose: 'agent_decision',
        }],
      });
      expect(model.invoke).toHaveBeenCalledOnce();
    },
  );
});
