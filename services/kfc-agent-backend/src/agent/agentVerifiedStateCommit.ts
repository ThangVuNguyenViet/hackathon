import type { AgentGraphState } from '../graph/state.js';
import {
  verifiedStateSnapshotSourceType,
} from '../graph/turnSupport.js';
import {
  buildVerifiedStateSnapshot,
  persistVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import type {
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export async function persistVerifiedStateForCurrentRun(input: {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
}): Promise<void> {
  const { runGuard } = input.runtime.turnInput;
  if (!runGuard) {
    await persistVerifiedStateSnapshot(
      input.runtime.turnInput.store,
      input.state,
    );
    return;
  }
  if (!runGuard.commitFence) {
    throw new Error('agent_run_commit_fence_missing');
  }
  const authenticationEvidence =
    input.runtime.turnInput.accessContext?.authenticationEvidence;
  const committed =
    await input.runtime.turnInput.store.appendEventIfRunCurrent({
      sessionId: input.state.sessionId,
      sourceType: verifiedStateSnapshotSourceType,
      payload: {
        verifiedState: buildVerifiedStateSnapshot(input.state),
      },
      fence: runGuard.commitFence,
      ...(authenticationEvidence?.state === 'verified'
        ? { notAfter: authenticationEvidence.expiresAt }
        : {}),
    });
  if (committed.status === 'committed') return;
  input.runtime.abortExternalCalls(new DOMException(
    'Customer run was superseded before verified-state commit',
    'AbortError',
  ));
  throw new Error('customer_run_cancelled');
}
