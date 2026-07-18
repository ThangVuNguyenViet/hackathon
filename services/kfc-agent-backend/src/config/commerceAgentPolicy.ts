import type { ToolName } from '../ordering/types.js';

export interface CommerceAgentPolicy {
  largeOrderQuantityThreshold: number;
  maxSemanticReplans: 0 | 1;
  confirmationRequiredTools: readonly ToolName[];
  stateRestrictedTools: readonly ToolName[];
  routerFailure: 'state_scope_or_clarify';
}

export const defaultCommerceAgentPolicy: CommerceAgentPolicy = {
  largeOrderQuantityThreshold: 100,
  maxSemanticReplans: 1,
  confirmationRequiredTools: ['placeOrder', 'acquireVoucher', 'redeemReward'],
  stateRestrictedTools: [
    'quoteFulfillment',
    'checkStoreAvailability',
    'previewOrder',
    'placeOrder',
    'getOrderStatus',
    'createPaymentLink',
    'checkPaymentStatus',
  ],
  routerFailure: 'state_scope_or_clarify',
};
