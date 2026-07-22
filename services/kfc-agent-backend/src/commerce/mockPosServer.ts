import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Order } from '../domain/types.js';
import type { PosTicket, PosTicketStatus } from './posTypes.js';

export interface MockPosServerOptions {
  token: string;
  rejectItemCodes?: string[];
}

const statusSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready', 'cancelled', 'rejected']),
});

export function buildMockPosServer(
  options: MockPosServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const tickets = new Map<string, PosTicket>();
  const ticketByIdempotencyKey = new Map<string, string>();
  const rejectedCodes = new Set(options.rejectItemCodes ?? []);
  let sequence = 0;

  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      await reply.code(401).send({
        ok: false,
        errorCode: 'pos_unauthorized',
        message: 'Invalid POS token',
      });
    }
  });

  server.get('/health', async () => ({
    ok: true,
    service: 'mock-pos',
    commerceEnvironment: 'sandbox',
    providerImplementation: 'in-process-fixture-provider',
    providerSource: 'mock-pos-server',
  }));

  server.post('/v1/tickets', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'idempotency_key_required',
        message: 'Idempotency-Key is required',
      });
    }
    const existingId = ticketByIdempotencyKey.get(idempotencyKey);
    if (existingId) {
      return {
        ok: true,
        value: tickets.get(existingId),
        message: 'pos_ticket_reused',
      };
    }

    const order = (request.body as { order?: Order } | undefined)?.order;
    if (
      !order?.id ||
      !order.assignedStoreId ||
      !Array.isArray(order.cart?.items)
    ) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_pos_order',
        message: 'A valid OMS order is required',
      });
    }
    if (order.cart.items.some((item) => rejectedCodes.has(item.itemCode))) {
      return reply.code(409).send({
        ok: false,
        errorCode: 'pos_order_rejected',
        message: 'Mock POS rejected an unavailable item',
      });
    }

    const ticket: PosTicket = {
      id: `POS-${String(++sequence).padStart(4, '0')}`,
      omsOrderId: order.id,
      storeId: order.assignedStoreId,
      status: 'accepted',
      createdAt: new Date().toISOString(),
    };
    tickets.set(ticket.id, ticket);
    ticketByIdempotencyKey.set(idempotencyKey, ticket.id);
    return reply
      .code(201)
      .send({ ok: true, value: ticket, message: 'pos_ticket_created' });
  });

  server.get('/v1/tickets/:ticketId', async (request, reply) => {
    const ticket = tickets.get(
      (request.params as { ticketId: string }).ticketId,
    );
    return ticket
      ? { ok: true, value: ticket, message: 'pos_ticket_found' }
      : reply.code(404).send({
          ok: false,
          errorCode: 'pos_ticket_not_found',
          message: 'POS ticket was not found',
        });
  });

  server.post('/v1/tickets/:ticketId/cancel', async (request, reply) => {
    const ticketId = (request.params as { ticketId: string }).ticketId;
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      return reply.code(404).send({
        ok: false,
        errorCode: 'pos_ticket_not_found',
        message: 'POS ticket was not found',
      });
    }
    const cancelled = { ...ticket, status: 'cancelled' as const };
    tickets.set(ticketId, cancelled);
    return { ok: true, value: cancelled, message: 'pos_ticket_cancelled' };
  });

  server.post('/__admin/tickets/:ticketId/status', async (request, reply) => {
    const ticketId = (request.params as { ticketId: string }).ticketId;
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      return reply.code(404).send({
        ok: false,
        errorCode: 'pos_ticket_not_found',
        message: 'POS ticket was not found',
      });
    }
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_pos_status',
        message: 'Invalid POS status',
      });
    }
    const updated = {
      ...ticket,
      status: parsed.data.status as PosTicketStatus,
    };
    tickets.set(ticketId, updated);
    return { ok: true, value: updated, message: 'pos_ticket_status_updated' };
  });

  return server;
}
