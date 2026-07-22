import { z } from 'zod';
import type { CustomerAccessScope } from '../domain/types.js';
import type { ToolName } from '../ordering/types.js';

export const responseClaimKindSchema = z.enum([
  'product',
  'modifier',
  'price',
  'promotion',
  'payment',
  'fulfillment',
  'address',
  'policy',
  'allergen',
  'membership',
  'source',
  'status',
  'delivery',
  'order_id',
]);

export type ResponseClaimKind = z.infer<typeof responseClaimKindSchema>;

export interface ResponseClaimEvidence {
  evidenceId: string;
  claimKinds: ResponseClaimKind[];
  value: unknown;
  officialSource: boolean;
}

interface ToolResponseEvidenceContract {
  claimKinds: readonly [ResponseClaimKind, ...ResponseClaimKind[]];
  requiredScopes: readonly CustomerAccessScope[];
  currentSessionCheckout?: boolean;
  privateData: boolean;
}

export interface ResolvedToolResponseEvidenceContract {
  claimKinds: [ResponseClaimKind, ...ResponseClaimKind[]];
  requiredScopes: CustomerAccessScope[];
  currentSessionCheckout: boolean;
  privateData: boolean;
}

const toolResponseEvidenceContracts = {
  searchMenu: {
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  getItemDetails: {
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  getModifierOptions: {
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  updateCart: {
    claimKinds: [
      'product',
      'modifier',
      'price',
      'promotion',
      'delivery',
      'status',
    ],
    requiredScopes: [],
    privateData: false,
  },
  previewCart: {
    claimKinds: [
      'product',
      'modifier',
      'price',
      'promotion',
      'delivery',
      'status',
    ],
    requiredScopes: [],
    privateData: false,
  },
  recommendAddOns: {
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  findStores: {
    claimKinds: ['fulfillment', 'address', 'source', 'status', 'delivery'],
    requiredScopes: [],
    privateData: false,
  },
  checkStoreAvailability: {
    claimKinds: ['fulfillment', 'address', 'source', 'status', 'delivery'],
    requiredScopes: [],
    privateData: false,
  },
  quoteFulfillment: {
    claimKinds: ['fulfillment', 'address', 'source', 'status', 'delivery'],
    requiredScopes: [],
    privateData: false,
  },
  searchPromotions: {
    claimKinds: ['promotion', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  explainPromotion: {
    claimKinds: ['promotion', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  validateVoucher: {
    claimKinds: ['promotion', 'price', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  getMembershipProfile: {
    claimKinds: ['membership', 'promotion', 'status', 'source'],
    requiredScopes: ['membership:read'],
    privateData: true,
  },
  listMembershipRewards: {
    claimKinds: ['membership', 'promotion', 'status', 'source'],
    requiredScopes: ['membership:read'],
    privateData: true,
  },
  listMembershipWallet: {
    claimKinds: ['membership', 'promotion', 'status', 'source'],
    requiredScopes: ['membership:read'],
    privateData: true,
  },
  getMembershipPointHistory: {
    claimKinds: ['membership', 'promotion', 'status', 'source'],
    requiredScopes: ['membership:read'],
    privateData: true,
  },
  listMembershipTools: {
    claimKinds: ['membership', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  listPaymentMethods: {
    claimKinds: ['payment', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  getSavedAddresses: {
    claimKinds: ['address', 'fulfillment', 'delivery'],
    requiredScopes: ['customer:read'],
    privateData: true,
  },
  getRecentOrder: {
    claimKinds: [
      'product',
      'modifier',
      'price',
      'payment',
      'status',
      'delivery',
      'order_id',
    ],
    requiredScopes: ['customer:read', 'order:read'],
    privateData: true,
  },
  getFavoriteItems: {
    claimKinds: ['product', 'modifier', 'price', 'source'],
    requiredScopes: ['customer:read'],
    privateData: true,
  },
  acquireVoucher: {
    claimKinds: ['membership', 'promotion', 'status'],
    requiredScopes: ['membership:write'],
    privateData: true,
  },
  redeemReward: {
    claimKinds: ['membership', 'promotion', 'status'],
    requiredScopes: ['membership:write'],
    privateData: true,
  },
  searchContentPolicy: {
    claimKinds: ['policy', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  answerAllergenQuestion: {
    claimKinds: ['allergen', 'source', 'status'],
    requiredScopes: [],
    privateData: false,
  },
  collectInvoice: {
    claimKinds: ['payment', 'status'],
    requiredScopes: [],
    privateData: true,
  },
  previewOrder: {
    claimKinds: [
      'product',
      'modifier',
      'price',
      'payment',
      'fulfillment',
      'status',
      'delivery',
      'order_id',
    ],
    requiredScopes: ['order:read'],
    currentSessionCheckout: true,
    privateData: true,
  },
  placeOrder: {
    claimKinds: [
      'product',
      'modifier',
      'price',
      'payment',
      'fulfillment',
      'status',
      'delivery',
      'order_id',
    ],
    requiredScopes: ['order:write'],
    currentSessionCheckout: true,
    privateData: true,
  },
  getOrderStatus: {
    claimKinds: ['payment', 'status', 'delivery', 'order_id'],
    requiredScopes: ['order:read'],
    privateData: true,
  },
  createPaymentLink: {
    claimKinds: ['payment', 'status', 'order_id'],
    requiredScopes: ['payment:write'],
    currentSessionCheckout: true,
    privateData: true,
  },
  checkPaymentStatus: {
    claimKinds: ['payment', 'status', 'order_id'],
    requiredScopes: ['payment:read'],
    privateData: true,
  },
  handoff: {
    claimKinds: ['status', 'delivery'],
    requiredScopes: [],
    privateData: false,
  },
  resolveHandoff: {
    claimKinds: ['status'],
    requiredScopes: [],
    privateData: false,
  },
} as const satisfies Record<ToolName, ToolResponseEvidenceContract>;

export function responseEvidenceContractForTool(
  toolName: ToolName,
): ResolvedToolResponseEvidenceContract {
  const contract = toolResponseEvidenceContracts[toolName];
  return {
    claimKinds: [...contract.claimKinds] as [
      ResponseClaimKind,
      ...ResponseClaimKind[],
    ],
    requiredScopes: [...contract.requiredScopes],
    currentSessionCheckout:
      'currentSessionCheckout' in contract &&
      contract.currentSessionCheckout === true,
    privateData: contract.privateData,
  };
}

export function isPrivateResponseEvidenceTool(toolName: ToolName): boolean {
  return toolResponseEvidenceContracts[toolName].privateData;
}
