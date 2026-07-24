import type { AgentTurnInput, AgentTurnOutput } from '../agent/agentTurn.js';
import { createBusinessPackRegistry } from '../runtime/businessPack.js';
import {
  KFC_VIETNAM_PACK_REF,
  kfcVietnamPack,
} from './kfcVietnam/kfcVietnamPack.js';
import {
  PVCFC_CUSTOMER_SERVICE_PACK_REF,
  pvcfcCustomerServicePack,
} from './pvcfcCustomerService/pvcfcCustomerServicePack.js';
import { runSemanticKernel } from '../runtime/kernel.js';

export const businessPackRegistry = createBusinessPackRegistry<
  AgentTurnInput,
  AgentTurnOutput,
  unknown
>([kfcVietnamPack, pvcfcCustomerServicePack]);

/**
 * A server-created capability. Public request, model, and corpus data never
 * select or construct this binding.
 */
export const kfcVietnamPackBinding =
  businessPackRegistry.createTrustedBinding(KFC_VIETNAM_PACK_REF);

export const pvcfcCustomerServicePackBinding =
  businessPackRegistry.createTrustedBinding(PVCFC_CUSTOMER_SERVICE_PACK_REF);

export function runPvcfcCustomerServiceTurn(
  input: AgentTurnInput,
): Promise<AgentTurnOutput> {
  return runSemanticKernel({
    registry: businessPackRegistry,
    binding: pvcfcCustomerServicePackBinding,
    packInput: input,
  });
}
