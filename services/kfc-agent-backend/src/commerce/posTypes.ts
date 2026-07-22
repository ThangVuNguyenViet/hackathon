import type {
  ExternalCallContext,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import type { Order, ToolResult } from '../domain/types.js';

export type PosTicketStatus =
  'accepted' | 'preparing' | 'ready' | 'cancelled' | 'rejected';

export interface PosTicket {
  id: string;
  omsOrderId: string;
  storeId: string;
  status: PosTicketStatus;
  createdAt: string;
}

export interface PosClient {
  submitOrder(
    input: {
      order: Order;
    },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<PosTicket>>;
  getTicket(
    ticketId: string,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<PosTicket>>;
  cancelTicket(
    ticketId: string,
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<PosTicket>>;
}
