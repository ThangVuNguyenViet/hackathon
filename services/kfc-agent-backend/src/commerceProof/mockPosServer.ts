import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import { commerceContractVersion, posStatusSchema } from './contracts.js';
import { mockBehaviorSchema, type MockBehavior } from './scenarios.js';

export interface CommerceProofMockPosServerOptions {
  token: string;
  adminToken: string;
  instanceId?: string;
}

const ticketInputSchema = z
  .object({
    contractVersion: z.literal(commerceContractVersion),
    traceId: z.string().min(1),
    scenarioId: z.string().min(1),
    commerceOrderId: z.string().min(1),
    omsOrderId: z.string().min(1),
    storeId: z.string().min(1),
    items: z.array(
      z
        .object({
          itemCode: z.string().min(1),
          quantity: z.number().int().positive().safe(),
        })
        .strict(),
    ),
    totalVnd: z.number().int().nonnegative().safe(),
  })
  .strict();

const cancellationInputSchema = z
  .object({
    traceId: z.string().min(1),
    scenarioId: z.string().min(1),
    commerceOrderId: z.string().min(1),
    omsOrderId: z.string().min(1),
  })
  .strict();

const providerMutationIdentitySchema = z
  .object({
    idempotencyKey: opaqueProviderIdSchema.refine(
      (value) => value.length <= 512,
      { message: 'Provider mutation key exceeds the protocol limit' },
    ),
    bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const scenarioParamsSchema = z.object({
  scenarioId: z.string().min(1),
});
const posTicketParamsSchema = z.object({
  posTicketId: z.string().min(1),
});

interface MockPosTicket {
  contractVersion: typeof commerceContractVersion;
  traceId: string;
  scenarioId: string;
  commerceOrderId: string;
  omsOrderId: string;
  posTicketId: string;
  posStatus: z.infer<typeof posStatusSchema>;
  commerceEnvironment: 'sandbox';
  providerImplementation: 'http-adapter';
  deduplicated: boolean;
  originalTraceId?: string;
}

interface StoredProviderMutation {
  operation: 'submit_pos_ticket' | 'cancel_pos_ticket';
  bindingFingerprint: string;
  canonicalPayload: string;
  response?: {
    statusCode: number;
    payload: unknown;
  };
}

type ProviderMutationClaim =
  | { kind: 'start'; stored: StoredProviderMutation }
  | { kind: 'replay'; response: StoredProviderMutation['response'] }
  | { kind: 'pending' }
  | { kind: 'conflict' };

export function buildCommerceProofMockPosServer(
  options: CommerceProofMockPosServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const instanceId = opaqueProviderIdSchema.parse(
    options.instanceId ?? crypto.randomUUID(),
  );
  const tickets = new Map<string, MockPosTicket>();
  const mutationByIdempotencyKey = new Map<string, StoredProviderMutation>();
  const behaviorByScenario = new Map<string, Map<string, MockBehavior>>();
  let ticketSequence = 0;

  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    const expectedToken = request.url.startsWith('/__admin/')
      ? options.adminToken
      : options.token;
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: 'pos_unauthorized',
        message: 'Invalid Mock POS token',
      });
    }
  });

  server.get('/health', async () => ({
    ok: true,
    service: 'mock-pos',
    version: '1',
    contractVersion: commerceContractVersion,
    commerceEnvironment: 'sandbox',
    providerImplementation: 'http-adapter',
    instanceId,
    timestamp: new Date().toISOString(),
  }));

  server.get('/ready', async () => ({
    ok: true,
    service: 'mock-pos',
    status: 'ready',
    configured: true,
    reachable: true,
    authenticated: true,
    commerceEnvironment: 'sandbox',
    providerImplementation: 'http-adapter',
    instanceId,
  }));

  server.put('/__admin/scenarios/:scenarioId', async (request, reply) => {
    const parsed = mockBehaviorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_mock_behavior',
        message: 'Invalid Mock POS behavior',
      });
    }
    const { scenarioId } = scenarioParamsSchema.parse(request.params);
    const scenario = behaviorByScenario.get(scenarioId) ?? new Map();
    scenario.set(parsed.data.operation, parsed.data);
    behaviorByScenario.set(scenarioId, scenario);
    return reply.code(204).send();
  });

  server.post('/v1/tickets', async (request, reply) => {
    const parsed = ticketInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidTicket(reply);
    const identity = parseProviderMutationIdentity(request.headers);
    if (!identity) return invalidProviderMutationIdentity(reply);
    const claim = claimProviderMutation(
      mutationByIdempotencyKey,
      identity,
      'submit_pos_ticket',
      canonicalProviderMutationPayload(
        'submit_pos_ticket',
        undefined,
        parsed.data,
      ),
    );
    if (claim.kind !== 'start') {
      return sendProviderMutationClaim(reply, claim);
    }

    const behavior = behaviorByScenario
      .get(parsed.data.scenarioId)
      ?.get('submit_pos_ticket');
    if (behavior?.behavior === 'delay') {
      await delay(behavior.delayMs ?? 5000);
    }
    if (behavior?.behavior === 'reject') {
      return completeProviderMutation(reply, claim.stored, 409, {
        ok: false,
        errorCode: 'pos_order_rejected',
        message: 'Mock POS rejected the ticket',
        traceId: parsed.data.traceId,
        scenarioId: parsed.data.scenarioId,
        commerceOrderId: parsed.data.commerceOrderId,
        omsOrderId: parsed.data.omsOrderId,
        posStatus: 'rejected',
        commerceEnvironment: 'sandbox',
        providerImplementation: 'http-adapter',
      });
    }

    const posTicketId = `POS-${String(++ticketSequence).padStart(4, '0')}`;
    const ticket: MockPosTicket = {
      contractVersion: commerceContractVersion,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      commerceOrderId: parsed.data.commerceOrderId,
      omsOrderId: parsed.data.omsOrderId,
      posTicketId,
      posStatus: 'accepted',
      commerceEnvironment: 'sandbox',
      providerImplementation: 'http-adapter',
      deduplicated: false,
    };
    tickets.set(posTicketId, ticket);
    return completeProviderMutation(reply, claim.stored, 201, ticket);
  });

  server.get('/v1/tickets/:posTicketId', async (request, reply) => {
    const { posTicketId } = posTicketParamsSchema.parse(request.params);
    const ticket = tickets.get(posTicketId);
    if (!ticket) {
      return reply.code(404).send({
        ok: false,
        errorCode: 'pos_ticket_not_found',
        message: 'POS ticket was not found',
      });
    }
    const behavior = behaviorByScenario
      .get(ticket.scenarioId)
      ?.get('get_pos_ticket');
    return behavior?.behavior === 'conflict'
      ? { ...ticket, posStatus: 'cancelled' }
      : ticket;
  });

  server.post('/v1/tickets/:posTicketId/cancel', async (request, reply) => {
    const parsed = cancellationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidTicket(reply);
    const { posTicketId } = posTicketParamsSchema.parse(request.params);
    const identity = parseProviderMutationIdentity(request.headers);
    if (!identity) return invalidProviderMutationIdentity(reply);
    const claim = claimProviderMutation(
      mutationByIdempotencyKey,
      identity,
      'cancel_pos_ticket',
      canonicalProviderMutationPayload(
        'cancel_pos_ticket',
        posTicketId,
        parsed.data,
      ),
    );
    if (claim.kind !== 'start') {
      return sendProviderMutationClaim(reply, claim);
    }
    const ticket = tickets.get(posTicketId);
    if (!ticket) {
      return completeProviderMutation(reply, claim.stored, 404, {
        ok: false,
        errorCode: 'pos_ticket_not_found',
        message: 'POS ticket was not found',
      });
    }
    if (
      ticket.commerceOrderId !== parsed.data.commerceOrderId ||
      ticket.omsOrderId !== parsed.data.omsOrderId
    ) {
      return completeProviderMutation(reply, claim.stored, 409, {
        ok: false,
        errorCode: 'provider_order_binding_conflict',
        message: 'POS ticket does not match the bound commerce order',
      });
    }
    const behavior = behaviorByScenario
      .get(parsed.data.scenarioId)
      ?.get('cancel_pos_ticket');
    if (behavior?.behavior === 'delay') {
      await delay(behavior.delayMs ?? 5000);
    }
    if (behavior?.behavior === 'fail') {
      return completeProviderMutation(reply, claim.stored, 409, {
        ok: false,
        errorCode: 'pos_cancellation_failed',
        message: 'Mock POS cancellation failed',
        traceId: parsed.data.traceId,
        scenarioId: parsed.data.scenarioId,
        commerceOrderId: ticket.commerceOrderId,
        omsOrderId: ticket.omsOrderId,
        posTicketId,
        posStatus: 'cancellation_failed',
        commerceEnvironment: 'sandbox',
        providerImplementation: 'http-adapter',
      });
    }
    const cancelled: MockPosTicket = {
      ...ticket,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      posStatus: 'cancelled',
    };
    tickets.set(posTicketId, cancelled);
    return completeProviderMutation(reply, claim.stored, 200, cancelled);
  });

  return server;
}

function parseProviderMutationIdentity(headers: {
  [key: string]: string | string[] | undefined;
}): z.infer<typeof providerMutationIdentitySchema> | undefined {
  const parsed = providerMutationIdentitySchema.safeParse({
    idempotencyKey: headers['idempotency-key'],
    bindingFingerprint: headers['x-provider-binding-fingerprint'],
  });
  return parsed.success ? parsed.data : undefined;
}

function canonicalProviderMutationPayload(
  operation: StoredProviderMutation['operation'],
  targetId: string | undefined,
  body: unknown,
): string {
  return JSON.stringify({
    operation,
    ...(targetId === undefined ? {} : { targetId }),
    body,
  });
}

function claimProviderMutation(
  mutations: Map<string, StoredProviderMutation>,
  identity: z.infer<typeof providerMutationIdentitySchema>,
  operation: StoredProviderMutation['operation'],
  canonicalPayload: string,
): ProviderMutationClaim {
  const existing = mutations.get(identity.idempotencyKey);
  if (existing) {
    if (
      existing.operation !== operation ||
      existing.bindingFingerprint !== identity.bindingFingerprint ||
      existing.canonicalPayload !== canonicalPayload
    ) {
      return { kind: 'conflict' };
    }
    return existing.response
      ? { kind: 'replay', response: existing.response }
      : { kind: 'pending' };
  }
  const stored: StoredProviderMutation = {
    operation,
    bindingFingerprint: identity.bindingFingerprint,
    canonicalPayload,
  };
  mutations.set(identity.idempotencyKey, stored);
  return { kind: 'start', stored };
}

function sendProviderMutationClaim(
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
  },
  claim: Exclude<ProviderMutationClaim, { kind: 'start' }>,
): unknown {
  if (claim.kind === 'replay' && claim.response) {
    return reply
      .code(claim.response.statusCode)
      .send(structuredClone(claim.response.payload));
  }
  if (claim.kind === 'pending') {
    return reply.code(503).send({
      ok: false,
      errorCode: 'provider_idempotency_outcome_unknown',
      message: 'The exact provider mutation is still in progress',
    });
  }
  return reply.code(409).send({
    ok: false,
    errorCode: 'provider_idempotency_conflict',
    message: 'Provider idempotency key conflicts with another bound action',
  });
}

function completeProviderMutation(
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
  },
  stored: StoredProviderMutation,
  statusCode: number,
  payload: unknown,
): unknown {
  stored.response = {
    statusCode,
    payload: structuredClone(payload),
  };
  return reply.code(statusCode).send(payload);
}

function invalidProviderMutationIdentity(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}): unknown {
  return reply.code(400).send({
    ok: false,
    errorCode: 'provider_mutation_identity_required',
    message: 'An exact provider mutation identity is required',
  });
}

function invalidTicket(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}) {
  return reply.code(400).send({
    ok: false,
    errorCode: 'invalid_pos_ticket',
    message: 'A valid Mock POS ticket payload is required',
  });
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
