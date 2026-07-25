import type {
  Address,
  Cart,
  CartItemModifier,
  Channel,
  MenuItem,
  Order,
  ToolResult,
} from '../domain/types.js';
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
import type { OfficialSourceAuthority } from '../domain/officialSourceAuthority.js';
import type { ExactCartAvailabilityObservationV2 } from './exactCartAvailabilityAuthority.js';

export type FixtureMode =
  | 'public_crawl_seed'
  | 'authenticated_chrome_seed'
  | 'mock_external_state'
  | 'test_only'
  | 'demo_mock_seed'
  | 'provider_runtime';
export type Disposition = 'pickup' | 'delivery';
export type FulfillmentMethod = 'pickup' | 'delivery';
export type ContentKind = 'promotion' | 'news' | 'allergen' | 'policy';

export type MenuSearchMode = 'search' | 'full';

export interface MenuSearchInput {
  mode?: MenuSearchMode;
  queries?: string[];
  category?: string;
  maxPriceVnd?: number;
  maxPriceExclusiveVnd?: number;
  partySize?: number;
  modifierQueries?: string[];
}

export interface MenuSearchMetadata {
  identifiers: string[];
  aliases: string[];
}

export interface MenuSearchProviderItem extends MenuItem {
  searchMetadata: MenuSearchMetadata;
}

export interface CompactModifierMatch {
  query: string;
  groupId: string;
  groupName: string;
  groupMin: number | null;
  groupMax: number | null;
  modifierId: string;
  name: string;
  priceDeltaVnd: number;
  default: boolean;
  quantity: number | null;
}

export interface MenuSearchItem extends MenuItem {
  matchedModifiers?: CompactModifierMatch[];
  matchesAllModifierQueries?: boolean;
}

export interface MenuSearchResult {
  mode: MenuSearchMode;
  queries: string[];
  total: number;
  returned: number;
  complete: boolean;
  scope: CollectionScope;
  cursor?: string;
  items: MenuSearchItem[];
}

export interface SourceProvenance {
  fixtureMode: FixtureMode;
  sourceFile: string;
  sourceUrl?: string;
  sourceApi?: string;
  /**
   * Identifies a deterministic server policy as the source of a local
   * decision. Its presence means no upstream provider call produced the
   * result.
   */
  serverPolicy?: {
    policyId: string;
    revision: string;
  };
  /**
   * Explicit authority issued by the reviewed content-ingestion boundary.
   * URLs, provider names, and fixture modes never imply this authority.
   */
  officialAuthority?: OfficialSourceAuthority;
}

export type SelectedModifier = CartItemModifier;

export type CollectionScope =
  { scope: 'all' } | { scope: 'filtered'; query: string };

export interface VerifiedCollectionResult<Item> {
  items: Item[];
  total: number;
  returned: number;
  complete: boolean;
  scope: CollectionScope;
  cursor?: string;
}

export interface VerifiedCollectionSnapshot<Item> {
  key: string;
  revision: string;
  providerRevision: string;
  result: VerifiedCollectionResult<Item>;
}

export interface ModifierSelectionInput {
  groupId: string;
  modifierId: string;
  quantity?: number;
  groupName?: string;
  modifierName?: string;
  priceDeltaVnd?: number;
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
  /**
   * Present on every successful provider quote. It remains optional in the
   * durable state interface so pre-migration snapshots can be parsed; the
   * execution boundary rejects a new quote when it is absent or invalid.
   */
  resolvedAddress?: Address;
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
  id?: string;
  kind: ContentKind;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceFile: string;
  tags?: string[];
  retrievedAt?: string;
  approvedAt?: string;
  approvalStatus?: 'approved';
  audience?: 'customer_public';
  contentHash?: string;
  /**
   * Explicit authority issued by the reviewed content-ingestion boundary.
   * Legacy evidence without this attestation remains untrusted.
   */
  officialAuthority?: OfficialSourceAuthority;
}

export interface CustomerContext {
  savedAddresses: Address[];
  recentOrders: Order[];
  favorites: MenuItem[];
  loyaltyPoints?: number;
}

export interface PaymentAttempt {
  /**
   * Server-authored binding to the exact verified order used for the payment
   * provider call. Legacy inputs may omit it for migration compatibility, but
   * unbound attempts are discarded at verified-state and presentation seams.
   */
  orderId?: string;
  /** Exact opaque method identifier returned by the active payment provider. */
  method?: string;
  status: 'pending' | 'paid' | 'failed';
  paymentUrl?: string;
}

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
  'getSavedAddresses',
  'getRecentOrder',
  'getFavoriteItems',
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
  'resolveHandoff',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type CollectionToolName =
  | 'searchMenu'
  | 'recommendAddOns'
  | 'findStores'
  | 'searchPromotions'
  | 'listMembershipRewards'
  | 'listMembershipWallet'
  | 'listMembershipTools'
  | 'listPaymentMethods'
  | 'searchContentPolicy'
  | 'answerAllergenQuestion';

export interface ToolCallRequest {
  toolName: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolResultByName {
  searchMenu: MenuSearchResult;
  getItemDetails: MenuItem;
  getModifierOptions: GeneratedMenuModifier;
  updateCart: Cart;
  previewCart: Cart;
  recommendAddOns: MenuItem[];
  findStores: Array<{
    storeId: string;
    name: string;
    address: string;
    city: string;
  }>;
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
  getSavedAddresses: Address[];
  getRecentOrder: Order | null;
  getFavoriteItems: MenuItem[];
  acquireVoucher: MembershipActionResult;
  redeemReward: MembershipActionResult;
  searchContentPolicy: ContentEvidence[];
  answerAllergenQuestion: ContentEvidence[];
  previewOrder: Order;
  placeOrder: Order;
  getOrderStatus: Order;
  createPaymentLink: {
    orderId: string;
    url: string;
    status: 'pending';
  };
  checkPaymentStatus: {
    orderId: string;
    status: 'pending' | 'paid' | 'failed';
  };
  collectInvoice: InvoiceRequest;
  handoff: { escalationId: string };
  resolveHandoff: {
    escalationId: string;
    status: 'resolved';
  };
}

export type AgentToolResultByName = Omit<
  ToolResultByName,
  CollectionToolName
> & {
  searchMenu: VerifiedCollectionResult<MenuItem>;
  recommendAddOns: VerifiedCollectionResult<MenuItem>;
  findStores: VerifiedCollectionResult<{
    storeId: string;
    name: string;
    address: string;
    city: string;
  }>;
  searchPromotions: VerifiedCollectionResult<GeneratedPromotionVoucherOffer>;
  listMembershipRewards: VerifiedCollectionResult<GeneratedMembershipRewardOffer>;
  listMembershipWallet: VerifiedCollectionResult<GeneratedMembershipWalletVoucher>;
  listMembershipTools: VerifiedCollectionResult<GeneratedMembershipToolDefinition>;
  listPaymentMethods: VerifiedCollectionResult<GeneratedPaymentMethod>;
  searchContentPolicy: VerifiedCollectionResult<ContentEvidence>;
  answerAllergenQuestion: VerifiedCollectionResult<ContentEvidence>;
};

export interface VerifiedCollectionStore {
  searchMenu?: Record<string, VerifiedCollectionSnapshot<MenuItem>>;
  recommendAddOns?: Record<string, VerifiedCollectionSnapshot<MenuItem>>;
  findStores?: Record<
    string,
    VerifiedCollectionSnapshot<ToolResultByName['findStores'][number]>
  >;
  searchPromotions?: Record<
    string,
    VerifiedCollectionSnapshot<GeneratedPromotionVoucherOffer>
  >;
  listMembershipRewards?: Record<
    string,
    VerifiedCollectionSnapshot<GeneratedMembershipRewardOffer>
  >;
  listMembershipWallet?: Record<
    string,
    VerifiedCollectionSnapshot<GeneratedMembershipWalletVoucher>
  >;
  listMembershipTools?: Record<
    string,
    VerifiedCollectionSnapshot<GeneratedMembershipToolDefinition>
  >;
  listPaymentMethods?: Record<
    string,
    VerifiedCollectionSnapshot<GeneratedPaymentMethod>
  >;
  searchContentPolicy?: Record<
    string,
    VerifiedCollectionSnapshot<ContentEvidence>
  >;
  answerAllergenQuestion?: Record<
    string,
    VerifiedCollectionSnapshot<ContentEvidence>
  >;
}

export interface VerifiedRefPrincipal {
  principalKind?: 'authenticated_customer';
  sessionId: string;
  customerId: string;
  channel: Channel;
  authenticatedSubject: string;
  authenticationEvidenceRef: string;
}

export interface InventoryAvailabilityAuthority {
  providerRevision: string;
  observedAt: string;
  expiresAt: string;
}

export interface AgentToolCallSuccessFor<Name extends ToolName> {
  toolName: Name;
  ok: true;
  value: AgentToolResultByName[Name];
  message: string;
  provenance: SourceProvenance[];
  verifiedCollection?: VerifiedCollectionSnapshot<unknown>;
  /** Atomic provider authority attached to an availability read. */
  inventoryAvailabilityAuthority?: InventoryAvailabilityAuthority;
  /** Server-only authority evidence; stripped from model-facing tool results. */
  verifiedAvailabilityObservation?: ExactCartAvailabilityObservationV2;
}

export interface AgentToolCallFailure {
  toolName: ToolName;
  ok: false;
  value?: undefined;
  errorCode?: string;
  message: string;
  provenance: SourceProvenance[];
}

export type AgentToolCallResult =
  | AgentToolCallFailure
  | { [Name in ToolName]: AgentToolCallSuccessFor<Name> }[ToolName];

export interface ToolCallSuccessFor<Name extends ToolName> {
  toolName: Name;
  ok: true;
  value: ToolResultByName[Name];
  errorCode?: undefined;
  message: string;
  provenance: SourceProvenance[];
  /** Atomic provider authority attached to an availability read. */
  inventoryAvailabilityAuthority?: InventoryAvailabilityAuthority;
  /** Server-only authority evidence; never supplied by a legacy provider. */
  verifiedAvailabilityObservation?: ExactCartAvailabilityObservationV2;
}

export interface ToolCallFailure {
  toolName: ToolName;
  ok: false;
  value?: undefined;
  errorCode?: string;
  message: string;
  provenance: SourceProvenance[];
}

export type ToolCallResult =
  ToolCallFailure | { [Name in ToolName]: ToolCallSuccessFor<Name> }[ToolName];

export type ToolTraceProvenance = Pick<SourceProvenance, 'fixtureMode'> &
  Partial<Omit<SourceProvenance, 'fixtureMode'>>;

interface ToolTracePublicationAuditBase {
  currentTurnId: string;
  traceIndex: number;
  traceDigest: string;
  argumentsDigest: string;
  toolCallId: string;
  toolName: ToolName;
  executionOutcome: 'success' | 'error';
  evidenceId: string;
  evidenceDigest: string;
  membershipActionOutcome?: Pick<
    MembershipActionResult,
    'actionId' | 'status' | 'requiresUserConfirmation' | 'targetId'
  >;
}

export interface ToolTracePublicationAuditV1 extends ToolTracePublicationAuditBase {
  schemaVersion: 'kfc-tool-trace-publication-audit-v1';
}

export interface ToolTracePublicationAuditV2 extends ToolTracePublicationAuditBase {
  schemaVersion: 'kfc-tool-trace-publication-audit-v2';
  authorityDigest: string;
  currentTurnRevision: string;
}

export type ToolTracePublicationAudit =
  ToolTracePublicationAuditV1 | ToolTracePublicationAuditV2;

export interface ToolTraceEntry {
  toolName: ToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
  provenance: ToolTraceProvenance[];
  /**
   * Privacy-safe durable binding for a published tool result. This contains
   * hashes and identities only; raw provider results remain outside the trace.
   */
  publicationEvidenceAudit?: ToolTracePublicationAudit;
}

export interface CartWithModifiers extends Cart {
  selectedModifiers?: Record<string, SelectedModifier[]>;
}
