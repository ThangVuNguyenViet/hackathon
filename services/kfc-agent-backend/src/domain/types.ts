export type Channel = 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock';

export type Intent =
  | 'ordering'
  | 'cart_edit'
  | 'voucher'
  | 'payment'
  | 'order_status'
  | 'complaint'
  | 'feedback'
  | 'handoff'
  | 'safety'
  | 'unclear';

export interface MenuItem {
  code: string;
  category: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
  available: boolean;
}

export interface CartItem {
  itemCode: string;
  name: string;
  quantity: number;
  unitPriceVnd: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  subtotalVnd: number;
  discountVnd: number;
  deliveryFeeVnd: number;
  totalVnd: number;
  voucherCode: string | null;
}

export interface Address {
  label: string;
  line1: string;
  district: string;
  city: string;
}

export type OrderStatus = 'previewed' | 'created' | 'preparing' | 'delivering' | 'completed' | 'cancelled';
export type PaymentStatus = 'not_started' | 'pending' | 'paid' | 'failed';

export interface Order {
  id: string;
  cart: Cart;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  assignedStoreId: string;
  createdAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: Channel;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus: 'received' | 'pending' | 'sent' | 'failed' | 'not_applicable';
  createdAt: string;
}

export interface ToolResult<T> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  message: string;
}

export interface DashboardEvent {
  id: string;
  sessionId: string;
  type:
    | 'session_updated'
    | 'conversation_turn_created'
    | 'customer_message_received'
    | 'assistant_reply_sent'
    | 'cart_changed'
    | 'voucher_applied'
    | 'voucher_rejected'
    | 'payment_link_created'
    | 'payment_failed'
    | 'payment_paid'
    | 'order_previewed'
    | 'order_created'
    | 'handoff_required'
    | 'session_resolved';
  payload: Record<string, unknown>;
  createdAt: string;
}
