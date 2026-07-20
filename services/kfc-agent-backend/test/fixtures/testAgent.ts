import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { fakeModel } from '@langchain/core/testing';
import type { AgentModelIdentity } from '../../src/config/agentModelProfile.js';
import { groundedResponseClaims } from './groundedResponse.js';

const agentIdentity: AgentModelIdentity = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  profile: 'openai-gpt-4.1-mini',
};

const responseVerifierIdentity: AgentModelIdentity = {
  provider: 'google',
  model: 'gemini-3.1-flash-lite',
  profile: 'google-gemini-3.1-flash-lite-thinking-low',
};

export function testAgent(
  model: BaseChatModel,
  responseVerifierModel: BaseChatModel = fakeModel().structuredResponse(
    groundedResponseClaims(),
  ),
): {
  agent: {
    model: BaseChatModel;
    identity: AgentModelIdentity;
  };
  responseVerifier: {
    model: BaseChatModel;
    identity: AgentModelIdentity;
  };
} {
  if (model === responseVerifierModel) {
    throw new Error('Test response verifier must be independent from the agent model');
  }
  return {
    agent: { model, identity: agentIdentity },
    responseVerifier: {
      model: responseVerifierModel,
      identity: responseVerifierIdentity,
    },
  };
}
