import type {
  Address,
  Cart,
  CartItemModifier,
  MenuItem,
  Order,
  ToolResult,
} from "../domain/types.js";

export type FixtureMode =
  | "public_crawl_seed"
  | "authenticated_chrome_seed"
  | "mock_external_state"
  | "test_only"
  | "demo_mock_seed";
export type Disposition = "pickup" | "delivery";
export type FulfillmentMethod = "pickup" | "delivery";
export type ContentKind = "promotion" | "news" | "allergen" | "policy";

export interface SourceProvenance {
  fixtureMode: FixtureMode;
  sourceFile: string;
  sourceUrl?: string;
  sourceApi?: string;
}

export type SelectedModifier = CartItemModifier;

export interface ModifierSelectionInput {
  groupId: string;
  modifierId: string;
  quantity?: number;
  groupName?: string;
  modifierName?: string;
  priceDeltaVnd?: number;
}

export interface MenuPlanningModifierRequirement {
  groupId: string;
  modifierId: string;
  quantity?: number;
}

export interface MenuPlanningModifierOption {
  modifierId: string;
  name: string;
  searchAliases?: string[];
  priceDeltaVnd: number;
  default: boolean;
  quantity?: number;
  selectionBundle: MenuPlanningModifierRequirement[];
}

export interface MenuPlanningModifierGroup {
  groupId: string;
  name: string;
  min: number | null;
  max: number | null;
  requiredSelections: MenuPlanningModifierRequirement[];
  options: MenuPlanningModifierOption[];
}

export interface MenuPlanningCandidate {
  code: string;
  itemId: string;
  productCode: string;
  name: string;
  category: string;
  description: string;
  priceVnd: number;
  originalPriceVnd?: number | null;
  imageUrl?: string;
  available: boolean;
  isCustomize?: boolean;
  isQuickCombo?: boolean;
  hasModifiers?: boolean;
  verifiedForMutation: true;
  verificationQuery: string;
  activeCartItem?: true;
  activeCartQuantity?: number;
  unitComposition?: {
    friedChickenPieces?: number;
    standardPepsi?: number;
  };
  /** Provider-resolved catalog or modifier aliases that occur in the current query. */
  matchedSearchAliases?: string[];
  customerEvidenceSources?: Array<'favorite' | 'recent_order'>;
  modifierGroups: MenuPlanningModifierGroup[];
  fulfillmentAvailability?: {
    storeId: string;
    disposition: Disposition;
    available: boolean;
    reason: 'available' | 'excluded' | 'timeslot_excluded' | 'fixture_missing';
    source: SourceProvenance;
  };
}

export interface MenuPlanningContext {
  query: string;
  candidates: MenuPlanningCandidate[];
  exactQuantityPlans?: Array<{
    targetQuantity: number;
    component: keyof MenuComposition;
    selections: Array<{ itemCode: string; quantity: number }>;
    totalPriceVnd: number;
  }>;
}

export interface MenuComposition {
  friedChickenPieces: number;
  standardPepsi: number;
}

export interface ComboConversionProposal {
  comboItemCode: string;
  comboQuantity: number;
  sourceTotalVnd: number;
  comboTotalVnd: number;
  savingsVnd: number;
  composition: MenuComposition;
}

export interface MenuPlanningContextInput {
  query: string;
  activeItemCodes: string[];
  activeItemQuantities?: Record<string, number>;
  /** Verified customer-specific menu evidence. It is context, never implicit consent to mutate. */
  customerEvidenceItems?: Array<{
    itemCode: string;
    source: 'favorite' | 'recent_order';
  }>;
  maxCandidates: number;
  fulfillment?: {
    storeId: string;
    disposition: Disposition;
  };
}

export interface FulfillmentLocationCandidate {
  serviceAreaId: string;
  storeId: string;
  method: FulfillmentMethod;
  district: string;
  city: string;
  matchedDistrictAlias: string;
  matchedCityAlias?: string;
  matchSource: 'current_query' | 'address_draft';
  verifiedForQuote: true;
  source: SourceProvenance;
}

export interface FulfillmentPlanningContext {
  query: string;
  candidates: FulfillmentLocationCandidate[];
}

export interface FulfillmentPlanningContextInput {
  query: string;
  knownDistrict?: string;
  knownCity?: string;
  method: FulfillmentMethod;
  maxCandidates: number;
}

export interface CartMutationInput {
  itemCode: string;
  quantity: number;
  modifiers?: ModifierSelectionInput[];
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
  validation?: PromotionValidationResult;
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
  loyaltyPoints?: number;
}

export interface PaymentAttempt {
  method?: PaymentLinkMethod;
  status: "pending" | "paid" | "failed";
  paymentUrl?: string;
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
  partySize?: number;
  budgetVnd?: number;
  itemText?: string;
  itemCodes?: string[];
  quantities?: Record<string, number>;
  addressText?: string;
  addressDraft?: Partial<Address>;
  fulfillmentMethod?: FulfillmentMethod;
  voucherText?: string;
  paymentMethod?: PaymentLinkMethod;
  orderId?: string;
  asksClarification?: boolean;
  orderConfirmed?: boolean;
  reorderConfirmed?: boolean;
  cartMutationConfirmed?: boolean;
  cartMutationRequested?: boolean;
  useSavedAddress?: boolean;
  fulfillmentAccepted?: boolean;
  savedAddressDecision?: {
    addressIndex: number;
    decision: 'suggest' | 'accept';
  };
  abnormalLargeOrder?: boolean;
  smallTalk?: boolean;
  suppressGenUi?: boolean;
  keepMenuSurface?: boolean;
  preferCartSurface?: boolean;
  preferFulfillmentSurface?: boolean;
  freshShoppingJourney?: boolean;
  suppressSavedAddressCandidate?: boolean;
  fulfillmentRisk?: 'item_unavailable_before_confirmation';
  unavailableItemCodes?: string[];
  paymentStatusClaimed?: 'paid';
  comboConversionProposal?: {
    itemCode: string;
    name: string;
    quantity: number;
    sourceItemCodes: string[];
    sourceTotalVnd: number;
    comboTotalVnd: number;
    savingsVnd: number;
  };
  invoice?: Partial<InvoiceRequest>;
}

export interface CartWithModifiers extends Cart {
  selectedModifiers?: Record<string, SelectedModifier[]>;
}
