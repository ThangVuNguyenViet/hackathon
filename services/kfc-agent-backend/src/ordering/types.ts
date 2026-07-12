import type {
  Address,
  Cart,
  MenuItem,
  Order,
  ToolResult,
} from "../domain/types.js";
import type {
  GeneratedMembershipPointHistorySnapshot,
  GeneratedMembershipProfileSnapshot,
  GeneratedMembershipRewardOffer,
  GeneratedMembershipToolDefinition,
  GeneratedMembershipWalletVoucher,
  GeneratedMenuModifier,
  GeneratedPaymentMethod,
  GeneratedPromotionVoucherOffer,
} from '../fixtures/schema.js';

export type FixtureMode =
  | "public_crawl_seed"
  | "authenticated_chrome_seed"
  | "mock_external_state"
  | "test_only";
export type Disposition = "pickup" | "delivery";
export type FulfillmentMethod = "pickup" | "delivery";
export type ContentKind = "promotion" | "news" | "allergen" | "policy";

export interface SourceProvenance {
  fixtureMode: FixtureMode;
  sourceFile: string;
  sourceUrl?: string | undefined;
  sourceApi?: string | undefined;
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
  modifiers?: SelectedModifier[] | undefined;
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
    | "validated"
    | "not_found"
    | "minimum_not_met"
    | "expired"
    | "public_code_not_exposed"
    | "not_redeemable_publicly";
  publicCode: string;
  discountVnd: number;
  source: SourceProvenance;
}

export interface PromotionContext {
  matchedOfferIds: string[];
  validation?: PromotionValidationResult | undefined;
  caveats: string[];
}

export interface MembershipActionResult {
  actionId: string;
  status: "previewed" | "completed";
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
  loyaltyPoints?: number | undefined;
}

export interface PaymentAttempt {
  method?: PaymentLinkMethod | undefined;
  status: "pending" | "paid" | "failed";
  paymentUrl?: string | undefined;
}

export type PaymentLinkMethod = "momo" | "zalopay" | "card" | "cod";

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
  "searchMenu",
  "getItemDetails",
  "getModifierOptions",
  "updateCart",
  "previewCart",
  "recommendAddOns",
  "findStores",
  "checkStoreAvailability",
  "quoteFulfillment",
  "searchPromotions",
  "explainPromotion",
  "validateVoucher",
  "getMembershipProfile",
  "listMembershipRewards",
  "listMembershipWallet",
  "getMembershipPointHistory",
  "listMembershipTools",
  "listPaymentMethods",
  "acquireVoucher",
  "redeemReward",
  "searchContentPolicy",
  "answerAllergenQuestion",
  "previewOrder",
  "placeOrder",
  "getOrderStatus",
  "createPaymentLink",
  "checkPaymentStatus",
  "collectInvoice",
  "handoff",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCallRequest {
  toolName: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolResultByName {
  searchMenu: MenuItem[];
  getItemDetails: MenuItem;
  getModifierOptions: GeneratedMenuModifier;
  updateCart: Cart;
  previewCart: Cart;
  recommendAddOns: MenuItem[];
  findStores: Array<{ storeId: string; name: string; address: string; city: string }>;
  checkStoreAvailability: Record<string, boolean>;
  quoteFulfillment: FulfillmentState;
  searchPromotions: GeneratedPromotionVoucherOffer[];
  explainPromotion: GeneratedPromotionVoucherOffer;
  validateVoucher: PromotionValidationResult;
  getMembershipProfile: GeneratedMembershipProfileSnapshot;
  listMembershipRewards: GeneratedMembershipRewardOffer[];
  listMembershipWallet: GeneratedMembershipWalletVoucher[];
  getMembershipPointHistory: GeneratedMembershipPointHistorySnapshot;
  listMembershipTools: GeneratedMembershipToolDefinition[];
  listPaymentMethods: GeneratedPaymentMethod[];
  acquireVoucher: MembershipActionResult;
  redeemReward: MembershipActionResult;
  searchContentPolicy: ContentEvidence[];
  answerAllergenQuestion: ContentEvidence[];
  previewOrder: Order;
  placeOrder: Order;
  getOrderStatus: Order;
  createPaymentLink: { url: string; status: 'pending' };
  checkPaymentStatus: { status: 'pending' | 'paid' | 'failed' };
  collectInvoice: InvoiceRequest;
  handoff: { escalationId: string };
}

export type ToolCallSuccessFor<Name extends ToolName> = {
  ok: true;
  value: ToolResultByName[Name];
  errorCode?: undefined;
  message: string;
  toolName: Name;
  provenance: SourceProvenance[];
};

export type ToolCallFailure = Extract<ToolResult<unknown>, { ok: false }> & {
  toolName: ToolName;
  provenance: SourceProvenance[];
};

export type ToolCallResult = ToolCallFailure | {
  [Name in ToolName]: ToolCallSuccessFor<Name>;
}[ToolName];

export interface ToolTraceEntry {
  toolName: ToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
  provenance: SourceProvenance[];
}

export interface AgentEntities {
  partySize?: number | undefined;
  budgetVnd?: number | undefined;
  itemText?: string | undefined;
  itemCodes?: string[] | undefined;
  quantities?: Record<string, number> | undefined;
  addressText?: string | undefined;
  fulfillmentMethod?: FulfillmentMethod | undefined;
  voucherText?: string | undefined;
  paymentMethod?: PaymentLinkMethod | undefined;
  orderId?: string | undefined;
  asksClarification?: boolean | undefined;
  orderConfirmed?: boolean | undefined;
  reorderConfirmed?: boolean | undefined;
  cartMutationConfirmed?: boolean | undefined;
  cartMutationRequested?: boolean | undefined;
  useSavedAddress?: boolean | undefined;
  fulfillmentAccepted?: boolean | undefined;
  abnormalLargeOrder?: boolean | undefined;
  suppressGenUi?: boolean | undefined;
  keepMenuSurface?: boolean | undefined;
  preferCartSurface?: boolean | undefined;
  preferFulfillmentSurface?: boolean | undefined;
  requiresFulfillmentReplan?: boolean | undefined;
  comboConversionProposal?: {
    itemCode: string;
    name: string;
    quantity: number;
    sourceTotalVnd: number;
    comboTotalVnd: number;
    savingsVnd: number;
  } | undefined;
  invoice?: Partial<InvoiceRequest> | undefined;
}

export interface CartWithModifiers extends Cart {
  selectedModifiers?: Record<string, SelectedModifier[]> | undefined;
}
