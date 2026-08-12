import type {
  AgentTurnInput,
} from '../businesses/kfc/turnContracts.js';

export async function persistAgentFailedClosedEvent(input: {
  turnInput: AgentTurnInput;
  payload: Record<string, unknown>;
}): Promise<'committed' | 'stale' | 'skipped_unfenced'> {
  const { runGuard } = input.turnInput;
  if (!runGuard) {
    await input.turnInput.store.appendEvent(
      input.turnInput.sessionId,
      'agent:failed_closed',
      input.payload,
    );
    return 'committed';
  }
  if (!runGuard.commitFence) {
    // A guarded run without a durable owner token may fail closed in memory,
    // but it must not perform a check-then-write audit mutation.
    return 'skipped_unfenced';
  }
  const authenticationEvidence =
    input.turnInput.accessContext?.authenticationEvidence;
  const result =
    await input.turnInput.store.appendEventIfRunCurrent({
      sessionId: input.turnInput.sessionId,
      sourceType: 'agent:failed_closed',
      payload: input.payload,
      fence: runGuard.commitFence,
      ...(authenticationEvidence?.state === 'verified'
        ? { notAfter: authenticationEvidence.expiresAt }
        : {}),
    });
  return result.status;
}
