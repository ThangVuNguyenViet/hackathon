import type { Address, Cart, MenuItem, Order, ToolResult } from '../domain/types.js';

export type FixtureMode = 'public_crawl_seed' | 'authenticated_chrome_seed' | 'mock_external_state' | 'test_only';
export type Disposition = 'pickup' | 'delivery';
export type FulfillmentMethod = 'pickup' | 'delivery';
export type ContentKind = 'promotion' | 'news' | 'allergen' | 'policy';

export interface SourceProvenance {
  fixtureMode: FixtureMode;
  sourceFile: string;
  sourceUrl?: string;
  sourceApi?: string;
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  modifierId: string;
  modifierName: string;
  quantity: number;
  priceDeltaVnd: number;
}

export interface CartMutationInput {
  itemCode: string;
  quantity: number;
  modifiers?: SelectedModifier[];
}

export interface ItemAvailabilityResult {
  ok: boolean;
  checkedItemIds: string[];
  unavailableItemIds: string[];
  blockedTimeslotItemIds: string[];
  source: SourceProvenance;
}

export interface FulfillmentState {
  method: FulfillmentMethod;
  disposition: Disposition;
  storeId: string;
  storeName: string;
  feeVnd: number;
  etaMinutes: number;
  availability: ItemAvailabilityResult;
}

export interface PromotionValidationResult {
  ok: boolean;
  reason:
    | 'validated'
    | 'not_found'
    | 'minimum_not_met'
    | 'expired'
    | 'public_code_not_exposed'
    | 'not_redeemable_publicly';
  publicCode: string;
  discountVnd: number;
  source: SourceProvenance;
}

export interface PromotionContext {
  matchedOfferIds: string[];
  validation?: PromotionValidationResult;
  caveats: string[];
}

export interface MembershipActionResult {
  actionId: string;
  status: 'previewed' | 'completed';
  requiresUserConfirmation: boolean;
  targetId: string;
  message: string;
  source: SourceProvenance;
}

export interface ContentEvidence {
  kind: ContentKind;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceFile: string;
}

export interface CustomerContext {
  savedAddresses: Address[];
  recentOrders: Order[];
  favorites: MenuItem[];
  loyaltyPoints?: number;
}

export interface PaymentAttempt {
  method?: PaymentLinkMethod;
  status: 'pending' | 'paid' | 'failed';
  paymentUrl?: string;
}

export type PaymentLinkMethod = 'momo' | 'zalopay' | 'card' | 'cod';

export interface InvoiceRequest {
  companyName: string;
  taxCode: string;
  email: string;
}

export interface HandoffState {
  escalationId: string;
  reasons: string[];
}

export const TOOL_NAMES = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'previewCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'getMembershipProfile',
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'listMembershipTools',
  'listPaymentMethods',
  'acquireVoucher',
  'redeemReward',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'previewOrder',
  'placeOrder',
  'getOrderStatus',
  'createPaymentLink',
  'checkPaymentStatus',
  'collectInvoice',
  'handoff',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCallRequest {
  toolName: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult extends ToolResult<unknown> {
  toolName: ToolName;
  provenance: SourceProvenance[];
}

export interface ToolTraceEntry {
  toolName: ToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
  provenance: SourceProvenance[];
}

export interface AgentEntities {
  itemText?: string;
  itemCodes?: string[];
  quantities?: Record<string, number>;
  addressText?: string;
  fulfillmentMethod?: FulfillmentMethod;
  voucherText?: string;
  paymentMethod?: PaymentLinkMethod;
  orderId?: string;
  invoice?: Partial<InvoiceRequest>;
}

export interface CartWithModifiers extends Cart {
  selectedModifiers?: Record<string, SelectedModifier[]>;
}
