import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import { paymentSurfaceSchema } from '../domain/paymentSurface.js';
import type { Order } from '../domain/types.js';
import { loadBundledGeneratedFixtures } from '../fixtures/bundledFixtures.js';
import { OrderingDataService } from '../ordering/orderingDataService.js';
import {
  commerceCommandSchema,
  commerceContractVersion,
  commerceResultSchema,
  type CommerceResult,
} from './contracts.js';
import {
  canonicalCancellationMutationPayload,
  canonicalCommerceCommandPayload,
  canonicalPaymentMutationPayload,
  claimGatewayMutationAuthority,
  sameProviderMutationBinding,
  type CommerceProofGatewayMutationState,
  type CommerceProofGatewayMutationSnapshot,
  type SandboxPaymentLinkSuccess,
  type StoredCancellationMutation,
  type StoredCommerceOrderMutation,
} from './gatewayMutationContracts.js';
import { createGatewayMutationDurability } from './gatewayMutationDurability.js';
import { claimStoredCancellation } from './gatewayCancellationClaim.js';
import { claimStoredCommerceOrder } from './gatewayOrderClaim.js';
import {
  executeStoredCancellationMutation,
  executeStoredOrderMutation,
} from './gatewayMutationExecution.js';
import {
  createCommerceProofOmsClient,
  createCommerceProofPosClient,
} from './httpClients.js';
import {
  readGatewayProviderRuntimeBinding,
  validateRestoredGatewayProviderState,
} from './gatewayRestoreValidation.js';
import {
  cancellationCommerceResult,
  checkReadiness,
  customerOrderStatus,
  customerStatusForPos,
  fallbackAgentOrder,
  idempotencyConflict,
  orderPosStatus,
  providerStatusMatchesOutcome,
  sandboxGatewayProvenance,
} from './gatewayServerSupport.js';
export interface CommerceProofGatewayServerOptions {
  token: string;
  oms: { baseUrl: string; token: string };
  pos: { baseUrl: string; token: string };
  timeoutMs: number;
  readinessTimeoutMs: number;
  mutationState: CommerceProofGatewayMutationState;
  persistMutationSnapshot(
    snapshot: CommerceProofGatewayMutationSnapshot,
  ): Promise<void>;
}
const cancellationSchema = z
  .object({
    idempotencyKey: opaqueProviderIdSchema,
    bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const previewSchema = z.object({
  cart: z
    .object({
      id: z.string().min(1),
      items: z.array(
        z
          .object({
            itemCode: z.string().min(1),
            name: z.string(),
            quantity: z.number().int().positive().safe(),
            unitPriceVnd: z.number().int().nonnegative().safe(),
          })
          .passthrough(),
      ),
      subtotalVnd: z.number().int().nonnegative().safe(),
      discountVnd: z.number().int().nonnegative().safe(),
      deliveryFeeVnd: z.number().int().nonnegative().safe(),
      totalVnd: z.number().int().nonnegative().safe(),
      voucherCode: z.string().nullable(),
    })
    .passthrough(),
  address: z.record(z.unknown()),
  storeId: z.string().min(1),
});
const paymentLinkSchema = z
  .object({
    methodId: opaqueProviderIdSchema,
    idempotencyKey: opaqueProviderIdSchema,
    bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const commerceOrderParamsSchema = z
  .object({
    commerceOrderId: opaqueProviderIdSchema,
  })
  .strict();
const paymentMethodsQuerySchema = z
  .object({
    query: z.string().optional(),
    paymentSurface: paymentSurfaceSchema.optional(),
  })
  .strict();
const orderStatusQuerySchema = z
  .object({
    traceId: opaqueProviderIdSchema.optional(),
  })
  .strict();
export function buildCommerceProofGatewayServer(
  options: CommerceProofGatewayServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const oms = createCommerceProofOmsClient({
    ...options.oms,
    timeoutMs: options.timeoutMs,
  });
  const pos = createCommerceProofPosClient({
    ...options.pos,
    timeoutMs: options.timeoutMs,
  });
  const mutationState = options.mutationState;
  const orderInFlightByIdempotencyKey = new Map<string, Promise<void>>();
  const cancellationInFlightByIdempotencyKey = new Map<string, Promise<void>>();
  const resultByCommerceOrderId = new Map<string, CommerceResult>();
  const previewById = new Map<string, Order>();
  const orderByCommerceOrderId = new Map<string, Order>();
  const paymentData = new OrderingDataService(loadBundledGeneratedFixtures());
  let previewSequence = 0;
  const durability = createGatewayMutationDurability({
    state: mutationState,
    persistSnapshot: options.persistMutationSnapshot,
  });
  server.addHook('onReady', async () => {
    try {
      await validateRestoredGatewayProviderState({
        state: mutationState,
        oms,
        pos,
      });
    } catch (error) {
      throw new Error('gateway_restored_provider_state_unverified', {
        cause: error,
      });
    }
  });
  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: 'gateway_unauthorized',
        message: 'Invalid Demo Commerce Gateway token',
      });
    }
  });
  server.get('/health', async () => ({
    ok: true,
    service: 'demo-commerce-gateway',
    version: '1',
    contractVersion: commerceContractVersion,
    commerceEnvironment: 'sandbox',
    providerImplementation: 'http-adapter',
    timestamp: new Date().toISOString(),
  }));
  server.get('/ready', async (_request, reply) => {
    const [omsCheck, posCheck] = await Promise.all([
      checkReadiness(options.oms, options.readinessTimeoutMs),
      checkReadiness(options.pos, options.readinessTimeoutMs),
    ]);
    const ok = omsCheck.status === 'ready' && posCheck.status === 'ready';
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: 'demo-commerce-gateway',
      status: ok ? 'ready' : 'unavailable',
      configured: true,
      reachable: true,
      authenticated: true,
      commerceEnvironment: 'sandbox',
      providerImplementation: 'http-adapter',
      checks: { oms: omsCheck, pos: posCheck },
      timestamp: new Date().toISOString(),
    });
  });

  server.post('/v1/orders/preview', async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_order_preview',
        message: parsed.error.message,
      });
    }
    const preview: Order = {
      id: `PREVIEW-${String(++previewSequence).padStart(4, '0')}`,
      status: 'previewed',
      paymentStatus: 'pending',
      assignedStoreId: parsed.data.storeId,
      createdAt: new Date().toISOString(),
      cart: parsed.data.cart,
    };
    previewById.set(preview.id, preview);
    return {
      ok: true,
      value: preview,
      message: 'order_previewed',
      provenance: sandboxGatewayProvenance,
    };
  });

  server.get('/v1/payment-methods', async (request) => {
    const { query, paymentSurface } = paymentMethodsQuerySchema.parse(
      request.query,
    );
    return {
      ok: true,
      value: paymentData.listPaymentMethods({ query, paymentSurface }),
      message: 'payment_methods_listed',
      provenance: sandboxGatewayProvenance,
    };
  });

  server.post('/v1/orders', async (request, reply) => {
    const parsed = commerceCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_commerce_command',
        message: parsed.error.message,
      });
    }
    const command = parsed.data;
    const canonicalPayload = canonicalCommerceCommandPayload(command);
    let inFlight = orderInFlightByIdempotencyKey.get(command.idempotencyKey);
    while (inFlight) {
      await inFlight;
      inFlight = orderInFlightByIdempotencyKey.get(command.idempotencyKey);
    }
    let settleOrder!: () => void;
    const settled = new Promise<void>((resolve) => {
      settleOrder = resolve;
    });
    orderInFlightByIdempotencyKey.set(command.idempotencyKey, settled);
    try {
      let stored = mutationState.ordersByIdempotencyKey.get(
        command.idempotencyKey,
      );
      if (
        stored &&
        !sameProviderMutationBinding(
          stored.command.bindingFingerprint,
          stored.canonicalPayload,
          command.bindingFingerprint,
          canonicalPayload,
        )
      ) {
        return idempotencyConflict(reply);
      }
      if (
        stored &&
        !claimGatewayMutationAuthority(mutationState, {
          kind: 'placeOrder',
          idempotencyKey: command.idempotencyKey,
          bindingFingerprint: command.bindingFingerprint,
          canonicalPayload,
        })
      ) {
        return idempotencyConflict(reply);
      }
      if (!stored) {
        const providerRuntimeBinding = await readGatewayProviderRuntimeBinding({
          oms,
          pos,
        });
        const claim = await claimStoredCommerceOrder({
          state: mutationState,
          durability,
          command,
          canonicalPayload,
          providerRuntimeBinding,
        });
        if (claim.kind === 'conflict') return idempotencyConflict(reply);
        stored = claim.stored;
      }
      if (
        stored.state === 'completed' &&
        stored.response &&
        stored.responseStatus !== undefined
      ) {
        if (
          !durability.isDurable(
            'ordersByIdempotencyKey',
            command.idempotencyKey,
            stored,
          )
        ) {
          await durability.persist();
        }
        projectStoredOrder(stored);
        return reply.code(stored.responseStatus).send(stored.response);
      }
      if (
        !durability.isDurable(
          'ordersByIdempotencyKey',
          command.idempotencyKey,
          stored,
        )
      ) {
        await durability.persist();
      }
      const executed = await executeStoredOrderMutation({
        stored,
        oms,
        pos,
        durability,
      });
      projectStoredOrder(stored);
      return reply.code(executed.statusCode).send(executed.body);
    } finally {
      settleOrder();
      if (
        orderInFlightByIdempotencyKey.get(command.idempotencyKey) === settled
      ) {
        orderInFlightByIdempotencyKey.delete(command.idempotencyKey);
      }
    }
  });

  function projectStoredOrder(stored: StoredCommerceOrderMutation): void {
    if (
      !durability.isDurable(
        'ordersByIdempotencyKey',
        stored.command.idempotencyKey,
        stored,
      )
    ) {
      return;
    }
    const accepted = stored.response;
    if (
      !accepted?.commerceOrderId ||
      accepted.outcome !== 'accepted' ||
      accepted.customerStatus !== 'accepted'
    )
      return;
    const preview = previewById.get(stored.command.order.previewId);
    const baseOrder = preview
      ? {
          ...preview,
          id: accepted.commerceOrderId,
          status: 'created' as const,
          commerceOrderId: accepted.commerceOrderId,
          omsOrderId: accepted.omsOrderId,
          posTicketId: accepted.posTicketId,
          posStatus: 'accepted' as const,
          commerceOutcome: accepted.outcome,
          commerceCustomerStatus: accepted.customerStatus,
          commerceEnvironment: 'sandbox' as const,
          commerceProviderProvenance: accepted.providerProvenance,
        }
      : fallbackAgentOrder(stored.command, accepted);
    const cancellation = durableCancellationForOrder(accepted.commerceOrderId);
    if (!cancellation?.result) {
      resultByCommerceOrderId.set(accepted.commerceOrderId, accepted);
      orderByCommerceOrderId.set(accepted.commerceOrderId, baseOrder);
      return;
    }
    const cancellationResult = cancellationCommerceResult(cancellation.result);
    resultByCommerceOrderId.set(accepted.commerceOrderId, cancellationResult);
    orderByCommerceOrderId.set(
      accepted.commerceOrderId,
      cancellation.result.outcome === 'cancelled'
        ? cancellation.result.value
        : {
            ...baseOrder,
            posStatus: orderPosStatus(cancellationResult.posStatus),
            commerceOutcome: cancellationResult.outcome,
            commerceCustomerStatus: cancellationResult.customerStatus,
          },
    );
  }

  async function hydrateStoredOrder(commerceOrderId: string): Promise<void> {
    const key = mutationState.orderKeyByCommerceOrderId.get(commerceOrderId);
    let inFlight = key ? orderInFlightByIdempotencyKey.get(key) : undefined;
    while (inFlight) {
      await inFlight;
      inFlight = key ? orderInFlightByIdempotencyKey.get(key) : undefined;
    }
    const stored = key
      ? mutationState.ordersByIdempotencyKey.get(key)
      : undefined;
    if (stored) projectStoredOrder(stored);
  }

  function durableCancellationForOrder(
    commerceOrderId: string,
  ): StoredCancellationMutation | undefined {
    for (const [
      key,
      cancellation,
    ] of mutationState.cancellationsByIdempotencyKey) {
      if (
        cancellation.context.commerceOrderId === commerceOrderId &&
        cancellation.state === 'completed' &&
        cancellation.result !== undefined &&
        durability.isDurable('cancellationsByIdempotencyKey', key, cancellation)
      ) {
        return cancellation;
      }
    }
    return undefined;
  }

  server.post(
    '/v1/orders/:commerceOrderId/payment-links',
    async (request, reply) => {
      const parsed = paymentLinkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          errorCode: 'invalid_payment_link_request',
          message: parsed.error.message,
        });
      }
      const { commerceOrderId } = commerceOrderParamsSchema.parse(
        request.params,
      );
      await hydrateStoredOrder(commerceOrderId);
      const payableOrder = resultByCommerceOrderId.get(commerceOrderId);
      if (!orderByCommerceOrderId.has(commerceOrderId) || !payableOrder) {
        return reply.code(404).send({
          ok: false,
          errorCode: 'commerce_order_not_found',
          message: 'Commerce order was not found',
        });
      }
      const canonicalPayload = canonicalPaymentMutationPayload(
        commerceOrderId,
        parsed.data.methodId,
      );
      const existingPaymentLink =
        mutationState.paymentLinksByIdempotencyKey.get(
          parsed.data.idempotencyKey,
        );
      if (
        existingPaymentLink &&
        !sameProviderMutationBinding(
          existingPaymentLink.bindingFingerprint,
          existingPaymentLink.canonicalPayload,
          parsed.data.bindingFingerprint,
          canonicalPayload,
        )
      ) {
        return idempotencyConflict(reply);
      }
      if (existingPaymentLink) {
        if (
          !claimGatewayMutationAuthority(mutationState, {
            kind: 'createPaymentLink',
            idempotencyKey: parsed.data.idempotencyKey,
            bindingFingerprint: parsed.data.bindingFingerprint,
            canonicalPayload,
          })
        ) {
          return idempotencyConflict(reply);
        }
        if (
          !durability.isDurable(
            'paymentLinksByIdempotencyKey',
            parsed.data.idempotencyKey,
            existingPaymentLink,
          )
        ) {
          await durability.persist();
        }
        return existingPaymentLink.result;
      }
      if (
        payableOrder.outcome !== 'accepted' ||
        payableOrder.customerStatus !== 'accepted'
      ) {
        return reply.code(409).send({
          ok: false,
          errorCode: 'commerce_order_not_payable',
          message: 'Commerce order is not eligible for a payment link',
        });
      }
      const method = paymentData.getPaymentMethodForLink(parsed.data.methodId);
      if (!method?.supported || method.supportStatus !== 'listed_supported') {
        return reply.code(422).send({
          ok: false,
          errorCode: 'payment_method_unsupported',
          message: `${method?.displayName ?? parsed.data.methodId} is not supported by this sandbox provider`,
        });
      }
      const result: SandboxPaymentLinkSuccess = {
        ok: true,
        value: {
          url:
            `https://pay.sandbox.invalid/method-${encodeURIComponent(parsed.data.methodId)}/` +
            `order-${encodeURIComponent(commerceOrderId)}`,
          status: 'pending',
        },
        message: 'payment_link_created',
        provenance: sandboxGatewayProvenance,
      };
      const candidatePayment = {
        bindingFingerprint: parsed.data.bindingFingerprint,
        canonicalPayload,
        result,
      };
      await durability.commitStateUpdate((candidateState) => {
        if (
          !claimGatewayMutationAuthority(candidateState, {
            kind: 'createPaymentLink',
            idempotencyKey: parsed.data.idempotencyKey,
            bindingFingerprint: parsed.data.bindingFingerprint,
            canonicalPayload,
          })
        ) {
          throw new Error('gateway_provider_idempotency_conflict');
        }
        candidateState.paymentLinksByIdempotencyKey.set(
          parsed.data.idempotencyKey,
          candidatePayment,
        );
        return {
          output: undefined,
          publish() {
            mutationState.authorityByIdempotencyKey.set(
              parsed.data.idempotencyKey,
              candidateState.authorityByIdempotencyKey.get(
                parsed.data.idempotencyKey,
              )!,
            );
            mutationState.paymentLinksByIdempotencyKey.set(
              parsed.data.idempotencyKey,
              candidatePayment,
            );
          },
        };
      });
      return result;
    },
  );

  server.get(
    '/v1/orders/:commerceOrderId/payment-status',
    async (request, reply) => {
      const { commerceOrderId } = commerceOrderParamsSchema.parse(
        request.params,
      );
      await hydrateStoredOrder(commerceOrderId);
      const payableOrder = resultByCommerceOrderId.get(commerceOrderId);
      if (!orderByCommerceOrderId.has(commerceOrderId) || !payableOrder) {
        return reply.code(404).send({
          ok: false,
          errorCode: 'commerce_order_not_found',
          message: 'Commerce order was not found',
        });
      }
      if (
        payableOrder.outcome !== 'accepted' ||
        payableOrder.customerStatus !== 'accepted'
      ) {
        return reply.code(409).send({
          ok: false,
          errorCode: 'commerce_order_not_payable',
          message: 'Commerce order is not eligible for payment status',
        });
      }
      return {
        ok: true,
        value: { status: 'pending' },
        message: 'payment_status_read',
        provenance: sandboxGatewayProvenance,
      };
    },
  );

  server.get('/v1/orders/:commerceOrderId', async (request, reply) => {
    const { commerceOrderId } = commerceOrderParamsSchema.parse(request.params);
    const { traceId = crypto.randomUUID() } = orderStatusQuerySchema.parse(
      request.query,
    );
    await hydrateStoredOrder(commerceOrderId);
    const current = resultByCommerceOrderId.get(commerceOrderId);
    if (!current?.omsOrderId || !current.posTicketId) {
      return reply.code(404).send({
        ok: false,
        errorCode: 'commerce_order_not_found',
        message: 'Commerce order was not found',
      });
    }
    const [omsStatus, posStatus] = await Promise.all([
      oms.getOrder(current.omsOrderId, traceId),
      pos.getTicket(current.posTicketId, traceId),
    ]);
    if (!omsStatus.ok || !posStatus.ok) {
      return reply.code(502).send({
        ...current,
        traceId,
        outcome: 'failed',
        customerStatus: 'failed',
      });
    }
    const conflict = !providerStatusMatchesOutcome(
      current.outcome,
      omsStatus.value.omsStatus,
      posStatus.value.posStatus,
    );
    const projected = commerceResultSchema.parse({
      ...current,
      traceId,
      omsStatus: omsStatus.value.omsStatus,
      posStatus: posStatus.value.posStatus,
      outcome: conflict ? 'status_conflict' : current.outcome,
      customerStatus: conflict
        ? 'failed'
        : current.outcome === 'cancelled'
          ? 'cancelled'
          : customerStatusForPos(posStatus.value.posStatus),
      ...(conflict ? { conflictType: 'oms_created_pos_cancelled' } : {}),
    });
    const order = orderByCommerceOrderId.get(commerceOrderId);
    if (!order) {
      return reply.code(500).send({
        ...projected,
        ok: false,
        errorCode: 'agent_order_projection_missing',
        message: 'Agent order projection was not found',
      });
    }
    const value: Order = {
      ...order,
      status: customerOrderStatus(projected.customerStatus),
      posStatus: orderPosStatus(projected.posStatus),
      commerceOutcome: projected.outcome,
      commerceCustomerStatus: projected.customerStatus,
    };
    return reply.code(conflict ? 409 : 200).send({
      ...projected,
      ok: !conflict,
      ...(conflict ? { errorCode: 'commerce_status_conflict' } : { value }),
      message: conflict
        ? 'Commerce status is conflicting'
        : 'order_status_read',
      provenance: sandboxGatewayProvenance,
    });
  });

  server.post('/v1/orders/:commerceOrderId/cancel', async (request, reply) => {
    const { commerceOrderId } = commerceOrderParamsSchema.parse(request.params);
    await hydrateStoredOrder(commerceOrderId);
    const current = resultByCommerceOrderId.get(commerceOrderId);
    const parsed = cancellationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: 'invalid_cancellation_command',
        message: parsed.error.message,
      });
    }
    if (!current?.omsOrderId || !current.posTicketId) {
      return reply.code(404).send({
        ok: false,
        errorCode: 'commerce_order_not_found',
        message: 'Commerce order was not found',
      });
    }
    const requestedStored = mutationState.cancellationsByIdempotencyKey.get(
      parsed.data.idempotencyKey,
    );
    const canonicalPayload =
      canonicalCancellationMutationPayload(commerceOrderId);
    if (
      requestedStored &&
      !sameProviderMutationBinding(
        requestedStored.bindingFingerprint,
        requestedStored.canonicalPayload,
        parsed.data.bindingFingerprint,
        canonicalPayload,
      )
    ) {
      return idempotencyConflict(reply);
    }
    if (
      current.outcome !== 'accepted' ||
      current.customerStatus !== 'accepted'
    ) {
      if (
        requestedStored?.context.commerceOrderId === commerceOrderId &&
        requestedStored.state === 'completed' &&
        requestedStored.result !== undefined &&
        requestedStored.responseStatus !== undefined &&
        durability.isDurable(
          'cancellationsByIdempotencyKey',
          parsed.data.idempotencyKey,
          requestedStored,
        )
      ) {
        return reply
          .code(requestedStored.responseStatus)
          .send(requestedStored.result);
      }
      const claimedByAnotherKey = [
        ...mutationState.cancellationsByIdempotencyKey,
      ].some(
        ([key, cancellation]) =>
          key !== parsed.data.idempotencyKey &&
          cancellation.context.commerceOrderId === commerceOrderId,
      );
      if (claimedByAnotherKey) return idempotencyConflict(reply);
      return reply.code(409).send({
        ok: false,
        errorCode: 'commerce_order_not_cancellable',
        message: 'Commerce order already has a terminal cancellation outcome',
      });
    }
    let inFlight = cancellationInFlightByIdempotencyKey.get(
      parsed.data.idempotencyKey,
    );
    while (inFlight) {
      await inFlight;
      inFlight = cancellationInFlightByIdempotencyKey.get(
        parsed.data.idempotencyKey,
      );
    }
    let settleCancellation!: () => void;
    const settled = new Promise<void>((resolve) => {
      settleCancellation = resolve;
    });
    cancellationInFlightByIdempotencyKey.set(
      parsed.data.idempotencyKey,
      settled,
    );
    try {
      let stored = mutationState.cancellationsByIdempotencyKey.get(
        parsed.data.idempotencyKey,
      );
      if (
        stored &&
        !sameProviderMutationBinding(
          stored.bindingFingerprint,
          stored.canonicalPayload,
          parsed.data.bindingFingerprint,
          canonicalPayload,
        )
      ) {
        return idempotencyConflict(reply);
      }
      if (
        stored &&
        !claimGatewayMutationAuthority(mutationState, {
          kind: 'cancelOrder',
          idempotencyKey: parsed.data.idempotencyKey,
          bindingFingerprint: parsed.data.bindingFingerprint,
          canonicalPayload,
        })
      ) {
        return idempotencyConflict(reply);
      }
      if (!stored) {
        const claim = await claimStoredCancellation({
          state: mutationState,
          durability,
          idempotencyKey: parsed.data.idempotencyKey,
          bindingFingerprint: parsed.data.bindingFingerprint,
          canonicalPayload,
          commerceOrderId,
          scenarioId: current.scenarioId,
          omsOrderId: current.omsOrderId,
          posTicketId: current.posTicketId,
        });
        if (claim.kind === 'conflict') return idempotencyConflict(reply);
        stored = claim.stored;
      }
      if (
        stored.state === 'completed' &&
        stored.result !== undefined &&
        stored.responseStatus !== undefined
      ) {
        if (
          !durability.isDurable(
            'cancellationsByIdempotencyKey',
            parsed.data.idempotencyKey,
            stored,
          )
        ) {
          await durability.persist();
        }
        return reply.code(stored.responseStatus).send(stored.result);
      }
      if (
        !durability.isDurable(
          'cancellationsByIdempotencyKey',
          parsed.data.idempotencyKey,
          stored,
        )
      ) {
        await durability.persist();
      }
      const order = orderByCommerceOrderId.get(commerceOrderId);
      const executed = await executeStoredCancellationMutation({
        idempotencyKey: parsed.data.idempotencyKey,
        stored,
        accepted: current,
        order,
        oms,
        pos,
        durability,
      });
      const orderKey =
        mutationState.orderKeyByCommerceOrderId.get(commerceOrderId);
      const baseStored = orderKey
        ? mutationState.ordersByIdempotencyKey.get(orderKey)
        : undefined;
      if (baseStored) projectStoredOrder(baseStored);
      return reply.code(executed.statusCode).send(executed.body);
    } finally {
      settleCancellation();
      if (
        cancellationInFlightByIdempotencyKey.get(parsed.data.idempotencyKey) ===
        settled
      ) {
        cancellationInFlightByIdempotencyKey.delete(parsed.data.idempotencyKey);
      }
    }
  });

  return server;
}
