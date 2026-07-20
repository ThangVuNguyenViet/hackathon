import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentModelIdentity } from '../../src/config/agentModelProfile.js';

const agentIdentity: AgentModelIdentity = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  profile: 'openai-gpt-4.1-mini',
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
