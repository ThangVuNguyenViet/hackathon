import type { Callbacks } from '@langchain/core/callbacks/manager';

export type AgentTraceRunType = 'chain' | 'llm' | 'tool';

export interface AgentTraceSpanInput {
  name: string;
  runType: AgentTraceRunType;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface AgentTraceSpan {
  startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan>;
  end(outputs?: Record<string, unknown>): Promise<void>;
  fail(error: unknown): Promise<void>;
  langchainCallbacks?(): Promise<Callbacks | undefined>;
  withActiveTrace?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AgentTracer {
  startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan>;
  flush(): Promise<void>;
}

const agentTraceFlushTaskMarker = Symbol('agentTraceFlushTask');

type AgentTraceFlushTask = (() => Promise<void>) & {
  [agentTraceFlushTaskMarker]: true;
};

export function createAgentTraceFlushTask(
  tracer: AgentTracer,
): AgentTraceFlushTask {
  return Object.assign(() => tracer.flush(), {
    [agentTraceFlushTaskMarker]: true as const,
  });
}

export function isAgentTraceFlushTask(
  task: () => Promise<void>,
): task is AgentTraceFlushTask {
  return agentTraceFlushTaskMarker in task;
}

export type AgentTraceDiagnostic =
  | 'agent_trace_start_failed'
  | 'agent_trace_span_start_failed'
  | 'agent_trace_end_failed'
  | 'agent_trace_fail_failed'
  | 'agent_trace_callbacks_failed'
  | 'agent_trace_active_context_failed'
  | 'agent_trace_flush_failed';

const noopSpan: AgentTraceSpan = {
  async startSpan() {
    return noopSpan;
  },
  async end() {
    return undefined;
  },
  async fail() {
    return undefined;
  },
  async langchainCallbacks() {
    return undefined;
  },
  async withActiveTrace(fn) {
    return fn();
  },
};

export function createNoopAgentTracer(): AgentTracer {
  return {
    async startTurn() {
      return noopSpan;
    },
    async flush() {
      return undefined;
    },
  };
}

function createSafeSpan(
  delegate: AgentTraceSpan,
  onDiagnostic: (code: AgentTraceDiagnostic, error: unknown) => void,
): AgentTraceSpan {
  const safeSpan: AgentTraceSpan = {
    async startSpan(input) {
      try {
        return createSafeSpan(await delegate.startSpan(input), onDiagnostic);
      } catch (error) {
        onDiagnostic('agent_trace_span_start_failed', error);
        return noopSpan;
      }
    },
    async end(outputs) {
      try {
        await delegate.end(outputs);
      } catch (error) {
        onDiagnostic('agent_trace_end_failed', error);
      }
    },
    async fail(error) {
      try {
        await delegate.fail(error);
      } catch (traceError) {
        onDiagnostic('agent_trace_fail_failed', traceError);
      }
    },
  };

  const delegateCallbacks = delegate.langchainCallbacks;
  if (delegateCallbacks) {
    safeSpan.langchainCallbacks = async () => {
      try {
        return await delegateCallbacks.call(delegate);
      } catch (error) {
        onDiagnostic('agent_trace_callbacks_failed', error);
        return undefined;
      }
    };
  }

  const delegateWithActiveTrace = delegate.withActiveTrace;
  if (delegateWithActiveTrace) {
    safeSpan.withActiveTrace = async <T>(fn: () => Promise<T>): Promise<T> => {
      let applicationPromise: Promise<T> | undefined;
      const invokeApplication = (): Promise<T> => {
        applicationPromise ??= Promise.resolve().then(fn);
        return applicationPromise;
      };
      let traceFailed = false;
      let traceError: unknown;
      try {
        await delegate.withActiveTrace!(invokeApplication);
      } catch (error) {
        traceFailed = true;
        traceError = error;
      }
      if (!applicationPromise) {
        onDiagnostic(
          'agent_trace_active_context_failed',
          traceFailed
            ? traceError
            : new Error('agent_trace_active_context_callback_not_invoked'),
        );
        return invokeApplication();
      }
      try {
        const result = await applicationPromise;
        if (traceFailed) {
          onDiagnostic('agent_trace_active_context_failed', traceError);
        }
        return result;
      } catch (applicationError) {
        if (traceFailed && traceError !== applicationError) {
          onDiagnostic('agent_trace_active_context_failed', traceError);
        }
        throw applicationError;
      }
    };
  }

  return safeSpan;
}

export function createSafeAgentTracer(
  delegate: AgentTracer,
  onDiagnostic: (code: AgentTraceDiagnostic, error: unknown) => void = () =>
    undefined,
): AgentTracer {
  return {
    async startTurn(input) {
      try {
        return createSafeSpan(await delegate.startTurn(input), onDiagnostic);
      } catch (error) {
        onDiagnostic('agent_trace_start_failed', error);
        return noopSpan;
      }
    },
    async flush() {
      try {
        await delegate.flush();
      } catch (error) {
        onDiagnostic('agent_trace_flush_failed', error);
      }
    },
  };
}
