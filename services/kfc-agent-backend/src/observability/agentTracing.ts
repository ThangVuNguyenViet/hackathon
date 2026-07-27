export type AgentTraceRunType = 'chain' | 'llm' | 'tool';
export type AgentTraceCategory =
  | 'agent_loop'
  | 'graph_node'
  | 'model'
  | 'tool'
  | 'approval'
  | 'retry'
  | 'verified_state'
  | 'genui_projection';

export type AgentTraceRequirement = 'required' | 'optional' | 'forbidden';

export interface AgentTraceApplicability {
  tool: AgentTraceRequirement;
  approval: AgentTraceRequirement;
  verifiedState: AgentTraceRequirement;
  genui: AgentTraceRequirement;
}

export interface AgentTraceSpanInput {
  name: string;
  runType: AgentTraceRunType;
  category?: AgentTraceCategory;
  applicability?: AgentTraceApplicability;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface AgentTraceSpan {
  startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan>;
  end(outputs?: Record<string, unknown>): Promise<void>;
  fail(error: unknown): Promise<void>;
}

export interface AgentTracer {
  startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan>;
  flush(): Promise<void>;
}

export type AgentTraceDiagnostic =
  | 'agent_trace_start_failed'
  | 'agent_trace_span_start_failed'
  | 'agent_trace_end_failed'
  | 'agent_trace_fail_failed'
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
  return {
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
}

export function createSafeAgentTracer(
  delegate: AgentTracer,
  onDiagnostic: (code: AgentTraceDiagnostic, error: unknown) => void = () => undefined,
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
