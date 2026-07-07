import type { Address, Cart, Channel, Intent, Order } from '../domain/types.js';

export interface RetrievedEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface AgentGraphState {
  sessionId: string;
  customerId: string;
  channel: Channel;
  latestUserMessage: string;
  intent: Intent;
  cart?: Cart;
  address?: Address;
  orderPreview?: Order;
  order?: Order;
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
}
