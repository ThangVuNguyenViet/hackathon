import type {
  SessionControl,
  TransitionSessionAuthorityInput,
  TransitionSessionAuthorityResult,
} from './contracts.js';

export function effectiveMemorySessionControl(
  controls: ReadonlyMap<string, SessionControl>,
  sessionId: string,
): SessionControl {
  return (
    controls.get(sessionId) ?? {
      sessionId,
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 0,
      updatedAt: new Date().toISOString(),
    }
  );
}

export function captureActiveMemorySessionAuthority(
  controls: ReadonlyMap<string, SessionControl>,
  sessionId: string,
): number | undefined {
  const control = effectiveMemorySessionControl(controls, sessionId);
  return control.agentMode === 'ai_active'
    ? control.sessionAuthorityGeneration
    : undefined;
}

export function transitionMemorySessionAuthority(input: {
  controls: Map<string, SessionControl>;
  operation: TransitionSessionAuthorityInput;
}): TransitionSessionAuthorityResult {
  const current = effectiveMemorySessionControl(
    input.controls,
    input.operation.sessionId,
  );
  if (
    current.agentMode === input.operation.agentMode &&
    current.assignedAgentId === input.operation.assignedAgentId
  ) {
    return { status: 'unchanged', control: structuredClone(current) };
  }
  if (
    current.sessionAuthorityGeneration !== input.operation.expectedGeneration
  ) {
    return { status: 'stale', control: structuredClone(current) };
  }
  const control: SessionControl = {
    sessionId: input.operation.sessionId,
    agentMode: input.operation.agentMode,
    assignedAgentId: input.operation.assignedAgentId,
    sessionAuthorityGeneration: current.sessionAuthorityGeneration + 1,
    updatedAt: input.operation.updatedAt ?? new Date().toISOString(),
  };
  input.controls.set(control.sessionId, control);
  return { status: 'transitioned', control: structuredClone(control) };
}
