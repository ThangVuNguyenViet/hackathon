import type { Address, Cart, MenuItem, Order, ToolResult } from '../domain/types.js';

export interface MenuClient {
  searchMenu(query: string): Promise<ToolResult<MenuItem[]>>;
  getItemDetails(code: string): Promise<ToolResult<MenuItem>>;
}

export interface CartClient {
  createCart(sessionId: string): Promise<ToolResult<Cart>>;
  updateCart(cart: Cart, itemCode: string, quantity: number): Promise<ToolResult<Cart>>;
  previewCart(cart: Cart): Promise<ToolResult<Cart>>;
}

export interface RecommendationClient {
  recommendAddOns(cart: Cart): Promise<ToolResult<MenuItem[]>>;
}

export interface PromotionClient {
  validateVoucher(cart: Cart, voucherCode: string): Promise<ToolResult<Cart>>;
}

export interface InventoryClient {
  checkInventory(storeId: string, itemCodes: string[]): Promise<ToolResult<Record<string, boolean>>>;
}

export interface StoreLocatorClient {
  assignStore(address: Address, itemCodes: string[]): Promise<ToolResult<{ storeId: string; etaMinutes: number }>>;
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

export interface MessengerClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
}

export interface ZaloClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
}

export interface ExternalClients {
  menu: MenuClient;
  cart: CartClient;
  recommendation: RecommendationClient;
  promotion: PromotionClient;
  inventory: InventoryClient;
  storeLocator: StoreLocatorClient;
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
