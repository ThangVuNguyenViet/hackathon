const traceContextAuthority = Symbol('kfc_agent_trace_context_authority');

const opaqueCorrelationIdPattern =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export interface AgentTraceContext {
  readonly scenarioId: string;
  readonly probeRunId?: string;
  readonly [traceContextAuthority]: true;
}

function parseOpaqueCorrelationId(value: string, label: string): string {
  if (!opaqueCorrelationIdPattern.test(value)) {
    throw new Error(`invalid_${label}`);
  }
  return value;
}

/**
 * Issues server-owned trace correlation for internal scenario/probe runners.
 *
 * Public request metadata must never be passed to this factory.
 */
export function createAgentTraceContext(input: {
  scenarioId: string;
  probeRunId?: string;
}): AgentTraceContext {
  return Object.freeze({
    scenarioId: parseOpaqueCorrelationId(input.scenarioId, 'trace_scenario_id'),
    ...(input.probeRunId
      ? {
          probeRunId: parseOpaqueCorrelationId(
            input.probeRunId,
            'trace_probe_run_id',
          ),
        }
      : {}),
    [traceContextAuthority]: true as const,
  });
}

function isAgentTraceContext(value: unknown): value is AgentTraceContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AgentTraceContext>;
  return (
    candidate[traceContextAuthority] === true &&
    typeof candidate.scenarioId === 'string' &&
    opaqueCorrelationIdPattern.test(candidate.scenarioId) &&
    (candidate.probeRunId === undefined ||
      (typeof candidate.probeRunId === 'string' &&
        opaqueCorrelationIdPattern.test(candidate.probeRunId)))
  );
}

export function agentTraceScenarioId(value: unknown): string | undefined {
  return isAgentTraceContext(value) ? value.scenarioId : undefined;
}

export function agentTraceProbeRunId(value: unknown): string | undefined {
  return isAgentTraceContext(value) ? value.probeRunId : undefined;
}
