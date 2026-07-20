import type { HandoffClient } from '../clients/interfaces.js';
import type { ProviderMutationReplayRegistry } from '../clients/providerMutationReplay.js';
import {
  mockFailure as fail,
  mockSuccess as ok,
} from './mockToolResults.js';

interface MockHandoff {
  sessionId: string;
  status: 'active' | 'resolved';
}

export function createMockHandoffClient(
  mutationReplay: ProviderMutationReplayRegistry,
): HandoffClient {
  let sequence = 0;
  const handoffs = new Map<string, MockHandoff>();

  return {
    async escalateToHuman(
      sessionId,
      reasons,
      _externalCallContext,
      mutationIdentity,
    ) {
      return mutationReplay.run(mutationIdentity, () => {
        sequence += 1;
        const escalationId =
          `handoff_${sessionId}_${sequence}_${reasons.join('_')}`;
        handoffs.set(escalationId, {
          sessionId,
          status: 'active',
        });
        return ok({ escalationId });
      });
    },
    async resolveEscalation(
      sessionId,
      escalationId,
      _externalCallContext,
      mutationIdentity,
    ) {
      return mutationReplay.run(mutationIdentity, () => {
        const handoff = handoffs.get(escalationId);
        if (!handoff || handoff.sessionId !== sessionId) {
          return fail(
            'handoff_not_found',
            'The active escalation does not belong to this session',
          );
        }
        if (handoff.status !== 'active') {
          return fail(
            'handoff_already_resolved',
            'The escalation is already resolved',
          );
        }
        handoff.status = 'resolved';
        return ok({
          escalationId,
          status: 'resolved',
        });
      });
    },
  };
}
