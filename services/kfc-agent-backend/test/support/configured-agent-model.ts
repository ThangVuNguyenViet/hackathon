import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createConfiguredAgentModelBinding,
  resolveAgentModelProfile,
  type AgentModelCandidateId,
  type ConfiguredAgentModelBinding,
} from '../../src/config/agentModelProfile.js';

export function configuredTestAgent(
  model: BaseChatModel,
  candidateId: AgentModelCandidateId = 'openai-gpt-4.1-mini',
): ConfiguredAgentModelBinding {
  return createConfiguredAgentModelBinding({
    profile: resolveAgentModelProfile({ candidateId }),
    model,
  });
}
