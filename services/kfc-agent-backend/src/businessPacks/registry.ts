import type {
  AgentTurnInput,
  AgentTurnOutput,
  VerifiedStateSnapshot,
} from '../agent/agentTurn.js';
import { createBusinessPackRegistry } from '../runtime/businessPack.js';
import {
  KFC_VIETNAM_PACK_REF,
  kfcVietnamPack,
} from './kfcVietnam/kfcVietnamPack.js';

export const businessPackRegistry = createBusinessPackRegistry<
  AgentTurnInput,
  AgentTurnOutput,
  Partial<VerifiedStateSnapshot>
>([kfcVietnamPack]);

/**
 * A server-created capability. Public request, model, and corpus data never
 * select or construct this binding.
 */
export const kfcVietnamPackBinding =
  businessPackRegistry.createTrustedBinding(KFC_VIETNAM_PACK_REF);
