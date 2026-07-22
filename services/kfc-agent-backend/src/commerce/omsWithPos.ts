import type {
  ExternalCallContext,
  OmsClient,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import type { Order, ToolResult } from '../domain/types.js';
import type { PosClient, PosTicket } from './posTypes.js';

export interface OmsWithPosOptions {
  oms: OmsClient;
  pos: PosClient;
}

type PlacementOrderOutcome =
  | { kind: 'correlated'; ticket: PosTicket }
  | { kind: 'no_pos_ticket' }
  | { kind: 'ambiguous'; result: ToolResult<Order> };

type MutationOperation = 'placeOrder' | 'cancelOrder';

interface MutationBinding {
  bindingFingerprint: string;
  canonicalPayload: string;
  operation: MutationOperation;
  targetId: string;
}

const definitivePosSubmissionRejections = new Set([
  'idempotency_key_required',
  'invalid_pos_order',
  'pos_order_rejected',
  'pos_unauthorized',
]);

function externalCallIsCancelled(context: ExternalCallContext): boolean {
  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

function placementPartial(order: Order, detail: string): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'commerce_placement_partial',
    message: `OMS order ${order.id} exists, but POS placement did not complete: ${detail}`,
  };
}

function placementAmbiguous(order: Order, detail: string): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'pos_mutation_ambiguous',
    message: `OMS order ${order.id} exists and the POS placement outcome is ambiguous: ${detail}`,
  };
}

function providerIdentityConflict(): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'provider_idempotency_conflict',
    message: 'Provider idempotency key conflicts with another bound action',
  };
}

function providerIdentityRequired(): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'provider_mutation_identity_required',
    message: 'A canonical provider mutation identity is required',
  };
}

function providerPayloadInvalid(detail: string): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'provider_mutation_payload_invalid',
    message: `Provider mutation payload is not canonical: ${detail}`,
  };
}

function providerMutationIdentityIsValid(
  identity: ProviderMutationIdentity | null | undefined,
): identity is ProviderMutationIdentity {
  return Boolean(
    identity &&
    typeof identity.idempotencyKey === 'string' &&
    typeof identity.bindingFingerprint === 'string' &&
    identity.idempotencyKey.length <= 512 &&
    opaqueProviderIdSchema.safeParse(identity.idempotencyKey).success &&
    /^[a-f0-9]{64}$/u.test(identity.bindingFingerprint),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new Error('unsafe_numeric_value');
    }
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveProviderMutationIdentity(input: {
  parent: ProviderMutationIdentity;
  operation: string;
  payload: unknown;
}): Promise<ProviderMutationIdentity> {
  const keyDigest = await sha256(
    canonicalJson({
      idempotencyKey: input.parent.idempotencyKey,
      operation: input.operation,
    }),
  );
  const bindingFingerprint = await sha256(
    canonicalJson({
      bindingFingerprint: input.parent.bindingFingerprint,
      operation: input.operation,
      payload: input.payload,
    }),
  );
  return {
    idempotencyKey: `kfc-provider:${input.operation}:${keyDigest}`,
    bindingFingerprint,
  };
}

function canonicalPlacementPayload(
  input: Parameters<OmsClient['placeOrder']>[0],
): string {
  return canonicalJson({
    preview: input.preview,
    userConfirmed: input.userConfirmed,
    context: input.context
      ? {
          sessionId: input.context.sessionId,
          clientMessageId: input.context.clientMessageId,
          scenarioId: input.context.scenarioId,
        }
      : undefined,
  });
}

function clonePlacementInput(
  input: Parameters<OmsClient['placeOrder']>[0],
): Parameters<OmsClient['placeOrder']>[0] {
  return structuredClone(input);
}

function cancellationPartial(
  orderId: string,
  detail: string,
): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'commerce_cancellation_partial',
    message: `OMS order ${orderId} is cancelled, but POS cancellation did not complete: ${detail}`,
  };
}

function cancellationAmbiguous(
  orderId: string,
  detail: string,
): ToolResult<Order> {
  return {
    ok: false,
    errorCode: 'commerce_cancellation_ambiguous',
    message: `Cancellation of OMS order ${orderId} is unsafe while placement is unresolved: ${detail}`,
  };
}

function installInFlightFence<Key, Value>(
  fences: Map<Key, Promise<Value>>,
  key: Key,
  operation: () => Promise<Value>,
): Promise<Value> {
  const fence = Promise.resolve().then(operation);
  fences.set(key, fence);
  const clearFence = (): void => {
    if (fences.get(key) === fence) fences.delete(key);
  };
  void fence.then(clearFence, clearFence);
  return fence;
}

export function createOmsWithPos(options: OmsWithPosOptions): OmsClient {
  const resultByPreviewId = new Map<string, ToolResult<Order>>();
  const placedOrderByPreviewId = new Map<string, Order>();
  const ticketByOrderId = new Map<string, PosTicket>();
  const cancelledOrderByOrderId = new Map<string, Order>();
  const cancellationResultByOrderId = new Map<string, ToolResult<Order>>();
  const placementInFlightByPreviewId = new Map<
    string,
    Promise<ToolResult<Order>>
  >();
  const cancellationInFlightByOrderId = new Map<
    string,
    Promise<ToolResult<Order>>
  >();
  const placementPhaseByOrderId = new Map<string, Promise<ToolResult<Order>>>();
  const placementOutcomeByOrderId = new Map<string, PlacementOrderOutcome>();
  const placementIdentityByPreviewId = new Map<
    string,
    ProviderMutationIdentity
  >();
  const placementInputByPreviewId = new Map<
    string,
    Parameters<OmsClient['placeOrder']>[0]
  >();
  const cancellationIdentityByOrderId = new Map<
    string,
    ProviderMutationIdentity
  >();
  const mutationBindingByIdempotencyKey = new Map<string, MutationBinding>();

  const bindMutationIdentity = (input: {
    identity: ProviderMutationIdentity;
    operation: MutationOperation;
    targetId: string;
    canonicalPayload: string;
    existingIdentity: ProviderMutationIdentity | undefined;
  }): boolean => {
    const existingBinding = mutationBindingByIdempotencyKey.get(
      input.identity.idempotencyKey,
    );
    if (
      existingBinding &&
      (existingBinding.bindingFingerprint !==
        input.identity.bindingFingerprint ||
        existingBinding.operation !== input.operation ||
        existingBinding.targetId !== input.targetId ||
        existingBinding.canonicalPayload !== input.canonicalPayload)
    ) {
      return false;
    }
    if (
      input.existingIdentity &&
      (input.existingIdentity.idempotencyKey !==
        input.identity.idempotencyKey ||
        input.existingIdentity.bindingFingerprint !==
          input.identity.bindingFingerprint)
    ) {
      return false;
    }
    if (!existingBinding) {
      mutationBindingByIdempotencyKey.set(input.identity.idempotencyKey, {
        bindingFingerprint: input.identity.bindingFingerprint,
        canonicalPayload: input.canonicalPayload,
        operation: input.operation,
        targetId: input.targetId,
      });
    }
    return true;
  };

  const completePlacementAfterOms = async (
    input: Parameters<OmsClient['placeOrder']>[0],
    externalCallContext: ExternalCallContext,
    order: Order,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<Order>> => {
    if (externalCallIsCancelled(externalCallContext)) {
      const partial = placementPartial(
        order,
        'the caller cancelled before POS dispatch',
      );
      placementOutcomeByOrderId.set(order.id, {
        kind: 'no_pos_ticket',
      });
      resultByPreviewId.set(input.preview.id, partial);
      return partial;
    }
    const posMutationIdentity = await deriveProviderMutationIdentity({
      parent: mutationIdentity,
      operation: 'pos-submit-order',
      payload: { order },
    });
    const ticketResult = await options.pos.submitOrder(
      {
        order,
      },
      externalCallContext,
      posMutationIdentity,
    );
    const ticketFailure =
      !ticketResult.ok || !ticketResult.value
        ? ticketResult
        : ticketResult.value.status !== 'accepted'
          ? ({
              ok: false,
              errorCode:
                ticketResult.value.status === 'rejected'
                  ? 'pos_order_rejected'
                  : 'pos_mutation_ambiguous',
              message: `POS returned ${ticketResult.value.status} for a ticket submission`,
            } satisfies ToolResult<PosTicket>)
          : undefined;
    if (ticketFailure) {
      if (ticketFailure.errorCode === 'pos_request_cancelled') {
        const partial = placementPartial(order, ticketFailure.message);
        placementOutcomeByOrderId.set(order.id, {
          kind: 'no_pos_ticket',
        });
        resultByPreviewId.set(input.preview.id, partial);
        return partial;
      }
      if (
        ticketFailure.errorCode === 'pos_mutation_ambiguous' ||
        !definitivePosSubmissionRejections.has(ticketFailure.errorCode ?? '')
      ) {
        const ambiguous = placementAmbiguous(order, ticketFailure.message);
        placementOutcomeByOrderId.set(order.id, {
          kind: 'ambiguous',
          result: ambiguous,
        });
        return ambiguous;
      }
      if (externalCallIsCancelled(externalCallContext)) {
        const partial = placementPartial(
          order,
          `${ticketFailure.message}; compensation was not dispatched because the caller cancelled`,
        );
        placementOutcomeByOrderId.set(order.id, {
          kind: 'no_pos_ticket',
        });
        resultByPreviewId.set(input.preview.id, partial);
        return partial;
      }
      const compensationIdentity = await deriveProviderMutationIdentity({
        parent: mutationIdentity,
        operation: 'oms-compensate-pos-rejection',
        payload: { orderId: order.id },
      });
      const compensated = await options.oms.cancelOrder(
        order.id,
        externalCallContext,
        compensationIdentity,
      );
      if (!compensated.ok) {
        const compensationFailure =
          compensated.errorCode === 'commerce_gateway_mutation_ambiguous'
            ? ({
                ok: false,
                errorCode: compensated.errorCode,
                message: `${ticketFailure.message}; OMS compensation outcome is ambiguous: ${compensated.message}`,
              } satisfies ToolResult<Order>)
            : placementPartial(
                order,
                `${ticketFailure.message}; OMS compensation failed: ${compensated.message}`,
              );
        placementOutcomeByOrderId.set(
          order.id,
          compensationFailure.errorCode ===
            'commerce_gateway_mutation_ambiguous'
            ? {
                kind: 'ambiguous',
                result: compensationFailure,
              }
            : { kind: 'no_pos_ticket' },
        );
        if (
          compensationFailure.errorCode !==
          'commerce_gateway_mutation_ambiguous'
        ) {
          resultByPreviewId.set(input.preview.id, compensationFailure);
        }
        return compensationFailure;
      }
      const failure: ToolResult<Order> = {
        ok: false,
        errorCode: ticketFailure.errorCode ?? 'pos_submission_failed',
        message: `${ticketFailure.message}; OMS order ${order.id} was cancelled`,
      };
      placementOutcomeByOrderId.set(order.id, {
        kind: 'no_pos_ticket',
      });
      resultByPreviewId.set(input.preview.id, failure);
      return failure;
    }

    const acceptedTicket = ticketResult.value;
    if (!acceptedTicket) {
      return placementAmbiguous(
        order,
        'POS accepted the mutation without returning a ticket',
      );
    }
    const correlated = withTicket(order, acceptedTicket);
    ticketByOrderId.set(order.id, acceptedTicket);
    placementOutcomeByOrderId.set(order.id, {
      kind: 'correlated',
      ticket: acceptedTicket,
    });
    const success = {
      ok: true,
      value: correlated,
      message: 'oms_order_and_pos_ticket_created',
    } satisfies ToolResult<Order>;
    resultByPreviewId.set(input.preview.id, success);
    return success;
  };

  const placeOrderOnce = async (
    input: Parameters<OmsClient['placeOrder']>[0],
    externalCallContext: ExternalCallContext,
    mutationIdentity: Parameters<OmsClient['placeOrder']>[2],
  ): Promise<ToolResult<Order>> => {
    const knownOrder = placedOrderByPreviewId.get(input.preview.id);
    const placed = knownOrder
      ? ({
          ok: true,
          value: knownOrder,
          message: 'oms_order_reused_after_unknown_pos_outcome',
        } satisfies ToolResult<Order>)
      : await options.oms.placeOrder(
          input,
          externalCallContext,
          mutationIdentity,
        );
    if (!placed.ok || !placed.value) {
      return placed;
    }
    const order = placed.value;
    placedOrderByPreviewId.set(input.preview.id, order);
    const existingPhase = placementPhaseByOrderId.get(order.id);
    if (existingPhase) return existingPhase;
    return installInFlightFence(placementPhaseByOrderId, order.id, async () => {
      try {
        return await completePlacementAfterOms(
          input,
          externalCallContext,
          order,
          mutationIdentity,
        );
      } catch (error) {
        const ambiguous = placementAmbiguous(
          order,
          error instanceof Error ? error.message : String(error),
        );
        placementOutcomeByOrderId.set(order.id, {
          kind: 'ambiguous',
          result: ambiguous,
        });
        return ambiguous;
      }
    });
  };

  const cancelOrderOnce = async (
    orderId: string,
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<Order>> => {
    const placementPhase = placementPhaseByOrderId.get(orderId);
    if (placementPhase) {
      try {
        await placementPhase;
      } catch (error) {
        return cancellationAmbiguous(
          orderId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const placementOutcome = placementOutcomeByOrderId.get(orderId);
    if (placementOutcome?.kind === 'ambiguous') {
      return cancellationAmbiguous(orderId, placementOutcome.result.message);
    }
    if (
      placementOutcome?.kind === 'correlated' &&
      !ticketByOrderId.has(orderId)
    ) {
      return cancellationAmbiguous(
        orderId,
        'placement completed without a correlated POS ticket',
      );
    }

    const knownCancelledOrder = cancelledOrderByOrderId.get(orderId);
    const orderResult = knownCancelledOrder
      ? ({
          ok: true,
          value: knownCancelledOrder,
          message: 'oms_cancellation_reused_after_unknown_pos_outcome',
        } satisfies ToolResult<Order>)
      : await options.oms.cancelOrder(
          orderId,
          externalCallContext,
          await deriveProviderMutationIdentity({
            parent: mutationIdentity,
            operation: 'oms-cancel-order',
            payload: { orderId },
          }),
        );
    const ticket = ticketByOrderId.get(orderId);
    if (!orderResult.ok || !orderResult.value) {
      return orderResult;
    }
    cancelledOrderByOrderId.set(orderId, orderResult.value);
    if (!ticket) {
      cancellationResultByOrderId.set(orderId, orderResult);
      return orderResult;
    }
    if (externalCallIsCancelled(externalCallContext)) {
      const partial = cancellationPartial(
        orderId,
        'the caller cancelled before POS dispatch',
      );
      cancellationResultByOrderId.set(orderId, partial);
      return partial;
    }
    const posCancellationIdentity = await deriveProviderMutationIdentity({
      parent: mutationIdentity,
      operation: 'pos-cancel-ticket',
      payload: { orderId, ticketId: ticket.id },
    });
    const ticketResult = await options.pos.cancelTicket(
      ticket.id,
      externalCallContext,
      posCancellationIdentity,
    );
    const ticketFailure =
      !ticketResult.ok || !ticketResult.value
        ? ticketResult
        : ticketResult.value.status !== 'cancelled'
          ? ({
              ok: false,
              errorCode:
                ticketResult.value.status === 'rejected'
                  ? 'pos_cancellation_rejected'
                  : 'pos_mutation_ambiguous',
              message: `POS returned ${ticketResult.value.status} for a ticket cancellation`,
            } satisfies ToolResult<PosTicket>)
          : undefined;
    if (ticketFailure) {
      const failure =
        ticketFailure.errorCode === 'pos_mutation_ambiguous' ||
        ticketFailure.errorCode === 'pos_unavailable' ||
        (ticketFailure.ok && !ticketFailure.value)
          ? ({
              ok: false,
              errorCode: 'pos_mutation_ambiguous',
              message: `${ticketFailure.message}; OMS order ${orderId} is cancelled but the POS cancellation outcome is ambiguous`,
            } satisfies ToolResult<Order>)
          : cancellationPartial(orderId, ticketFailure.message);
      if (failure.errorCode !== 'pos_mutation_ambiguous') {
        cancellationResultByOrderId.set(orderId, failure);
      }
      return failure;
    }
    const cancelledTicket = ticketResult.value;
    if (!cancelledTicket) {
      return cancellationAmbiguous(
        orderId,
        'POS accepted the cancellation without returning a ticket',
      );
    }
    const success = {
      ok: true,
      value: withTicket(orderResult.value, cancelledTicket),
      message: 'oms_order_and_pos_ticket_cancelled',
    } satisfies ToolResult<Order>;
    cancellationResultByOrderId.set(orderId, success);
    return success;
  };

  return {
    previewOrder: (input, externalCallContext) =>
      options.oms.previewOrder(input, externalCallContext),
    placeOrder(input, externalCallContext, mutationIdentity) {
      if (!providerMutationIdentityIsValid(mutationIdentity)) {
        return Promise.resolve(providerIdentityRequired());
      }
      let canonicalPayload: string;
      try {
        canonicalPayload = canonicalPlacementPayload(input);
      } catch (error) {
        return Promise.resolve(
          providerPayloadInvalid(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      const existingIdentity = placementIdentityByPreviewId.get(
        input.preview.id,
      );
      if (
        !bindMutationIdentity({
          identity: mutationIdentity,
          operation: 'placeOrder',
          targetId: input.preview.id,
          canonicalPayload,
          existingIdentity,
        })
      ) {
        return Promise.resolve(providerIdentityConflict());
      }
      if (!existingIdentity) {
        const storedIdentity = { ...mutationIdentity };
        placementIdentityByPreviewId.set(input.preview.id, storedIdentity);
        placementInputByPreviewId.set(
          input.preview.id,
          clonePlacementInput(input),
        );
      }
      const inFlight = placementInFlightByPreviewId.get(input.preview.id);
      if (inFlight) return inFlight;
      const terminal = resultByPreviewId.get(input.preview.id);
      if (terminal) return Promise.resolve(terminal);
      return installInFlightFence(
        placementInFlightByPreviewId,
        input.preview.id,
        () =>
          placeOrderOnce(
            placementInputByPreviewId.get(input.preview.id) ??
              clonePlacementInput(input),
            externalCallContext,
            placementIdentityByPreviewId.get(input.preview.id) ?? {
              ...mutationIdentity,
            },
          ),
      );
    },
    async getOrderStatus(orderId, externalCallContext) {
      const orderResult = await options.oms.getOrderStatus(
        orderId,
        externalCallContext,
      );
      if (!orderResult.ok || !orderResult.value) return orderResult;
      const knownTicket = ticketByOrderId.get(orderId);
      if (!knownTicket) return orderResult;
      const ticketResult = await options.pos.getTicket(
        knownTicket.id,
        externalCallContext,
      );
      if (!ticketResult.ok || !ticketResult.value) {
        return ticketResult.errorCode === 'pos_request_cancelled'
          ? {
              ok: false,
              errorCode: ticketResult.errorCode,
              message: ticketResult.message,
            }
          : orderResult;
      }
      ticketByOrderId.set(orderId, ticketResult.value);
      return {
        ok: true,
        value: withTicket(orderResult.value, ticketResult.value),
        message: 'oms_and_pos_status_found',
      };
    },
    cancelOrder(orderId, externalCallContext, mutationIdentity) {
      if (!providerMutationIdentityIsValid(mutationIdentity)) {
        return Promise.resolve(providerIdentityRequired());
      }
      const existingIdentity = cancellationIdentityByOrderId.get(orderId);
      if (
        !bindMutationIdentity({
          identity: mutationIdentity,
          operation: 'cancelOrder',
          targetId: orderId,
          canonicalPayload: canonicalJson({ orderId }),
          existingIdentity,
        })
      ) {
        return Promise.resolve(providerIdentityConflict());
      }
      if (!existingIdentity) {
        cancellationIdentityByOrderId.set(orderId, { ...mutationIdentity });
      }
      const inFlight = cancellationInFlightByOrderId.get(orderId);
      if (inFlight) return inFlight;
      const terminal = cancellationResultByOrderId.get(orderId);
      if (terminal) return Promise.resolve(terminal);
      return installInFlightFence(cancellationInFlightByOrderId, orderId, () =>
        cancelOrderOnce(
          orderId,
          externalCallContext,
          cancellationIdentityByOrderId.get(orderId) ?? { ...mutationIdentity },
        ),
      );
    },
  };
}

function withTicket(order: Order, ticket: PosTicket): Order {
  const status =
    ticket.status === 'cancelled' || ticket.status === 'rejected'
      ? 'cancelled'
      : ticket.status === 'preparing' || ticket.status === 'ready'
        ? 'preparing'
        : order.status;
  return { ...order, status, posTicketId: ticket.id, posStatus: ticket.status };
}
