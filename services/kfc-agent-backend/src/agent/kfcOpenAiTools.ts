import { createHash } from 'node:crypto';
import {
  RunContext,
  tool,
  type FunctionTool,
} from '@kfc/openai-agents-runtime';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../clients/interfaces.js';
import type {
  Address,
  Channel,
  CustomerAccessContext,
  DeliveryAdministrativeOptions,
  DeliveryAddressDraft,
  DeliveryAddressRequiredField,
  Order,
} from '../domain/types.js';
import { deliveryAddressRequiredFields } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { SelectedPaymentMethodAuthority } from '../domain/opaqueProviderId.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  agentToolArgumentSchemas,
  toolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import {
  classifyToolSideEffect,
  executeToolCall,
  type ExecutorContext,
} from '../ordering/toolExecutor.js';
import { adaptAgentToolResult } from '../ordering/agentToolResultAdapter.js';
import { replaceVerifiedCollection } from '../ordering/verifiedCollections.js';
import type {
  CartWithModifiers,
  FulfillmentState,
  HandoffState,
  PaymentAttempt,
  ToolCallResult,
  ToolName,
} from '../ordering/types.js';
import {
  activeSupportedPaymentMethod,
  selectedPaymentMethodAuthority,
} from '../ordering/paymentMethodAuthority.js';
import type {
  OpenAiKfcAgentLifecycleObserver,
  OpenAiToolCallTrace,
} from './openAiKfcAgent.js';

export interface KfcCanonicalToolDefinition {
  type: 'function';
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

/** Domain executor contract, adapted once into the official SDK tool surface. */
export interface KfcCanonicalTool {
  definition: KfcCanonicalToolDefinition;
  execute(
    arguments_: Record<string, unknown>,
    options?: { signal: AbortSignal; deadlineAt: number },
  ): Promise<unknown>;
}

export interface KfcOpenAiAgentRunContext {
  toolCalls: OpenAiToolCallTrace[];
  developerMessages: string[];
  toolStartedAt?: Map<string, number>;
  lifecycle?: OpenAiKfcAgentLifecycleObserver;
}

function safeSdkToolFailure(
  errorCode: 'invalid_tool_input' | 'tool_execution_failed' | 'tool_timed_out',
) {
  return {
    ok: false,
    errorCode,
    message: 'The requested action could not be completed safely.',
  };
}

function canonicalArgumentSchema(name: string): z.ZodTypeAny | undefined {
  if (name === 'updateCart') {
    return directUpdateCartArgumentsSchema;
  }
  if (name === 'quoteFulfillment') return directQuoteFulfillmentArgumentsSchema;
  if (name === 'acquireVoucher' || name === 'redeemReward') {
    return (agentToolArgumentSchemas as Record<string, z.ZodTypeAny>)[name];
  }
  return (
    (toolArgumentSchemas as Record<string, z.ZodTypeAny>)[name] ??
    (agentToolArgumentSchemas as Record<string, z.ZodTypeAny>)[name]
  );
}

function isKfcRunContext(
  value: unknown,
): value is RunContext<KfcOpenAiAgentRunContext> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'context' in value &&
    typeof value.context === 'object' &&
    value.context !== null &&
    'toolCalls' in value.context &&
    Array.isArray(value.context.toolCalls)
  );
}

function recordSafeSdkFailure(input: {
  runContext: unknown;
  toolName: string;
  errorCode: 'invalid_tool_input' | 'tool_execution_failed' | 'tool_timed_out';
}): string {
  const result = safeSdkToolFailure(input.errorCode);
  if (isKfcRunContext(input.runContext)) {
    input.runContext.context.toolCalls.push({
      name: input.toolName,
      arguments: {},
      result,
    });
  }
  return JSON.stringify(result);
}

function isSdkToolArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converts the canonical KFC tool contract into official Agents SDK function
 * tools. Executors and evidence remain per-turn state on RunContext.
 */
export function createKfcOpenAiAgentsTools(
  tools: readonly KfcCanonicalTool[],
  options: { timeoutMs?: number } = {},
): FunctionTool<KfcOpenAiAgentRunContext>[] {
  return tools.map((canonicalTool) =>
    tool({
      name: canonicalTool.definition.name,
      description: canonicalTool.definition.description,
      // SDK 0.13.5's strict-schema converter throws DataCloneError for some
      // legacy Zod 3 unions/defaults. Keep the canonical JSON Schema at the
      // provider boundary and parse the exact Zod schema before execution.
      parameters: canonicalTool.definition.parameters as never,
      strict: true,
      errorFunction: (runContext, error) =>
        recordSafeSdkFailure({
          runContext,
          toolName: canonicalTool.definition.name,
          errorCode:
            error instanceof Error && error.name === 'InvalidToolInputError'
              ? 'invalid_tool_input'
              : 'tool_execution_failed',
        }),
      async execute(
        arguments_,
        runContext?: RunContext<KfcOpenAiAgentRunContext>,
      ) {
        if (!runContext) {
          throw new Error('KFC tool is missing its run context');
        }
        if (!isSdkToolArguments(arguments_)) {
          throw new Error('Tool arguments must be a JSON object');
        }
        const validation = canonicalArgumentSchema(
          canonicalTool.definition.name,
        )?.safeParse(arguments_);
        if (validation && !validation.success) {
          const result = safeSdkToolFailure('invalid_tool_input');
          runContext.context.toolCalls.push({
            name: canonicalTool.definition.name,
            arguments: {},
            result,
          });
          return result;
        }
        const trace: OpenAiToolCallTrace = {
          name: canonicalTool.definition.name,
          arguments: validation?.data ?? arguments_,
          result: undefined,
        };
        runContext.context.toolCalls.push(trace);
        const abortController = new AbortController();
        const localDeadlineAt = Date.now() + (options.timeoutMs ?? 120_000);
        const argumentsForExecution = validation?.data ?? arguments_;
        const sideEffect = classifyToolSideEffect(
          canonicalTool.definition.name,
          argumentsForExecution,
        );
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const execution = canonicalTool.execute(
            argumentsForExecution,
            sideEffect === 'irreversible'
              ? undefined
              : {
                  signal: abortController.signal,
                  deadlineAt: localDeadlineAt,
                },
          );
          if (sideEffect === 'irreversible') {
            const result = await execution;
            trace.result = result;
            return result;
          }
          const timedOut = Symbol('kfc_tool_timed_out');
          const timeout = new Promise<typeof timedOut>((resolve) => {
            timeoutId = setTimeout(
              () => resolve(timedOut),
              options.timeoutMs ?? 120_000,
            );
          });
          const result = await Promise.race([execution, timeout]);
          if (
            result === timedOut ||
            (isRecord(result) &&
              result.errorCode === 'agent_tool_execution_cancelled')
          ) {
            abortController.abort();
            const safe = safeSdkToolFailure('tool_timed_out');
            trace.result = safe;
            return safe;
          }
          trace.result = result;
          return result;
        } catch {
          const result = safeSdkToolFailure('tool_execution_failed');
          trace.result = result;
          return result;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      },
    }),
  );
}

export interface KfcToolSession {
  sessionId: string;
  customerId: string;
  channel: Channel;
  cart: CartWithModifiers;
  address?: Address;
  deliveryAddressDraft?: DeliveryAddressDraft;
  deliveryAddressStatus?: 'incomplete' | 'unsupported' | 'quoted';
  deliveryAddressMissingFields?: DeliveryAddressRequiredField[];
  deliveryAdministrativeOptions?: DeliveryAdministrativeOptions;
  fulfillment?: FulfillmentState;
  orderPreview?: Order;
  order?: Order;
  selectedPaymentMethod?: SelectedPaymentMethodAuthority;
  paymentAttempt?: PaymentAttempt;
  handoff?: HandoffState;
  activeCollectionKeys?: AgentGraphState['activeCollectionKeys'];
  verifiedCollections?: AgentGraphState['verifiedCollections'];
  externalCallContext: ExternalCallContext;
  toolCallSequence: number;
}

export interface CreateKfcOpenAiToolsInput {
  clients: ExternalClients;
  sessionState: KfcToolSessionState;
  accessContext?: CustomerAccessContext;
  fixtures?: Pick<
    GeneratedFixtures,
    'administrativeDivisions' | 'administrativeLegacyMappings' | 'menuItems'
  >;
}

export interface KfcToolSessionState {
  current: KfcToolSession;
}

export function hydrateKfcToolSession(
  session: KfcToolSession,
  state: Partial<
    Pick<
      KfcToolSession,
      | 'cart'
      | 'address'
      | 'deliveryAddressDraft'
      | 'deliveryAddressStatus'
      | 'deliveryAddressMissingFields'
      | 'deliveryAdministrativeOptions'
      | 'fulfillment'
      | 'orderPreview'
      | 'order'
      | 'selectedPaymentMethod'
      | 'paymentAttempt'
      | 'handoff'
      | 'activeCollectionKeys'
      | 'verifiedCollections'
    >
  >,
): KfcToolSession {
  return {
    ...session,
    ...(state.cart ? { cart: state.cart } : {}),
    ...(state.address ? { address: state.address } : {}),
    ...(state.deliveryAddressDraft
      ? { deliveryAddressDraft: state.deliveryAddressDraft }
      : {}),
    ...(state.deliveryAddressStatus
      ? { deliveryAddressStatus: state.deliveryAddressStatus }
      : {}),
    ...(state.deliveryAddressStatus === 'incomplete' &&
    state.deliveryAddressMissingFields
      ? {
          deliveryAddressMissingFields: state.deliveryAddressMissingFields,
        }
      : state.deliveryAddressStatus === 'quoted' ||
          state.deliveryAddressStatus === 'unsupported'
        ? { deliveryAddressMissingFields: [] }
        : {}),
    ...(state.deliveryAdministrativeOptions
      ? {
          deliveryAdministrativeOptions: state.deliveryAdministrativeOptions,
        }
      : {}),
    ...(state.fulfillment ? { fulfillment: state.fulfillment } : {}),
    ...(state.orderPreview ? { orderPreview: state.orderPreview } : {}),
    ...(state.order ? { order: state.order } : {}),
    ...(state.selectedPaymentMethod
      ? { selectedPaymentMethod: state.selectedPaymentMethod }
      : {}),
    ...(state.paymentAttempt ? { paymentAttempt: state.paymentAttempt } : {}),
    ...(state.handoff ? { handoff: state.handoff } : {}),
    ...(state.activeCollectionKeys
      ? { activeCollectionKeys: state.activeCollectionKeys }
      : {}),
    ...(state.verifiedCollections
      ? { verifiedCollections: state.verifiedCollections }
      : {}),
  };
}

export function verifiedKfcToolSessionContext(
  session: KfcToolSession,
): Record<string, unknown> | undefined {
  const context = {
    membershipActions: {
      executionMode: 'available',
      acquisitionSupported: true,
      redemptionSupported: true,
    },
    ...(session.cart.items.length > 0 ? { cart: session.cart } : {}),
    ...(session.address ? { address: session.address } : {}),
    ...(session.deliveryAddressDraft
      ? { deliveryAddressDraft: session.deliveryAddressDraft }
      : {}),
    ...(session.deliveryAddressStatus
      ? { deliveryAddressStatus: session.deliveryAddressStatus }
      : {}),
    ...(session.deliveryAddressStatus === 'incomplete' &&
    session.deliveryAddressMissingFields?.length
      ? {
          deliveryAddressMissingFields: session.deliveryAddressMissingFields,
        }
      : {}),
    ...(session.fulfillment ? { fulfillment: session.fulfillment } : {}),
    ...(session.orderPreview ? { orderPreview: session.orderPreview } : {}),
    ...(session.order ? { order: session.order } : {}),
    ...(session.selectedPaymentMethod
      ? { selectedPaymentMethod: session.selectedPaymentMethod }
      : {}),
    ...(session.paymentAttempt
      ? { paymentAttempt: session.paymentAttempt }
      : {}),
    ...(session.handoff
      ? {
          humanSupport: {
            status: 'queued',
            description: 'awaiting a human operator',
          },
        }
      : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

const descriptions: Record<ToolName, string> = {
  searchMenu:
    'Search verified fixture menu data. query searches product text including names, descriptions, categories, and fixture aliases. category is one exact category filter copied from a returned item.category value; omit category when that exact value is not known. modifierQueries are independent terms for selectable options that must match the same item; use option wording rather than inferred product semantics, and matchedModifiers reports the verified option evidence. maxPriceVnd is a per-item price ceiling. partySize is ranking evidence and does not guarantee serving size. mode "full" returns the complete available menu; mode "search" ranks matching items. Returned product facts, prices, availability, and modifier matches come from verified fixture data; available false means the item cannot currently be ordered. An empty result means only that the supplied arguments returned no matches.',
  getItemDetails:
    'Get verified name, description, category, base price, and current availability for one KFC menu item code. Treat available false as unavailable to order.',
  getModifierOptions:
    'Get the verified selectable modifier tree for one menu item code. Every returned name, attribute, identifier, and price belongs only to its exact option and branch; do not transfer facts between branches or items. priceDeltaVnd is the authoritative modifier price delta; do not infer a modifier price from the base item price. Missing modifier data means unknown; absence of a choice does not prove an ingredient, taste, or allergen property.',
  updateCart:
    'Set the absolute requested quantity for one or more verified menu items in the current cart. Items not listed remain unchanged. orderedMenuItemQuantity is the number of menu portions, not the number of pieces described inside an item; quantity 0 removes that item. Listed changes are applied together and the returned cart is the authoritative current cart with verified prices and totals. Modifier identifiers and quantities apply per menu portion and must match verified selectable options. This is a reversible, idempotent absolute-quantity update.',
  previewCart: 'Read the current cart with verified prices and totals.',
  recommendAddOns:
    'Return verified add-on candidates for the current cart without changing it.',
  findStores:
    'Find verified KFC stores by query, city, or district. Store results do not verify delivery coverage, fee, ETA, or cart serviceability.',
  checkStoreAvailability:
    'Check whether the current cart items are available at one exact store for pickup or delivery. This verifies item availability only; it does not verify delivery fee or ETA.',
  quoteFulfillment:
    'Merge supplied delivery fields into the current address draft and quote the exact current cart when required details are complete. Null fields mean not supplied in this update; prior verified fields are retained. Recipient name, phone, and a free-form address line are sufficient; province and commune are optional, and this fixture accepts every supplied address. The result is incomplete with missingFields or quoted; only a successful quoted result verifies serviceability, fee, ETA, store, and cart availability. This operation does not place an order.',
  searchPromotions:
    'Search the current verified promotion and voucher catalog. An empty query lists the catalog; a non-empty query filters it. An empty result means only that the supplied query returned no matches.',
  explainPromotion: 'Explain one promotion using its offer ID.',
  validateVoucher: 'Validate a voucher against the current cart subtotal.',
  getMembershipProfile:
    'Read the authenticated fixture customer membership profile.',
  listMembershipRewards:
    'Read the membership reward catalog with the verified currentPoints balance and per-reward canAcquireNow and pointsShortfall fields. Catalog presence alone does not mean the customer can acquire a reward now; only canAcquireNow true verifies current points eligibility.',
  listMembershipWallet:
    'List vouchers in the fixture customer membership wallet.',
  getMembershipPointHistory:
    'Read membership point history for the fixture customer.',
  listMembershipTools:
    'List discovered membership capabilities and whether each capability is available in the current runtime.',
  listPaymentMethods:
    'List verified KFC payment methods, optionally filtered by customer-facing name. Returned methodId values are the only supported identifiers for payment-link creation.',
  getSavedAddresses:
    'Read saved delivery addresses for the authenticated customer.',
  getRecentOrder: 'Read the authenticated customer’s most recent order.',
  getFavoriteItems: 'Read the authenticated customer’s favorite menu items.',
  acquireVoucher:
    'Acquire one verified membership reward by exact rewardId. The server supplies confirmation and mutation identity. Only a completed result verifies acquisition.',
  redeemReward:
    'Redeem one verified wallet voucher by exact voucherId and channel. The server supplies confirmation and mutation identity. Only a completed result verifies redemption.',
  searchContentPolicy:
    'Search approved KFC policy, promotion, news, or allergen knowledge.',
  answerAllergenQuestion: 'Search approved KFC allergen knowledge.',
  previewOrder:
    'Create a verified order preview from the current cart and fulfillment quote without placing the order.',
  placeOrder:
    'Place the current fixture order from its verified preview. Provider mutation identity makes repeated execution idempotent.',
  getOrderStatus:
    'Read the latest verified status for the current order. Describe status, timing, or fulfillment progress using only fields returned by this call.',
  createPaymentLink:
    'Create a fixture payment link for the placed order using an exact supported methodId from the active verified payment-method collection.',
  checkPaymentStatus: 'Read the current fixture payment status.',
  collectInvoice:
    'Record supplied invoice fields for the current order. Missing optional fields remain unset. The result reports any missing required fields. This does not place or modify the order.',
  handoff:
    'Queue the conversation for a human operator. A successful result means the request is queued and awaiting a human; it does not mean a human accepted or joined. If a handoff is already queued, this returns that same verified escalation without creating another.',
  resolveHandoff: 'Resolve an existing human-support escalation.',
};

const directUpdateCartJsonSchema = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          itemCode: {
            type: 'string',
            minLength: 1,
            description:
              'Exact verified menu item code returned by a menu tool.',
          },
          orderedMenuItemQuantity: {
            type: 'integer',
            minimum: 0,
            description:
              'How many times the customer is buying this named menu item. This is not the pieces inside it. Example: one portion of an item whose name says it has two pieces means orderedMenuItemQuantity 1; use 0 to remove the menu item.',
          },
          modifiers: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              properties: {
                groupId: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'Exact verified modifier group identifier from getModifierOptions.',
                },
                modifierId: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'Exact verified modifier option identifier from getModifierOptions.',
                },
                quantityPerPortion: {
                  type: ['integer', 'null'],
                  minimum: 1,
                  description:
                    'Selected modifier quantity per menu portion, not the cart line quantity.',
                },
              },
              required: ['groupId', 'modifierId', 'quantityPerPortion'],
              additionalProperties: false,
            },
          },
        },
        required: ['itemCode', 'orderedMenuItemQuantity', 'modifiers'],
        additionalProperties: false,
      },
    },
  },
  required: ['changes'],
  additionalProperties: false,
} as const;

const directUpdateCartArgumentsSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            itemCode: z.string().min(1),
            orderedMenuItemQuantity: z.number().int().nonnegative(),
            modifiers: z
              .array(
                z
                  .object({
                    groupId: z.string().min(1),
                    modifierId: z.string().min(1),
                    quantityPerPortion: z.number().int().positive().nullable(),
                  })
                  .strict(),
              )
              .nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonSchemaFor(toolName: ToolName): Record<string, unknown> {
  if (toolName === 'quoteFulfillment') {
    return directQuoteFulfillmentJsonSchema;
  }
  if (toolName === 'updateCart') {
    return directUpdateCartJsonSchema;
  }
  const schemaSource =
    toolName === 'acquireVoucher' || toolName === 'redeemReward'
      ? agentToolArgumentSchemas[toolName]
      : toolArgumentSchemas[toolName];
  const schema = zodToJsonSchema(schemaSource, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  const { $schema: _schemaVersion, ...parameters } = schema;
  return parameters;
}

function canonicalUpdateCartArguments(
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(arguments_.changes)) return arguments_;
  const modelFacing = arguments_.changes.some(
    (change) =>
      isRecord(change) && Object.hasOwn(change, 'orderedMenuItemQuantity'),
  );
  if (!modelFacing) return arguments_;
  return {
    changes: arguments_.changes.map((change) => {
      if (!isRecord(change)) return change;
      return {
        itemCode: change.itemCode,
        quantity: change.orderedMenuItemQuantity,
        ...(Array.isArray(change.modifiers)
          ? {
              modifiers: change.modifiers.map((modifier) => {
                if (!isRecord(modifier)) return modifier;
                return {
                  groupId: modifier.groupId,
                  modifierId: modifier.modifierId,
                  ...(modifier.quantityPerPortion === undefined ||
                  modifier.quantityPerPortion === null
                    ? {}
                    : { quantity: modifier.quantityPerPortion }),
                };
              }),
            }
          : {}),
      };
    }),
  };
}

export function directAgentToolArguments(
  toolName: ToolName,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== 'updateCart' || !Array.isArray(arguments_.changes)) {
    return arguments_;
  }
  return {
    changes: arguments_.changes.map((change) => {
      if (!isRecord(change)) return change;
      return {
        itemCode: change.itemCode,
        orderedMenuItemQuantity:
          change.orderedMenuItemQuantity ?? change.quantity,
        modifiers: Array.isArray(change.modifiers)
          ? change.modifiers.map((modifier) => {
              if (!isRecord(modifier)) return modifier;
              return {
                groupId: modifier.groupId,
                modifierId: modifier.modifierId,
                quantityPerPortion:
                  modifier.quantityPerPortion ?? modifier.quantity ?? null,
              };
            })
          : null,
      };
    }),
  };
}

const nullableAddressFieldSchema = {
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
} as const;

const directAddressFieldNames = [
  'recipientName',
  'phone',
  'addressLine',
  'provinceCode',
  'provinceName',
  'communeCode',
  'communeName',
  'deliveryInstructions',
  'rawAddress',
  'legacyDistrictText',
] as const;

const directQuoteFulfillmentJsonSchema = {
  type: 'object',
  properties: {
    address: {
      type: 'object',
      properties: Object.fromEntries(
        directAddressFieldNames.map((field) => [
          field,
          nullableAddressFieldSchema,
        ]),
      ),
      required: [...directAddressFieldNames],
      additionalProperties: false,
    },
    method: { type: 'string', enum: ['pickup', 'delivery'] },
  },
  required: ['address', 'method'],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const nullableTrimmedString = z.string().trim().min(1).max(500).nullable();

const directDeliveryAddressUpdateSchema = z
  .object({
    recipientName: nullableTrimmedString,
    phone: nullableTrimmedString,
    addressLine: nullableTrimmedString,
    provinceCode: nullableTrimmedString,
    provinceName: nullableTrimmedString,
    communeCode: nullableTrimmedString,
    communeName: nullableTrimmedString,
    deliveryInstructions: nullableTrimmedString,
    rawAddress: nullableTrimmedString,
    legacyDistrictText: nullableTrimmedString,
  })
  .strict();

const directQuoteFulfillmentArgumentsSchema = z
  .object({
    address: directDeliveryAddressUpdateSchema,
    method: z.enum(['pickup', 'delivery']),
  })
  .strict();

export type DirectQuoteFulfillmentValue =
  | {
      status: 'incomplete';
      addressDraft: DeliveryAddressDraft;
      missingFields: DeliveryAddressRequiredField[];
    }
  | {
      status: 'unsupported';
      addressDraft: DeliveryAddressDraft;
      missingFields: [];
    }
  | {
      status: 'quoted';
      addressDraft: DeliveryAddressDraft;
      missingFields: [];
      fulfillment: FulfillmentState;
    };

function mergeDeliveryAddressDraft(
  current: DeliveryAddressDraft | undefined,
  update: z.infer<typeof directDeliveryAddressUpdateSchema>,
): DeliveryAddressDraft {
  const merged: DeliveryAddressDraft = { ...current };
  for (const field of directAddressFieldNames) {
    const value = update[field];
    if (value !== null) merged[field] = value;
  }
  return merged;
}

function missingDeliveryAddressFields(
  draft: DeliveryAddressDraft,
): DeliveryAddressRequiredField[] {
  return deliveryAddressRequiredFields.filter((field) => !draft[field]?.trim());
}

function administrativeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(?:thanh pho|tp|tinh)\s+/u, '');
}

function administrativeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchesAdministrativeFixtureName(
  value: string,
  primary: string,
  aliases: readonly string[],
): boolean {
  const key = administrativeKey(value);
  return [primary, ...aliases].some(
    (candidate) => administrativeKey(candidate) === key,
  );
}

function addressTextContainsAdministrativeName(
  addressText: readonly (string | undefined)[],
  primary: string | undefined,
  aliases: readonly string[],
): boolean {
  return addressText.some((value) => {
    if (!value) return false;
    const haystack = ` ${administrativeSearchText(value)} `;
    return (primary ? [primary, ...aliases] : aliases).some((candidate) => {
      const needle = administrativeSearchText(candidate);
      return needle.length > 0 && haystack.includes(` ${needle} `);
    });
  });
}

function resolveAdministrativeDraft(input: {
  draft: DeliveryAddressDraft;
  fixtures?: Pick<
    GeneratedFixtures,
    'administrativeDivisions' | 'administrativeLegacyMappings'
  >;
}): {
  draft: DeliveryAddressDraft;
  invalidFields: DeliveryAddressRequiredField[];
  options?: DeliveryAdministrativeOptions;
} {
  if (!input.fixtures) {
    return { draft: input.draft, invalidFields: [] };
  }
  const { administrativeDivisions, administrativeLegacyMappings } =
    input.fixtures;
  const draft = { ...input.draft };
  const legacyCandidates = administrativeLegacyMappings.filter((mapping) => {
    const provinceMatches =
      (draft.provinceName
        ? matchesAdministrativeFixtureName(
            draft.provinceName,
            mapping.legacyProvince,
            mapping.legacyProvinceAliases,
          )
        : false) ||
      addressTextContainsAdministrativeName(
        [draft.rawAddress, draft.addressLine],
        mapping.legacyProvince,
        mapping.legacyProvinceAliases,
      );
    const communeMatches =
      (draft.communeName
        ? matchesAdministrativeFixtureName(
            draft.communeName,
            mapping.legacyCommune,
            mapping.legacyCommuneAliases,
          )
        : false) ||
      addressTextContainsAdministrativeName(
        [draft.rawAddress, draft.addressLine],
        mapping.legacyCommune,
        mapping.legacyCommuneAliases,
      );
    const districtMatches = draft.legacyDistrictText
      ? !mapping.legacyDistrict ||
        matchesAdministrativeFixtureName(
          draft.legacyDistrictText,
          mapping.legacyDistrict,
          mapping.legacyDistrictAliases,
        )
      : (!draft.rawAddress && !draft.addressLine) ||
        !mapping.legacyDistrict ||
        addressTextContainsAdministrativeName(
          [draft.rawAddress, draft.addressLine],
          mapping.legacyDistrict,
          mapping.legacyDistrictAliases,
        );
    return provinceMatches && communeMatches && districtMatches;
  });
  if (legacyCandidates.length === 1) {
    draft.provinceCode = legacyCandidates[0]!.canonicalProvinceCode;
    draft.communeCode = legacyCandidates[0]!.canonicalCommuneCode;
  }

  const province =
    (draft.provinceCode
      ? administrativeDivisions.provinces.find(
          ({ code }) => code === draft.provinceCode,
        )
      : undefined) ??
    (draft.provinceName
      ? administrativeDivisions.provinces.find(
          ({ name, fullName }) =>
            administrativeKey(name) ===
              administrativeKey(draft.provinceName!) ||
            administrativeKey(fullName) ===
              administrativeKey(draft.provinceName!),
        )
      : undefined);
  const commune =
    (draft.communeCode
      ? administrativeDivisions.communes.find(
          ({ code }) => code === draft.communeCode,
        )
      : undefined) ??
    (province && draft.communeName
      ? administrativeDivisions.communes.find(
          ({ name, fullName, provinceCode }) =>
            provinceCode === province.code &&
            (administrativeKey(name) ===
              administrativeKey(draft.communeName!) ||
              administrativeKey(fullName) ===
                administrativeKey(draft.communeName!)),
        )
      : undefined);
  if (province) {
    draft.provinceCode = province.code;
    draft.provinceName = province.fullName;
  }
  if (commune && province && commune.provinceCode === province.code) {
    draft.communeCode = commune.code;
    draft.communeName = commune.fullName;
  }
  return {
    draft,
    invalidFields: [],
    options: {
      provinces: administrativeDivisions.provinces.map(
        ({ code, fullName }) => ({ code, name: fullName }),
      ),
      communes: province
        ? administrativeDivisions.communes
            .filter(({ provinceCode }) => provinceCode === province.code)
            .map(({ code, fullName, provinceCode }) => ({
              code,
              name: fullName,
              provinceCode,
            }))
        : [],
    },
  };
}

function directQuoteSuccess(
  value: DirectQuoteFulfillmentValue,
): Record<string, unknown> {
  return {
    toolName: 'quoteFulfillment',
    ok: true,
    value,
    message:
      value.status === 'incomplete'
        ? `Delivery address draft saved; missing ${value.missingFields.join(', ')}`
        : value.status === 'unsupported'
          ? 'The complete address is outside the current mock delivery coverage'
          : 'Fulfillment quote verified',
    provenance: [],
  };
}

async function executeDirectQuoteFulfillment(input: {
  clients: ExternalClients;
  session: KfcToolSession;
  accessContext?: CustomerAccessContext;
  arguments: Record<string, unknown>;
  fixtures?: Pick<
    GeneratedFixtures,
    'administrativeDivisions' | 'administrativeLegacyMappings'
  >;
}): Promise<{
  result: Record<string, unknown> | ToolCallResult;
  session: KfcToolSession;
}> {
  const parsed = directQuoteFulfillmentArgumentsSchema.safeParse(
    input.arguments,
  );
  if (!parsed.success) {
    return {
      result: {
        toolName: 'quoteFulfillment',
        ok: false,
        errorCode: 'invalid_tool_arguments',
        message: parsed.error.message,
        provenance: [],
      },
      session: input.session,
    };
  }
  const previousDraft = input.session.deliveryAddressDraft;
  const mergedDraft = mergeDeliveryAddressDraft(
    previousDraft,
    parsed.data.address,
  );
  const administrative = resolveAdministrativeDraft({
    draft: mergedDraft,
    fixtures: input.fixtures,
  });
  const addressDraft = administrative.draft;
  const draftChanged =
    JSON.stringify(previousDraft) !== JSON.stringify(addressDraft);
  const draftSession: KfcToolSession = {
    ...input.session,
    deliveryAddressDraft: addressDraft,
    deliveryAdministrativeOptions: administrative.options,
    ...(draftChanged ? { address: undefined, fulfillment: undefined } : {}),
  };
  const missingFields = [
    ...new Set([...missingDeliveryAddressFields(addressDraft)]),
  ];
  if (missingFields.length > 0) {
    return {
      result: directQuoteSuccess({
        status: 'incomplete',
        addressDraft,
        missingFields,
      }),
      session: {
        ...draftSession,
        deliveryAddressStatus: 'incomplete',
        deliveryAddressMissingFields: missingFields,
      },
    };
  }

  const effectiveArguments = {
    method: parsed.data.method,
    address: {
      label: addressDraft.recipientName ?? null,
      line1: addressDraft.addressLine!,
      district:
        addressDraft.legacyDistrictText ?? addressDraft.communeName ?? null,
      city:
        input.fixtures?.administrativeDivisions.provinces.find(
          ({ code }) => code === addressDraft.provinceCode,
        )?.name ??
        addressDraft.provinceName ??
        null,
    },
    itemCodes: draftSession.cart.items.map((item) => item.itemCode),
  };
  const prepared = prepareExecution(
    draftSession,
    input.accessContext,
    'quoteFulfillment',
    effectiveArguments,
  );
  const result = await executeToolCall(
    input.clients,
    { toolName: 'quoteFulfillment', arguments: effectiveArguments },
    prepared.context,
  );
  if (!result.ok && result.errorCode === 'address_resolution_failed') {
    return {
      result: directQuoteSuccess({
        status: 'unsupported',
        addressDraft,
        missingFields: [],
      }),
      session: {
        ...prepared.session,
        deliveryAddressStatus: 'unsupported',
        deliveryAddressMissingFields: [],
      },
    };
  }
  if (!result.ok || result.toolName !== 'quoteFulfillment') {
    return { result, session: prepared.session };
  }
  return {
    result: directQuoteSuccess({
      status: 'quoted',
      addressDraft,
      missingFields: [],
      fulfillment: result.value,
    }),
    session: {
      ...reduceToolResult(prepared.session, result, effectiveArguments),
      deliveryAddressStatus: 'quoted',
      deliveryAddressMissingFields: [],
    },
  };
}

export async function createKfcToolSession(
  clients: ExternalClients,
  sessionId: string,
  customerId = sessionId.replace(/^kfc:/, ''),
  channel: Channel = 'kfc',
  externalCallContext: ExternalCallContext = {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 120_000,
  },
): Promise<KfcToolSession> {
  const cart = await clients.cart.createCart(sessionId, externalCallContext);
  if (!cart.ok || !cart.value) {
    throw new Error(cart.message || 'Fixture cart could not be created');
  }
  return {
    sessionId,
    customerId,
    channel,
    cart: cart.value,
    externalCallContext,
    toolCallSequence: 0,
  };
}

function prepareExecution(
  session: KfcToolSession,
  accessContext: CustomerAccessContext | undefined,
  toolName: ToolName,
  arguments_: Record<string, unknown>,
): { session: KfcToolSession; context: ExecutorContext } {
  const toolCallSequence = session.toolCallSequence + 1;
  const nextSession = { ...session, toolCallSequence };
  const bindingFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        sessionId: session.sessionId,
        toolName,
        arguments: arguments_,
        toolCallSequence,
      }),
    )
    .digest('hex');
  return {
    session: nextSession,
    context: {
      externalCallContext: session.externalCallContext,
      sessionId: session.sessionId,
      clientMessageId: `direct-openai-${toolCallSequence}`,
      accessContext,
      cart: session.cart,
      address: session.address,
      orderPreview: session.orderPreview,
      order: session.order,
      providerMutationIdentity: {
        idempotencyKey: `${session.sessionId}:${toolName}:${toolCallSequence}`,
        bindingFingerprint,
      },
      state: {
        sessionId: session.sessionId,
        customerId: session.customerId,
        channel: session.channel,
        latestUserMessage: '',
        userConfirmedOrder: toolName === 'placeOrder',
        escalationReasons: [],
        retrievedEvidence: [],
        cart: session.cart,
        ...(session.address ? { address: session.address } : {}),
        ...(session.fulfillment ? { fulfillment: session.fulfillment } : {}),
        ...(session.orderPreview ? { orderPreview: session.orderPreview } : {}),
        ...(session.order ? { order: session.order } : {}),
        ...(session.selectedPaymentMethod
          ? { selectedPaymentMethod: session.selectedPaymentMethod }
          : {}),
        ...(session.paymentAttempt
          ? { paymentAttempt: session.paymentAttempt }
          : {}),
        ...(session.activeCollectionKeys
          ? { activeCollectionKeys: session.activeCollectionKeys }
          : {}),
        ...(session.verifiedCollections
          ? { verifiedCollections: session.verifiedCollections }
          : {}),
      },
    },
  };
}

function reduceToolResult(
  session: KfcToolSession,
  result: ToolCallResult,
  arguments_: Record<string, unknown>,
): KfcToolSession {
  if (!result.ok) return session;
  switch (result.toolName) {
    case 'updateCart':
    case 'previewCart':
      return { ...session, cart: result.value };
    case 'quoteFulfillment': {
      const parsed = toolArgumentSchemas.quoteFulfillment.safeParse(arguments_);
      const address = result.value.resolvedAddress
        ? result.value.resolvedAddress
        : parsed.success &&
            parsed.data.address.label !== null &&
            parsed.data.address.district !== null &&
            parsed.data.address.city !== null
          ? {
              label: parsed.data.address.label,
              line1: parsed.data.address.line1,
              district: parsed.data.address.district,
              city: parsed.data.address.city,
            }
          : session.address;
      const cart = {
        ...session.cart,
        deliveryFeeVnd: result.value.feeVnd,
        totalVnd: Math.max(
          0,
          session.cart.subtotalVnd -
            session.cart.discountVnd +
            result.value.feeVnd,
        ),
      };
      return {
        ...session,
        ...(address ? { address } : {}),
        fulfillment: result.value,
        cart,
      };
    }
    case 'validateVoucher': {
      if (!result.value.ok) return session;
      return {
        ...session,
        cart: {
          ...session.cart,
          voucherCode: result.value.publicCode,
          discountVnd: result.value.discountVnd,
          totalVnd: Math.max(
            0,
            session.cart.subtotalVnd -
              result.value.discountVnd +
              session.cart.deliveryFeeVnd,
          ),
        },
      };
    }
    case 'previewOrder':
      return { ...session, orderPreview: result.value };
    case 'placeOrder':
    case 'getOrderStatus':
      return { ...session, order: result.value };
    case 'createPaymentLink': {
      const parsed =
        toolArgumentSchemas.createPaymentLink.safeParse(arguments_);
      return {
        ...session,
        paymentAttempt: {
          orderId: result.value.orderId,
          method: parsed.success ? parsed.data.methodId : undefined,
          status: result.value.status,
          paymentUrl: result.value.url,
        },
      };
    }
    case 'checkPaymentStatus':
      return {
        ...session,
        paymentAttempt: {
          ...session.paymentAttempt,
          status: result.value.status,
        },
      };
    case 'handoff': {
      const parsed = toolArgumentSchemas.handoff.safeParse(arguments_);
      return {
        ...session,
        handoff: {
          escalationId: result.value.escalationId,
          reasons: parsed.success ? parsed.data.reasons : [],
        },
      };
    }
    case 'resolveHandoff':
      return { ...session, handoff: undefined };
    default:
      return session;
  }
}

function rewardCatalogWithEligibility(
  rewards: ToolCallResult,
  profile: ToolCallResult,
): unknown {
  if (
    !rewards.ok ||
    rewards.toolName !== 'listMembershipRewards' ||
    !profile.ok ||
    profile.toolName !== 'getMembershipProfile'
  ) {
    return rewards;
  }
  const currentPoints = profile.value.points;
  return {
    ...rewards,
    value: {
      currentPoints,
      items: rewards.value.map((reward) => {
        const pointsCost = reward.pointsCost;
        const canAcquireNow =
          typeof pointsCost === 'number' && currentPoints >= pointsCost;
        return {
          ...reward,
          canAcquireNow,
          pointsShortfall:
            typeof pointsCost === 'number'
              ? Math.max(0, pointsCost - currentPoints)
              : null,
        };
      }),
    },
  };
}

function walletWithRuntimeCapability(result: ToolCallResult): unknown {
  if (!result.ok || result.toolName !== 'listMembershipWallet') return result;
  return {
    ...result,
    value: result.value.map((voucher) => ({
      ...voucher,
      canRedeemInCurrentRuntime: true,
      redemptionMode: 'available',
    })),
  };
}

function membershipToolsWithRuntimeCapability(result: ToolCallResult): unknown {
  if (!result.ok || result.toolName !== 'listMembershipTools') return result;
  return {
    ...result,
    value: result.value.map((tool) => ({
      ...tool,
      actionableInCurrentRuntime: true,
      executionMode: 'available',
    })),
  };
}

export function createKfcOpenAiTools(
  input: CreateKfcOpenAiToolsInput,
): KfcCanonicalTool[] {
  return toolNames.map((toolName) => ({
    definition: {
      type: 'function',
      name: toolName,
      description: descriptions[toolName],
      parameters: jsonSchemaFor(toolName),
      strict: toolName === 'quoteFulfillment' || toolName === 'updateCart',
    },
    async execute(arguments_: Record<string, unknown>, options) {
      const baseSession = input.sessionState.current;
      const session = {
        ...baseSession,
        externalCallContext: {
          signal: AbortSignal.any([
            baseSession.externalCallContext.signal,
            options?.signal ?? baseSession.externalCallContext.signal,
          ]),
          deadlineAt: Math.min(
            baseSession.externalCallContext.deadlineAt,
            options?.deadlineAt ?? baseSession.externalCallContext.deadlineAt,
          ),
        },
      } satisfies KfcToolSession;
      const publish = (nextSession: KfcToolSession): boolean => {
        if (options?.signal.aborted) return false;
        if (input.sessionState.current !== baseSession) return false;
        input.sessionState.current = {
          ...nextSession,
          externalCallContext: baseSession.externalCallContext,
        };
        return true;
      };
      const publishOrConflict = (
        result: unknown,
        nextSession: KfcToolSession,
      ): unknown => {
        if (publish(nextSession)) return result;
        if (options?.signal.aborted) return result;
        return {
          toolName,
          ok: false,
          errorCode: 'agent_tool_state_conflict',
          message: 'Tool state changed before this result could be applied',
          provenance: [],
        } satisfies ToolCallResult;
      };
      if (toolName === 'quoteFulfillment') {
        const execution = await executeDirectQuoteFulfillment({
          clients: input.clients,
          session,
          accessContext: input.accessContext,
          arguments: arguments_,
          fixtures: input.fixtures,
        });
        return publishOrConflict(execution.result, execution.session);
      }
      if (toolName === 'handoff' && session.handoff) {
        return {
          toolName: 'handoff',
          ok: true,
          value: { escalationId: session.handoff.escalationId },
          message: 'Human-support request is already queued',
          provenance: [],
        } satisfies ToolCallResult;
      }
      if (toolName === 'placeOrder' && session.order) {
        return {
          toolName: 'placeOrder',
          ok: true,
          value: session.order,
          message: 'Current verified order already exists',
          provenance: [],
        } satisfies ToolCallResult;
      }
      const directArguments =
        toolName === 'listPaymentMethods'
          ? Object.fromEntries(
              Object.entries(arguments_).filter(([, value]) => value !== null),
            )
          : toolName === 'updateCart'
            ? canonicalUpdateCartArguments(arguments_)
            : toolName === 'acquireVoucher' || toolName === 'redeemReward'
              ? { ...arguments_, confirmed: true }
              : arguments_;
      const effectiveArguments = directArguments;
      let preparedSession = session;
      if (toolName === 'createPaymentLink') {
        const parsed =
          toolArgumentSchemas.createPaymentLink.safeParse(effectiveArguments);
        const authority = parsed.success
          ? activeSupportedPaymentMethod(
              {
                activeCollectionKeys: session.activeCollectionKeys,
                verifiedCollections: session.verifiedCollections,
              },
              parsed.data.methodId,
            )
          : undefined;
        if (!authority) {
          return {
            toolName: 'createPaymentLink',
            ok: false,
            errorCode: 'unverified_payment_method',
            message:
              'The supplied methodId is not in the active verified payment-method collection',
            provenance: [],
          } satisfies ToolCallResult;
        }
        preparedSession = {
          ...preparedSession,
          selectedPaymentMethod: selectedPaymentMethodAuthority(authority),
        };
      }
      const prepared = prepareExecution(
        preparedSession,
        input.accessContext,
        toolName,
        effectiveArguments,
      );
      const legacyResult = await executeToolCall(
        input.clients,
        { toolName, arguments: effectiveArguments },
        prepared.context,
      );
      if (toolName === 'listPaymentMethods') {
        const result = await adaptAgentToolResult({
          clients: input.clients,
          request: { toolName, arguments: effectiveArguments },
          context: prepared.context,
          legacy: legacyResult,
          scope:
            typeof effectiveArguments.query === 'string'
              ? {
                  scope: 'filtered',
                  query: effectiveArguments.query,
                }
              : { scope: 'all' },
        });
        let nextSession = prepared.session;
        if (result.ok && result.verifiedCollection) {
          nextSession = {
            ...nextSession,
            activeCollectionKeys: {
              ...nextSession.activeCollectionKeys,
              listPaymentMethods: result.verifiedCollection.key,
            },
            verifiedCollections: replaceVerifiedCollection(
              nextSession.verifiedCollections,
              'listPaymentMethods',
              result.verifiedCollection,
            ),
          };
        }
        return publishOrConflict(result, nextSession);
      }
      if (toolName === 'listMembershipRewards') {
        const profile = prepareExecution(
          prepared.session,
          input.accessContext,
          'getMembershipProfile',
          {},
        );
        const profileResult = await executeToolCall(
          input.clients,
          { toolName: 'getMembershipProfile', arguments: {} },
          profile.context,
        );
        const result = rewardCatalogWithEligibility(
          legacyResult,
          profileResult,
        );
        return publishOrConflict(result, profile.session);
      }
      if (toolName === 'listMembershipWallet') {
        const result = walletWithRuntimeCapability(legacyResult);
        return publishOrConflict(result, prepared.session);
      }
      if (toolName === 'listMembershipTools') {
        const result = membershipToolsWithRuntimeCapability(legacyResult);
        return publishOrConflict(result, prepared.session);
      }
      return publishOrConflict(
        legacyResult,
        reduceToolResult(prepared.session, legacyResult, effectiveArguments),
      );
    },
  }));
}
