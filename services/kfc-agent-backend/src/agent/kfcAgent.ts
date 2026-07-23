import {
  businessPackRegistry,
  kfcVietnamPackBinding,
} from '../businessPacks/registry.js';
import {
  KFC_AGENT_INSTRUCTIONS,
  KFC_VIETNAM_PACK_REF,
} from '../businessPacks/kfcVietnam/kfcVietnamPack.js';
import { runSemanticKernel } from '../runtime/kernel.js';
import type { AgentTurnInput, AgentTurnOutput } from './agentTurn.js';

export { KFC_AGENT_INSTRUCTIONS, KFC_VIETNAM_PACK_REF };

/**
 * Compatibility facade for existing KFC callers. The trusted pack binding is
 * selected by server code here, never from request, model, or corpus input.
 */
export function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  return runSemanticKernel({
    registry: businessPackRegistry,
    binding: kfcVietnamPackBinding,
    packInput: input,
  });
}
