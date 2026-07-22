import type { ToolName } from '../ordering/types.js';
import {
  requiredDomainState,
} from './agentStateGraphContracts.js';
import type {
  KfcAgentStateValue,
} from './agentStateSchema.js';
import type {
  createAgentToolProfileResolver,
} from './agentToolProfile.js';
import {
  publicationAuthority,
} from './agentPublicationRuntime.js';
import type {
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export function activeAgentToolNames(input: {
  state: KfcAgentStateValue;
  runtime: SingleAgentRuntimeContext;
  resolveToolProfile: ReturnType<
    typeof createAgentToolProfileResolver
  >;
}): readonly ToolName[] {
  const turnInput = input.runtime.turnInput;
  return input.resolveToolProfile({
    lifecycle: requiredDomainState(input.state),
    accessContext: turnInput.accessContext,
    guestCheckoutAuthority: turnInput.guestCheckoutAuthority,
    verifiedGuestAuthority:
      turnInput.confirmationResume?.verifiedGuestAuthority,
    runFence: turnInput.runGuard?.commitFence,
    externalMessageId: turnInput.externalMessageId,
    confirmationResume: turnInput.confirmationResume !== undefined,
    currentTurn: {
      authority: publicationAuthority(input.state),
      executions: input.state.graphExecutedToolResults,
    },
    providerCapabilities: {
      handoffResolutionSupported:
        turnInput.clients.providerCapabilities?.handoffResolution === true,
    },
    now: Date.now(),
  });
}
