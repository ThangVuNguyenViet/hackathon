import type { AgentModelIdentity } from '../config/agentModelProfile.js';
import type { ConversationStore } from './contracts.js';

export async function bindConfiguredSessionAgentModel(input: {
  store: ConversationStore;
  sessionId: string;
  identity: AgentModelIdentity;
}): Promise<AgentModelIdentity> {
  const persisted = await input.store.bindSessionAgentModel({
    sessionId: input.sessionId,
    binding: input.identity,
  });
  if (!sameIdentity(persisted, input.identity)) {
    throw new Error('session_agent_model_binding_mismatch');
  }
  return Object.freeze({ ...input.identity });
}

function sameIdentity(
  left: Readonly<{
    candidateId: string;
    provider: string;
    model: string;
    profile: string;
    transport: string;
  }>,
  right: AgentModelIdentity,
): boolean {
  return (
    left.candidateId === right.candidateId &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.profile === right.profile &&
    left.transport === right.transport
  );
}
