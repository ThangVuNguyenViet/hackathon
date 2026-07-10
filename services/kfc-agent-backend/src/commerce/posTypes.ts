import type { Order, ToolResult } from "../domain/types.js";

export type PosTicketStatus =
  "accepted" | "preparing" | "ready" | "cancelled" | "rejected";

export interface PosTicket {
  id: string;
  omsOrderId: string;
  storeId: string;
  status: PosTicketStatus;
  createdAt: string;
}

export interface PosClient {
  submitOrder(input: {
    order: Order;
    idempotencyKey: string;
  }): Promise<ToolResult<PosTicket>>;
  getTicket(ticketId: string): Promise<ToolResult<PosTicket>>;
  cancelTicket(ticketId: string): Promise<ToolResult<PosTicket>>;
}
