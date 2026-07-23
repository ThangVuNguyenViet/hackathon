import type { ExternalClients } from '../clients/interfaces.js';
import type { Cart } from '../domain/types.js';
import {
  EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
  authorizeExactCartAvailability,
  exactCartAvailabilityObservationV2Schema,
  exactCartAvailabilityRevision,
  type ExactCartAvailabilityObservationV2,
  type ExactCartAvailabilityProtectedAction,
  type InventoryAvailabilityProviderRevisionV2,
} from './exactCartAvailabilityAuthority.js';
import { agentToolArgumentSchemas } from './toolCatalog.js';
import {
  externalCallCancelledErrorCode,
  externalCallIsCancelled,
  type ExecutorContext,
} from './toolExecutor.js';
import type {
  AgentToolCallFailure,
  InventoryAvailabilityAuthority,
  ToolCallRequest,
} from './types.js';

type AvailabilityContext = Pick<
  ExecutorContext,
  'cart' | 'externalCallContext' | 'state'
>;

function failure(
  request: ToolCallRequest,
  message: string,
  errorCode: string,
): AgentToolCallFailure {
  return {
    toolName: request.toolName,
    ok: false,
    message,
    errorCode,
    provenance: [],
  };
}

function currentCart(context: AvailabilityContext): Cart | undefined {
  return context.cart ?? context.state?.cart;
}

export function bindExactCartAvailabilityCheck(input: {
  request: ToolCallRequest;
  context: AvailabilityContext;
}): ToolCallRequest | AgentToolCallFailure {
  const cart = currentCart(input.context);
  if (!cart || cart.items.length === 0) {
    return failure(
      input.request,
      'A non-empty verified cart is required',
      'cart_required',
    );
  }
  const parsed =
    agentToolArgumentSchemas.checkStoreAvailability.safeParse(
      input.request.arguments,
    );
  if (!parsed.success || !parsed.data.disposition) {
    return failure(
      input.request,
      'An exact pickup or delivery disposition is required',
      'cart_availability_active_disposition_required',
    );
  }
  const fulfillment = input.context.state?.fulfillment;
  if (!fulfillment?.storeId) {
    return failure(
      input.request,
      'An active verified fulfillment store is required',
      'cart_availability_active_store_required',
    );
  }
  if (parsed.data.storeId !== fulfillment.storeId) {
    return failure(
      input.request,
      'Availability store does not match active fulfillment',
      'cart_availability_store_mismatch',
    );
  }
  if (parsed.data.disposition !== fulfillment.disposition) {
    return failure(
      input.request,
      'Availability disposition does not match active fulfillment',
      'cart_availability_disposition_mismatch',
    );
  }
  return {
    toolName: 'checkStoreAvailability',
    arguments: {
      storeId: parsed.data.storeId,
      itemCodes: [...new Set(cart.items.map(({ itemCode }) => itemCode))],
      disposition: parsed.data.disposition,
    },
  };
}

async function currentInventoryAvailabilityRevision(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AvailabilityContext,
): Promise<
  InventoryAvailabilityProviderRevisionV2 | AgentToolCallFailure
> {
  if (!clients.inventory.getAvailabilityRevision) {
    return failure(
      request,
      'Inventory availability authority is unavailable',
      'inventory_availability_authority_unavailable',
    );
  }
  if (externalCallIsCancelled(context.externalCallContext)) {
    return failure(
      request,
      'External tool execution was cancelled before inventory authority read',
      externalCallCancelledErrorCode,
    );
  }
  const result = await clients.inventory.getAvailabilityRevision(
    context.externalCallContext,
  );
  if (
    !result.ok ||
    typeof result.value !== 'string' ||
    result.value.trim().length === 0
  ) {
    return failure(
      request,
      result.ok
        ? 'Inventory availability authority returned an invalid revision'
        : result.message,
      'inventory_availability_authority_unavailable',
    );
  }
  if (externalCallIsCancelled(context.externalCallContext)) {
    return failure(
      request,
      'External tool execution was cancelled during inventory authority read',
      externalCallCancelledErrorCode,
    );
  }
  return {
    authority: 'inventory_availability',
    revision: result.value,
  };
}

export async function authorizeProtectedCartAvailability(input: {
  clients: ExternalClients;
  request: ToolCallRequest;
  context: AvailabilityContext;
  action: ExactCartAvailabilityProtectedAction;
}): Promise<AgentToolCallFailure | undefined> {
  const inventoryRevision = await currentInventoryAvailabilityRevision(
    input.clients,
    input.request,
    input.context,
  );
  if ('ok' in inventoryRevision) return inventoryRevision;
  const state = input.context.state;
  const decision = await authorizeExactCartAvailability({
    action: input.action,
    cart: currentCart(input.context),
    observation: state?.exactCartAvailabilityObservation,
    activeStoreId: state?.fulfillment?.storeId,
    activeDisposition: state?.fulfillment?.disposition,
    activeInventoryProviderRevision: inventoryRevision,
    nowMs: Date.now(),
  });
  return decision.ok
    ? undefined
    : failure(
        input.request,
        'Exact current-cart availability is not authorized',
        decision.errorCode,
      );
}

export async function captureExactCartAvailabilityObservation(input: {
  request: ToolCallRequest;
  context: AvailabilityContext;
  availability: Record<string, boolean>;
  authority: InventoryAvailabilityAuthority | undefined;
}): Promise<
  ExactCartAvailabilityObservationV2 | AgentToolCallFailure
> {
  const cart = currentCart(input.context);
  const parsed = agentToolArgumentSchemas.checkStoreAvailability.safeParse(
    input.request.arguments,
  );
  if (!cart || !parsed.success || !parsed.data.disposition) {
    return failure(
      input.request,
      'Exact availability observation inputs are missing',
      'cart_availability_observation_invalid',
    );
  }
  if (!input.authority) {
    return failure(
      input.request,
      'Atomic inventory availability authority is unavailable',
      'inventory_availability_authority_unavailable',
    );
  }
  const observation = {
    schemaVersion:
      EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
    observationId: crypto.randomUUID(),
    cartRevision: await exactCartAvailabilityRevision(cart),
    storeId: parsed.data.storeId,
    disposition: parsed.data.disposition,
    inventoryProviderRevision: {
      authority: 'inventory_availability' as const,
      revision: input.authority.providerRevision,
    },
    observedAt: input.authority.observedAt,
    expiresAt: input.authority.expiresAt,
    complete: true,
    rows: cart.items.map((item) => ({
      itemCode: item.itemCode,
      quantity: item.quantity,
      status: input.availability[item.itemCode] === true
        ? 'available'
        : 'unavailable',
    })),
  };
  const validated =
    exactCartAvailabilityObservationV2Schema.safeParse(observation);
  if (
    !validated.success ||
    Date.parse(validated.data.observedAt) >=
      Date.parse(validated.data.expiresAt)
  ) {
    return failure(
      input.request,
      'Atomic inventory availability authority is invalid',
      'cart_availability_observation_invalid',
    );
  }
  return validated.data;
}
