import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentModelIdentity } from '../../src/config/agentModelProfile.js';

const agentIdentity: AgentModelIdentity = {
  provider: 'openai',
  model: 'gpt-5-mini-2025-08-07',
  profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
};

export function testAgent(
  model: BaseChatModel,
): {
  agent: {
    model: BaseChatModel;
    identity: AgentModelIdentity;
  };
} {
  return {
    agent: { model, identity: agentIdentity },
  };
}
