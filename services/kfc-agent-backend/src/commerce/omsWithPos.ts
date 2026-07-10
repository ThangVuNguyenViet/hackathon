import type { OmsClient } from "../clients/interfaces.js";
import type { Order, ToolResult } from "../domain/types.js";
import type { PosClient, PosTicket } from "./posTypes.js";

export interface OmsWithPosOptions {
  oms: OmsClient;
  pos: PosClient;
}

export function createOmsWithPos(options: OmsWithPosOptions): OmsClient {
  const resultByPreviewId = new Map<string, ToolResult<Order>>();
  const ticketByOrderId = new Map<string, PosTicket>();

  return {
    previewOrder: (input) => options.oms.previewOrder(input),
    async placeOrder(input) {
      const existing = resultByPreviewId.get(input.preview.id);
      if (existing) return existing;

      const placed = await options.oms.placeOrder(input);
      if (!placed.ok || !placed.value) return placed;
      const order = placed.value;
      const ticketResult = await options.pos.submitOrder({
        order,
        idempotencyKey: `oms-order:${order.id}`,
      });
      if (!ticketResult.ok || !ticketResult.value) {
        await options.oms.cancelOrder(order.id);
        const failure: ToolResult<Order> = {
          ok: false,
          errorCode: ticketResult.errorCode ?? "pos_submission_failed",
          message: `${ticketResult.message}; OMS order ${order.id} was cancelled`,
        };
        resultByPreviewId.set(input.preview.id, failure);
        return failure;
      }

      const correlated = withTicket(order, ticketResult.value);
      ticketByOrderId.set(order.id, ticketResult.value);
      const success = {
        ok: true,
        value: correlated,
        message: "oms_order_and_pos_ticket_created",
      } satisfies ToolResult<Order>;
      resultByPreviewId.set(input.preview.id, success);
      return success;
    },
    async getOrderStatus(orderId) {
      const orderResult = await options.oms.getOrderStatus(orderId);
      if (!orderResult.ok || !orderResult.value) return orderResult;
      const knownTicket = ticketByOrderId.get(orderId);
      if (!knownTicket) return orderResult;
      const ticketResult = await options.pos.getTicket(knownTicket.id);
      if (!ticketResult.ok || !ticketResult.value) return orderResult;
      ticketByOrderId.set(orderId, ticketResult.value);
      return {
        ok: true,
        value: withTicket(orderResult.value, ticketResult.value),
        message: "oms_and_pos_status_found",
      };
    },
    async cancelOrder(orderId) {
      const orderResult = await options.oms.cancelOrder(orderId);
      const ticket = ticketByOrderId.get(orderId);
      if (!orderResult.ok || !orderResult.value || !ticket) return orderResult;
      const ticketResult = await options.pos.cancelTicket(ticket.id);
      return ticketResult.ok && ticketResult.value
        ? {
            ok: true,
            value: withTicket(orderResult.value, ticketResult.value),
            message: "oms_order_and_pos_ticket_cancelled",
          }
        : orderResult;
    },
  };
}

function withTicket(order: Order, ticket: PosTicket): Order {
  const status =
    ticket.status === "cancelled" || ticket.status === "rejected"
      ? "cancelled"
      : ticket.status === "preparing" || ticket.status === "ready"
        ? "preparing"
        : order.status;
  return { ...order, status, posTicketId: ticket.id, posStatus: ticket.status };
}
