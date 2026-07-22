import type { AgentGraphState } from '../graph/state.js';
import { stateAfterPaymentApprovalRejection } from '../ordering/paymentMethodAuthority.js';
import { persistVerifiedStateForCurrentRun } from './agentVerifiedStateCommit.js';
import type { SingleAgentRuntimeContext } from './singleAgentRuntime.js';
import { runtimeDispatchFailure } from './singleAgentRuntime.js';

/**
 * Durably commits authenticated rejection state before response composition.
 * A later model/publication-validation failure therefore cannot restore the
 * pause-time payment selection from the previous verified-state snapshot.
 */
export async function persistAuthenticatedApprovalRejection(input: {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  call: { toolName: string };
  hasStructuredAction: boolean;
}): Promise<AgentGraphState> {
  const before = await runtimeDispatchFailure(input.runtime);
  if (before) throw new Error(before);
  const rejectedState = stateAfterPaymentApprovalRejection(
    input.state,
    input.call,
    input.hasStructuredAction,
  );
  await persistVerifiedStateForCurrentRun({
    runtime: input.runtime,
    state: rejectedState,
  });
  const after = await runtimeDispatchFailure(input.runtime);
  if (after) throw new Error(after);
  input.runtime.state = rejectedState;
  return rejectedState;
}
