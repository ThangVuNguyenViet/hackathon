import type {
  CustomerClient,
  ExternalCallContext,
} from '../clients/interfaces.js';
import type {
  Address,
  MenuItem,
  Order,
  ToolResult,
} from '../domain/types.js';
import { z } from 'zod';
import {
  providerOrderSchema,
} from '../commerce/providerResponseSchemas.js';
import type { SourceProvenance } from './types.js';

interface CustomerContextReadInput {
  customer: CustomerClient;
  customerId: string;
  externalCallContext: ExternalCallContext;
}

const responseSafeAddressSchema: z.ZodType<Address> = z.object({
  label: z.string().min(1),
  line1: z.string().min(1),
  district: z.string().min(1),
  city: z.string().min(1),
}).strip();

const responseSafeFavoriteItemSchema: z.ZodType<MenuItem> = z.object({
  code: z.string().min(1),
  category: z.string(),
  categoryId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  priceVnd: z.number().int().nonnegative(),
  originalPriceVnd: z.number().int().nonnegative().nullable(),
  imageUrl: z.string(),
  available: z.boolean(),
}).strip();

const responseSafeRecentOrderSchema: z.ZodType<Order | null> =
  providerOrderSchema.nullable().transform((order): Order | null => {
    if (!order) return null;
    return {
      id: order.id,
      cart: {
        id: order.cart.id,
        items: order.cart.items.map((item) => ({
          itemCode: item.itemCode,
          name: item.name,
          quantity: item.quantity,
          unitPriceVnd: item.unitPriceVnd,
          ...(item.modifiers
            ? {
                modifiers: item.modifiers.map((modifier) => ({
                  groupId: modifier.groupId,
                  groupName: modifier.groupName,
                  modifierId: modifier.modifierId,
                  modifierName: modifier.modifierName,
                  quantity: modifier.quantity,
                  priceDeltaVnd: modifier.priceDeltaVnd,
                })),
              }
            : {}),
        })),
        subtotalVnd: order.cart.subtotalVnd,
        discountVnd: order.cart.discountVnd,
        deliveryFeeVnd: order.cart.deliveryFeeVnd,
        totalVnd: order.cart.totalVnd,
        voucherCode: order.cart.voucherCode,
      },
      status: order.status,
      paymentStatus: order.paymentStatus,
      assignedStoreId: order.assignedStoreId,
      createdAt: order.createdAt,
    };
  });

const customerContextProviderProvenance = {
  getSavedAddresses: {
    fixtureMode: 'provider_runtime',
    sourceFile: 'src/ordering/customerContextReadTools.ts',
    sourceApi: 'customer-context-provider:getSavedAddresses',
  },
  getRecentOrder: {
    fixtureMode: 'provider_runtime',
    sourceFile: 'src/ordering/customerContextReadTools.ts',
    sourceApi: 'customer-context-provider:getRecentOrder',
  },
  getFavoriteItems: {
    fixtureMode: 'provider_runtime',
    sourceFile: 'src/ordering/customerContextReadTools.ts',
    sourceApi: 'customer-context-provider:getFavoriteItems',
  },
} as const satisfies Record<string, SourceProvenance>;

function controlledProviderResult<Value>(
  response: ToolResult<unknown>,
  schema: z.ZodType<Value>,
  successMessage: (value: Value) => string,
  provenance: SourceProvenance,
): ToolResult<Value> {
  if (!response.ok) {
    return {
      ok: false,
      errorCode: 'customer_context_provider_failed',
      message: 'Authenticated customer-context lookup failed',
      provenance: [provenance],
    };
  }
  if (response.value === undefined) {
    return {
      ok: false,
      errorCode: 'customer_context_result_missing',
      message: 'Authenticated customer-context lookup returned no typed result',
      provenance: [provenance],
    };
  }
  const parsed = schema.safeParse(response.value);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: 'customer_context_result_invalid',
      message:
        'Authenticated customer-context lookup returned an invalid result',
      provenance: [provenance],
    };
  }
  return {
    ok: true,
    value: parsed.data,
    message: successMessage(parsed.data),
    provenance: [provenance],
  };
}

async function controlledCustomerRead<Value>(
  input: CustomerContextReadInput,
  read: () => Promise<ToolResult<unknown>>,
  schema: z.ZodType<Value>,
  successMessage: (value: Value) => string,
  provenance: SourceProvenance,
): Promise<ToolResult<Value>> {
  try {
    return controlledProviderResult(
      await read(),
      schema,
      successMessage,
      provenance,
    );
  } catch {
    const cancelled =
      input.externalCallContext.signal.aborted ||
      Date.now() >= input.externalCallContext.deadlineAt;
    return cancelled
      ? {
          ok: false,
          errorCode: 'agent_tool_execution_cancelled',
          message: 'External tool execution was cancelled during dispatch',
          provenance: [provenance],
        }
      : {
          ok: false,
          errorCode: 'customer_context_provider_failed',
          message: 'Authenticated customer-context lookup failed',
          provenance: [provenance],
        };
  }
}

export async function readCustomerSavedAddresses(
  input: CustomerContextReadInput,
): Promise<ToolResult<Address[]>> {
  return controlledCustomerRead(
    input,
    () => input.customer.getSavedAddresses(
      input.customerId,
      input.externalCallContext,
    ),
    z.array(responseSafeAddressSchema),
    (addresses) =>
      `Retrieved ${addresses.length} verified saved-address record(s)`,
    customerContextProviderProvenance.getSavedAddresses,
  );
}

export async function readCustomerRecentOrder(
  input: CustomerContextReadInput,
): Promise<ToolResult<Order | null>> {
  return controlledCustomerRead(
    input,
    () => input.customer.getRecentOrder(
      input.customerId,
      input.externalCallContext,
    ),
    responseSafeRecentOrderSchema,
    (order) =>
      order
        ? 'Retrieved one verified recent-order record'
        : 'No verified recent-order record is available',
    customerContextProviderProvenance.getRecentOrder,
  );
}

export async function readCustomerFavoriteItems(
  input: CustomerContextReadInput,
): Promise<ToolResult<MenuItem[]>> {
  return controlledCustomerRead(
    input,
    () => input.customer.getFavoriteItems(
      input.customerId,
      input.externalCallContext,
    ),
    z.array(responseSafeFavoriteItemSchema),
    (items) => `Retrieved ${items.length} verified favorite-item record(s)`,
    customerContextProviderProvenance.getFavoriteItems,
  );
}
