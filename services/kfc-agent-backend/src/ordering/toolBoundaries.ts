import type { CustomerAccessScope } from '../domain/types.js';
import type { CommerceApprovalCapability, ToolName } from './types.js';

export type ToolBoundary =
  | 'catalog'
  | 'pos'
  | 'store_routing'
  | 'fulfillment'
  | 'promotion'
  | 'membership'
  | 'content'
  | 'invoice'
  | 'oms'
  | 'payment'
  | 'handoff';

export const toolBoundaries: Record<ToolName, ToolBoundary> = {
  searchMenu: 'catalog',
  getItemDetails: 'catalog',
  getModifierOptions: 'catalog',
  updateCart: 'pos',
  previewCart: 'pos',
  recommendAddOns: 'pos',
  findStores: 'store_routing',
  checkStoreAvailability: 'fulfillment',
  quoteFulfillment: 'fulfillment',
  searchPromotions: 'promotion',
  explainPromotion: 'promotion',
  validateVoucher: 'promotion',
  getMembershipProfile: 'membership',
  listMembershipRewards: 'membership',
  listMembershipWallet: 'membership',
  getMembershipPointHistory: 'membership',
  listMembershipTools: 'membership',
  listPaymentMethods: 'payment',
  acquireVoucher: 'membership',
  redeemReward: 'membership',
  searchContentPolicy: 'content',
  answerAllergenQuestion: 'content',
  collectInvoice: 'invoice',
  previewOrder: 'oms',
  placeOrder: 'oms',
  getOrderStatus: 'oms',
  createPaymentLink: 'payment',
  checkPaymentStatus: 'payment',
  handoff: 'handoff',
};

export function getToolBoundary(toolName: ToolName): ToolBoundary {
  return toolBoundaries[toolName];
}

export const approvalCapabilityScopes: Record<CommerceApprovalCapability, CustomerAccessScope> = {
  placeOrder: 'order:write',
  createPaymentLink: 'payment:write',
  acquireVoucher: 'membership:write',
  redeemReward: 'membership:write',
  handoff: 'handoff:write',
};
