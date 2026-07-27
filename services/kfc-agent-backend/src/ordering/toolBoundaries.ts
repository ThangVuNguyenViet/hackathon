import type { ToolName } from './types.js';

export type ToolBoundary =
  | 'catalog'
  | 'pos'
  | 'recommendation'
  | 'store_routing'
  | 'fulfillment'
  | 'promotion'
  | 'membership'
  | 'customer'
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
  recommendStarter: 'recommendation',
  recommendModifierUpsell: 'recommendation',
  recommendSmartCrossSell: 'recommendation',
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
  getSavedAddresses: 'customer',
  getRecentOrder: 'customer',
  getFavoriteItems: 'customer',
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
  resolveHandoff: 'handoff',
};

export function getToolBoundary(toolName: ToolName): ToolBoundary {
  return toolBoundaries[toolName];
}
