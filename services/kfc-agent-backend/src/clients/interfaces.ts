import type { PaymentSurface } from '../domain/paymentSurface.js';
import type {
  Address,
  Cart,
  ConversationProfile,
  FulfillmentAddressInput,
  MenuItem,
  Order,
  ToolResult,
} from '../domain/types.js';
import type {
  ContentEvidence,
  FulfillmentMethod,
  FulfillmentState,
  InvoiceRequest,
  MembershipActionResult,
  ModifierSelectionInput,
  PromotionValidationResult,
} from '../ordering/types.js';
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
import type { ChannelPresentationMedia } from '../presentation/channelPresentation.js';

export interface ExternalCallContext {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
}

export interface ProviderMutationIdentity {
  /** Stable across retries and outcome reconciliation for one exact action. */
  readonly idempotencyKey: string;
  /** Conflicts when the same key is reused for different bound authority. */
  readonly bindingFingerprint: string;
}

export interface IrreversibleConfirmationBinding {
  kind: 'confirm_order';
  requestId: string;
  environment: 'production' | 'sandbox';
  scenarioId: string;
  catalogObservationId: string;
  catalogObservationHash: string;
  cartRevision: string;
  fulfillmentRevision: string;
  paymentRevision: string;
  providerRevision: string;
}

export interface IrreversibleConfirmationAuthority {
  environment: 'production' | 'sandbox';
  scenarioId: string;
  catalogObservationId: string;
  catalogObservationHash: string;
  providerRevision: string;
  revalidate(
    binding: IrreversibleConfirmationBinding,
    externalCallContext: ExternalCallContext,
  ): Promise<{ ok: boolean; reason?: string }>;
}

export interface ChannelMediaDeliveryResult {
  status: 'sent' | 'partial' | 'failed';
  items: Array<{
    key: string;
    status: 'sent' | 'failed';
    messageId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface MenuClient {
  searchMenu(
    query: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MenuItem[]>>;
  getItemDetails(
    code: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MenuItem>>;
  getModifierOptions(
    code: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMenuModifier>>;
}

export interface CartClient {
  createCart(
    sessionId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Cart>>;
  applyChanges(
    cart: Cart,
    changes: CartChange[],
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Cart>>;
  updateCart(
    cart: Cart,
    itemCode: string,
    quantity: number,
    modifiers: ModifierSelectionInput[] | undefined,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Cart>>;
  previewCart(
    cart: Cart,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Cart>>;
}

export interface CartChange {
  itemCode: string;
  quantity: number;
  modifiers?: ModifierSelectionInput[];
}

export interface RecommendationClient {
  recommendAddOns(
    cart: Cart,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MenuItem[]>>;
}

export interface PromotionClient {
  searchPromotions(
    query: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedPromotionVoucherOffer[]>>;
  explainPromotion(
    offerId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedPromotionVoucherOffer>>;
  validateVoucher(
    cart: Cart,
    voucherCode: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Cart>>;
  validateVoucherInput(
    cart: Cart,
    inputCodeOrText: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<PromotionValidationResult>>;
}

export interface MembershipClient {
  getProfile(
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMembershipProfileSnapshot>>;
  listRewards(
    input: { query?: string },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMembershipRewardOffer[]>>;
  listWallet(
    input: { status?: string },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMembershipWalletVoucher[]>>;
  getPointHistory(
    input: { days?: number },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMembershipPointHistorySnapshot>>;
  listTools(
    input: { sideEffect?: GeneratedMembershipToolDefinition['sideEffect'] },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedMembershipToolDefinition[]>>;
  acquireVoucher(
    input: { rewardId: string; confirmed: false },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MembershipActionResult>>;
  acquireVoucher(
    input: { rewardId: string; confirmed: true },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>>;
  redeemReward(
    input: { voucherId: string; channel?: string; confirmed: false },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MembershipActionResult>>;
  redeemReward(
    input: { voucherId: string; channel?: string; confirmed: true },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>>;
}

export interface InventoryClient {
  /**
   * Current opaque revision of the inventory authority used for availability
   * decisions. The maintained agent fails closed when a provider cannot expose
   * this boundary; a catalog or confirmation revision is not interchangeable.
   */
  getAvailabilityRevision?(
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<string>>;
  /**
   * Atomically binds availability rows to the provider revision that produced
   * them. Maintained checkout authorization rejects legacy unbound reads.
   */
  checkInventoryWithAuthority?(
    storeId: string,
    itemCodes: string[],
    disposition: 'pickup' | 'delivery',
    externalCallContext: ExternalCallContext,
  ): Promise<
    ToolResult<{
      availability: Record<string, boolean>;
      providerRevision: string;
      observedAt: string;
      expiresAt: string;
    }>
  >;
  checkInventory(
    storeId: string,
    itemCodes: string[],
    disposition: 'pickup' | 'delivery' | undefined,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Record<string, boolean>>>;
}

export interface StoreLocatorClient {
  assignStore(
    address: Address,
    itemCodes: string[],
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<{ storeId: string }>>;
  findStores(
    input: { query?: string; city?: string; district?: string },
    externalCallContext: ExternalCallContext,
  ): Promise<
    ToolResult<
      Array<{ storeId: string; name: string; address: string; city: string }>
    >
  >;
}

export interface FulfillmentClient {
  quoteFulfillment(
    input: {
      address: FulfillmentAddressInput;
      method: FulfillmentMethod;
      itemCodes: string[];
    },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<FulfillmentState>>;
}

export interface ContentClient {
  searchContent(
    kind: 'promotion' | 'news' | 'allergen' | 'policy' | 'all',
    query: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<ContentEvidence[]>>;
  answerAllergenQuestion(
    query: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<ContentEvidence[]>>;
}

export interface InvoiceClient {
  collectInvoice(
    input: Partial<InvoiceRequest>,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<InvoiceRequest>>;
}

export interface OmsClient {
  previewOrder(
    input: { cart: Cart; address: Address; storeId: string },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Order>>;
  placeOrder(
    input: {
      preview: Order;
      userConfirmed: boolean;
      context?: {
        sessionId: string;
        clientMessageId: string;
        traceId: string;
        scenarioId: string;
      };
    },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<Order>>;
  getOrderStatus(
    orderId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Order>>;
  cancelOrder(
    orderId: string,
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<Order>>;
}

export interface PaymentClient {
  listMethods(
    input: { query?: string; paymentSurface?: PaymentSurface },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<GeneratedPaymentMethod[]>>;
  createPaymentLink(
    order: Order,
    methodId: string,
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<{ url: string; status: 'pending' }>>;
  checkPaymentStatus(
    orderId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<{ status: 'pending' | 'paid' | 'failed' }>>;
}

export interface DeliveryClient {
  quoteDelivery(
    address: Address,
    storeId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>>;
}

export interface CustomerClient {
  getSavedAddresses(
    customerId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Address[]>>;
  getRecentOrder(
    customerId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<Order | null>>;
  getFavoriteItems(
    customerId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MenuItem[]>>;
}

export interface LoyaltyClient {
  lookupLoyalty(
    customerId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<{ points: number }>>;
}

export interface HandoffClient {
  escalateToHuman(
    sessionId: string,
    reasons: string[],
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<{ escalationId: string }>>;
  resolveEscalation(
    sessionId: string,
    escalationId: string,
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<
    ToolResult<{
      escalationId: string;
      status: 'resolved';
    }>
  >;
}

export interface FeedbackClient {
  recordFeedback(
    sessionId: string,
    message: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<{ feedbackId: string }>>;
}

export interface ChannelUserProfile {
  displayName: string | null;
  avatarUrl: string | null;
  profileSource: ConversationProfile['profileSource'];
}

export type MessengerSenderAction = 'mark_seen' | 'typing_on' | 'typing_off';

export type ChannelTextSendOutcome =
  | {
      status: 'confirmed_sent';
      /** Provider-issued identifier returned by the accepted send request. */
      messageId: string;
    }
  | {
      status:
        'confirmed_not_sent' | 'not_dispatched' | 'delivery_outcome_unknown';
      errorCode: string;
      message: string;
    };

/**
 * Transport-level text outcome. Unlike ToolResult, this contract preserves
 * whether a failed-looking response is a confirmed rejection or an ambiguous
 * outcome after dispatch.
 */
export interface ChannelTextOutcomeClient {
  sendTextWithOutcome(
    recipientId: string,
    text: string,
  ): Promise<ChannelTextSendOutcome>;
}

/**
 * Explicit compatibility boundary for callers that have not yet adopted the
 * durable text-delivery outcome state machine. It intentionally collapses the
 * three non-success outcomes only here, never inside route code.
 */
export function channelTextSendOutcomeToLegacyToolResult(
  outcome: ChannelTextSendOutcome,
): ToolResult<{ messageId: string }> {
  if (outcome.status === 'confirmed_sent') {
    return {
      ok: true,
      value: { messageId: outcome.messageId },
      message: 'sent',
    };
  }
  return {
    ok: false,
    errorCode: outcome.errorCode,
    message: outcome.message,
  };
}

export interface MessengerClient extends ChannelTextOutcomeClient {
  sendText(
    recipientId: string,
    text: string,
  ): Promise<ToolResult<{ messageId: string }>>;
  sendMedia?(
    recipientId: string,
    media: ChannelPresentationMedia[],
  ): Promise<ChannelMediaDeliveryResult>;
  sendSenderAction(
    recipientId: string,
    action: MessengerSenderAction,
  ): Promise<ToolResult<{ recipientId: string }>>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}

export interface ZaloClient extends ChannelTextOutcomeClient {
  sendText(
    recipientId: string,
    text: string,
  ): Promise<ToolResult<{ messageId: string }>>;
  sendMedia?(
    recipientId: string,
    media: ChannelPresentationMedia[],
  ): Promise<ChannelMediaDeliveryResult>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}

export interface ExternalClients {
  /**
   * Provider capabilities are server-owned facts. Absence means unsupported;
   * request input and model output must never populate this boundary.
   */
  providerCapabilities?: {
    readonly handoffResolution: boolean;
  };
  confirmationAuthority?: IrreversibleConfirmationAuthority;
  menu: MenuClient;
  cart: CartClient;
  recommendation: RecommendationClient;
  promotion: PromotionClient;
  membership: MembershipClient;
  inventory: InventoryClient;
  storeLocator: StoreLocatorClient;
  fulfillment: FulfillmentClient;
  content: ContentClient;
  invoice: InvoiceClient;
  oms: OmsClient;
  payment: PaymentClient;
  delivery: DeliveryClient;
  customer: CustomerClient;
  loyalty: LoyaltyClient;
  handoff: HandoffClient;
  feedback: FeedbackClient;
  messenger: MessengerClient;
  zalo: ZaloClient;
}
