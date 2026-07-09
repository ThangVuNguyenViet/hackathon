import type { Address, Cart, ConversationProfile, MenuItem, Order, ToolResult } from '../domain/types.js';
import type {
  ContentEvidence,
  FulfillmentMethod,
  FulfillmentState,
  InvoiceRequest,
  MembershipActionResult,
  PromotionValidationResult,
  SelectedModifier,
} from '../ordering/types.js';
import type {
  GeneratedMembershipPointHistorySnapshot,
  GeneratedMembershipProfileSnapshot,
  GeneratedMembershipRewardOffer,
  GeneratedMembershipToolDefinition,
  GeneratedMembershipWalletVoucher,
  GeneratedMenuModifier,
  GeneratedPromotionVoucherOffer,
} from '../fixtures/schema.js';

export interface MenuClient {
  searchMenu(query: string): Promise<ToolResult<MenuItem[]>>;
  getItemDetails(code: string): Promise<ToolResult<MenuItem>>;
  getModifierOptions(code: string): Promise<ToolResult<GeneratedMenuModifier>>;
}

export interface CartClient {
  createCart(sessionId: string): Promise<ToolResult<Cart>>;
  updateCart(cart: Cart, itemCode: string, quantity: number, modifiers?: SelectedModifier[]): Promise<ToolResult<Cart>>;
  previewCart(cart: Cart): Promise<ToolResult<Cart>>;
}

export interface RecommendationClient {
  recommendAddOns(cart: Cart): Promise<ToolResult<MenuItem[]>>;
}

export interface PromotionClient {
  searchPromotions(query: string): Promise<ToolResult<GeneratedPromotionVoucherOffer[]>>;
  explainPromotion(offerId: string): Promise<ToolResult<GeneratedPromotionVoucherOffer>>;
  validateVoucher(cart: Cart, voucherCode: string): Promise<ToolResult<Cart>>;
  validateVoucherInput(cart: Cart, inputCodeOrText: string): Promise<ToolResult<PromotionValidationResult>>;
}

export interface MembershipClient {
  getProfile(): Promise<ToolResult<GeneratedMembershipProfileSnapshot>>;
  listRewards(input: { query?: string }): Promise<ToolResult<GeneratedMembershipRewardOffer[]>>;
  listWallet(input: { status?: string }): Promise<ToolResult<GeneratedMembershipWalletVoucher[]>>;
  getPointHistory(input: { days?: number }): Promise<ToolResult<GeneratedMembershipPointHistorySnapshot>>;
  listTools(input: { sideEffect?: GeneratedMembershipToolDefinition['sideEffect'] }): Promise<ToolResult<GeneratedMembershipToolDefinition[]>>;
  acquireVoucher(input: { rewardId: string; confirmed: boolean }): Promise<ToolResult<MembershipActionResult>>;
  redeemReward(input: { voucherId: string; channel?: string; confirmed: boolean }): Promise<ToolResult<MembershipActionResult>>;
}

export interface InventoryClient {
  checkInventory(storeId: string, itemCodes: string[], disposition?: 'pickup' | 'delivery'): Promise<ToolResult<Record<string, boolean>>>;
}

export interface StoreLocatorClient {
  assignStore(address: Address, itemCodes: string[]): Promise<ToolResult<{ storeId: string }>>;
  findStores(input: { query?: string; city?: string; district?: string }): Promise<ToolResult<Array<{ storeId: string; name: string; address: string; city: string }>>>;
}

export interface FulfillmentClient {
  quoteFulfillment(input: {
    address: Address;
    method: FulfillmentMethod;
    itemCodes: string[];
  }): Promise<ToolResult<FulfillmentState>>;
}

export interface ContentClient {
  searchContent(kind: 'promotion' | 'news' | 'allergen' | 'policy' | 'all', query: string): Promise<ToolResult<ContentEvidence[]>>;
  answerAllergenQuestion(query: string): Promise<ToolResult<ContentEvidence[]>>;
}

export interface InvoiceClient {
  collectInvoice(input: Partial<InvoiceRequest>): Promise<ToolResult<InvoiceRequest>>;
}

export interface OmsClient {
  previewOrder(input: { cart: Cart; address: Address; storeId: string }): Promise<ToolResult<Order>>;
  placeOrder(input: { preview: Order; userConfirmed: boolean }): Promise<ToolResult<Order>>;
  getOrderStatus(orderId: string): Promise<ToolResult<Order>>;
  cancelOrder(orderId: string): Promise<ToolResult<Order>>;
}

export interface PaymentClient {
  createPaymentLink(order: Order, method: 'momo' | 'card' | 'cod'): Promise<ToolResult<{ url: string; status: 'pending' }>>;
  checkPaymentStatus(orderId: string): Promise<ToolResult<{ status: 'pending' | 'paid' | 'failed' }>>;
}

export interface DeliveryClient {
  quoteDelivery(address: Address, storeId: string): Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>>;
}

export interface CustomerClient {
  getSavedAddresses(customerId: string): Promise<ToolResult<Address[]>>;
  getRecentOrder(customerId: string): Promise<ToolResult<Order | null>>;
}

export interface LoyaltyClient {
  lookupLoyalty(customerId: string): Promise<ToolResult<{ points: number }>>;
}

export interface HandoffClient {
  escalateToHuman(sessionId: string, reasons: string[]): Promise<ToolResult<{ escalationId: string }>>;
}

export interface FeedbackClient {
  recordFeedback(sessionId: string, message: string): Promise<ToolResult<{ feedbackId: string }>>;
}

export interface ChannelUserProfile {
  displayName: string | null;
  avatarUrl: string | null;
  profileSource: ConversationProfile['profileSource'];
}

export interface MessengerClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}

export interface ZaloClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}

export interface ExternalClients {
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
