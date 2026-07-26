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
    return z.union([
      directUpdateCartArgumentsSchema,
      (agentToolArgumentSchemas as Record<string, z.ZodTypeAny>).updateCart,
      (toolArgumentSchemas as Record<string, z.ZodTypeAny>).updateCart,
    ]);
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
  session: KfcToolSession;
  accessContext?: CustomerAccessContext;
  fixtures?: Pick<
    GeneratedFixtures,
    'administrativeDivisions' | 'administrativeLegacyMappings' | 'menuItems'
  >;
}

function cloneKfcToolSession(session: KfcToolSession): KfcToolSession {
  const { externalCallContext, ...cloneableSession } = session;
  return {
    ...structuredClone(cloneableSession),
    externalCallContext,
  };
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
    'Search verified menu items and selectable options deterministically in one searchMenu call in the same user turn. Put concise product or product-composition terms in query. For a category-wide request, put the exact category wording already exposed by menu evidence in category and leave query empty; retrieve the category first and filter customer exclusions from the returned candidates. When the customer asks you to choose one item and the request is sufficiently clear, use the returned candidates to choose and continue in the same turn instead of asking whether they want details. Put each required selectable choice in modifierQueries using wording exposed by the selectable option. Keep negation when it is part of the desired option name, such as "không cay"; for an omitted optional add-on, use the target wording, such as "phô mai". Example: "gà không cay, không phô mai" can use query "gà" and modifierQueries ["không cay", "phô mai"]. Product components named in an item or description belong in query, not modifierQueries. Keep search terms in Vietnamese because the catalog is Vietnamese. Put category, partySize, and maxPriceVnd in their structured arguments. partySize is ranking evidence, and maxPriceVnd is a per-item ceiling; combine returned priceVnd values yourself for a total recommendation budget. Each candidate returns availability and compact matchedModifiers evidence; available false means the item cannot currently be ordered. Absence of a match does not prove absence of an ingredient or property; only claim all requested selectable choices matched when matchesAllModifierQueries is true. An exact item-name query ranks the top exact candidate above similarly named combos; use that top exact candidate and call getItemDetails rather than substituting another item. Use mode "full" only for the complete menu. When an exact item code is already known or the full option tree is needed, call getModifierOptions directly.',
  getItemDetails:
    'Get verified name, description, category, base price, and current availability for one KFC menu item code. Treat available false as unavailable to order.',
  getModifierOptions:
    'Get the verified selectable modifier tree for one menu item code; call this before answering any exact modifier-price question. Every name, attribute, and price belongs only to its exact option and branch. Do not transfer a property to sibling options, the whole item, or another item. Quote an exact modifier price only from its returned priceDeltaVnd; do not infer a modifier price from the item price or conversation. Missing attribute or modifier data means unknown; absence of a modifier choice does not prove an ingredient, taste, or allergen property.',
  updateCart:
    'Add, update, remove, or replace one or more items in the current cart. This is a reversible cart edit: when the customer explicitly asks to choose and add an item, execute it without another confirmation. Use mode "patch" when changing only the listed item codes while preserving all other cart lines. Use mode "replace" when changes describe the complete desired cart; every current cart item not listed with a positive quantity is removed atomically. orderedMenuItemQuantity is how many times the customer is purchasing the named menu item, never the number of pieces described inside that item. If the customer says one portion of a menu item that contains two pieces, orderedMenuItemQuantity is 1; if both pieces use the same verified option, quantityPerPortion can be 2. Modifier quantities are per ordered menu item and must use exact verified identifiers and pricing from getModifierOptions.',
  previewCart: 'Read the current cart with verified prices and totals.',
  recommendAddOns:
    'Return verified add-on candidates for the current cart without changing it. Use this for a general add-on request; if the customer asks for a specific add-on and no candidate is returned, that does not mean the item is absent from the full menu, so search the menu for a standalone item.',
  findStores:
    'Find KFC stores by query, city, or district. A nearby or named store does not verify delivery coverage, fee, ETA, or item serviceability; use quoteFulfillment with the complete delivery details for those facts.',
  checkStoreAvailability:
    'Check whether the current cart items are available at one exact store for pickup or delivery. This verifies item availability only; it does not verify delivery fee or ETA.',
  quoteFulfillment:
    'Merge customer-supplied delivery details into the current address draft and, when complete, quote the exact current cart. Call this whenever the customer supplies or corrects any delivery address, recipient, phone, or delivery-instruction field, including an incomplete address. Extract fields from natural language into address; use null for every field not supplied in the current message. Never send placeholders such as a generic recipient, an example phone number, an invented address, or invented administrative codes. Recipient name, phone, and the customer’s free-form address line are sufficient; province and commune are optional, and this mock accepts every supplied address. The backend retains prior fields and returns status incomplete only for missing required customer details, or quoted with a fulfillment quote. Ask naturally for missing fields and preserve known fields. Only a successful quoted result verifies serviceability, delivery fee, ETA, store, and cart availability. This tool does not place or confirm an order.',
  searchPromotions:
    'Search the current verified promotion and voucher catalog. Use an empty query for a broad listing or a concise Vietnamese term for a targeted search. An empty filtered result does not prove that no promotion exists; broaden the query or list the current catalog when appropriate.',
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
    'List verified KFC payment methods. When the customer names or repeats a payment method while confirming checkout, query that exact customer-facing name first, then use only the exact supported methodId returned by this call for createPaymentLink in the same tool loop. Do not guess a methodId or infer support from a name.',
  getSavedAddresses:
    'Read saved delivery addresses for the authenticated customer.',
  getRecentOrder: 'Read the authenticated customer’s most recent order.',
  getFavoriteItems: 'Read the authenticated customer’s favorite menu items.',
  acquireVoucher:
    'Acquire one verified membership reward when the customer explicitly asks to acquire or confirms acquiring it. Use the exact rewardId from listMembershipRewards. The server supplies confirmation and mutation identity; do not claim completion unless the result status is completed.',
  redeemReward:
    'Redeem one verified wallet voucher when the customer explicitly asks to use or confirms using it. Use the exact voucherId from listMembershipWallet and the requested channel. The server supplies confirmation and mutation identity; do not claim completion unless the result status is completed.',
  searchContentPolicy:
    'Search approved KFC policy, promotion, news, or allergen knowledge.',
  answerAllergenQuestion: 'Search approved KFC allergen knowledge.',
  previewOrder:
    'Create an order preview from the current cart and fulfillment quote. Do not call this again when verified current state already contains an order.',
  placeOrder:
    'Place the current fixture order immediately from its preview. Do not call this again when verified current state already contains an order.',
  getOrderStatus:
    'Read the latest verified status for the current order. Describe status, timing, or fulfillment progress using only fields returned by this call.',
  createPaymentLink:
    'Create a fixture payment link for the placed order using only an exact supported methodId from the active listPaymentMethods result. If the customer confirms both placing the order and a named payment method, continue previewOrder (only when no current order exists), placeOrder (only when no current order exists), and createPaymentLink in the same Responses tool loop.',
  checkPaymentStatus: 'Read the current fixture payment status.',
  collectInvoice:
    'Record customer-provided invoice fields for the current order. Send only values the customer supplied, leave unavailable optional fields unset, and ask for required missing information when execution reports it. This does not place or modify the order.',
  handoff:
    'Queue the conversation for a human operator. A successful result means the request is queued and awaiting a human; it does not mean a human accepted or joined. If a handoff is already queued, this returns that same verified escalation without creating another.',
  resolveHandoff: 'Resolve an existing human-support escalation.',
};

const planningGuidance: Partial<Record<ToolName, string>> = {
  searchMenu:
    ' The category argument represents one exact category label, so do not combine unrelated category concepts into it. Customer exclusions about packaged product components are selection criteria, not modifierQueries: search the positive product terms, then reject candidates whose returned description includes an excluded component. When the customer delegates a clear choice to add, select a suitable available candidate and call updateCart before replying. A multi-item plan may use multiple targeted or category searches in the same user turn. If a requested component is not included in a suitable combo, search for a standalone requested component instead of treating the combo result as the whole menu.',
  updateCart:
    ' For a delegated complete cart plan, apply all additions, quantity changes, and removals in one multi-change call; use quantity 0 for unwanted existing lines when rebalancing the cart. Do not merely present the plan or ask for another confirmation when the customer already authorized this reversible choice. Treat the returned cart as the authoritative current cart. If it does not satisfy the customer’s explicit constraints, make a corrected update in the same user turn.',
};

const retryableEmptyReadTools = new Set<ToolName>([
  'searchMenu',
  'findStores',
  'searchPromotions',
  'listMembershipRewards',
  'listMembershipTools',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
]);

const retryableReadTools = new Set<ToolName>([
  ...retryableEmptyReadTools,
  'getItemDetails',
  'getModifierOptions',
  'previewCart',
  'recommendAddOns',
  'checkStoreAvailability',
  'explainPromotion',
  'validateVoucher',
  'getMembershipProfile',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'getOrderStatus',
  'checkPaymentStatus',
]);

function retryGuidance(toolName: ToolName): string {
  if (retryableEmptyReadTools.has(toolName)) {
    return ' If the result is empty, errored, or invalid, follow its recovery instruction and retry with materially corrected or broader arguments; do not repeat identical arguments. Stop after three total attempts.';
  }
  if (retryableReadTools.has(toolName)) {
    return ' If the result is errored or invalid, follow its recovery instruction and retry with materially corrected arguments; do not repeat identical arguments. Stop after three total attempts.';
  }
  return ' If arguments are rejected before execution, correct them. Never retry after an uncertain execution error.';
}

function emptyReadItemCount(result: unknown): number | undefined {
  if (!isRecord(result) || result.ok !== true) return undefined;
  if (Array.isArray(result.value)) return result.value.length;
  if (!isRecord(result.value)) return undefined;
  if (typeof result.value.total === 'number') return result.value.total;
  return Array.isArray(result.value.items)
    ? result.value.items.length
    : undefined;
}

function withEmptyReadRecovery(
  toolName: ToolName,
  result: unknown,
  availableCategories: readonly string[] = [],
): unknown {
  if (
    !retryableEmptyReadTools.has(toolName) ||
    emptyReadItemCount(result) !== 0 ||
    !isRecord(result)
  ) {
    return result;
  }
  return {
    ...result,
    recovery: {
      reason: 'empty_result',
      retry: true,
      instruction:
        toolName === 'searchMenu'
          ? 'Before replying to the customer, retry in this turn with materially broader arguments: drop constraints one at a time; for category browsing use the exact category wording already exposed by menu evidence and leave query empty, or omit category and use a concise product query. Request the full menu only when that matches the customer intent. Do not repeat identical arguments.'
          : 'Before replying to the customer, retry in this turn with materially broader arguments: drop constraints one at a time or use the tool’s unfiltered listing form when available. Do not repeat identical arguments.',
      ...(toolName === 'searchMenu' && availableCategories.length > 0
        ? { availableCategories }
        : {}),
    },
  };
}

const directUpdateCartJsonSchema = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['patch', 'replace'],
      description:
        'Use patch to preserve unlisted cart lines. Use replace when changes are the complete desired cart and every unlisted current item must be removed.',
    },
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
  required: ['mode', 'changes'],
  additionalProperties: false,
} as const;

const directUpdateCartArgumentsSchema = z
  .object({
    // Trusted GenUI actions created before mode was exposed remain patch edits.
    // The provider-facing JSON Schema still requires the model to choose.
    mode: z.enum(['patch', 'replace']).default('patch'),
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
    ...(arguments_.mode === 'replace'
      ? { mode: 'replace' }
      : { mode: 'patch' }),
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
}): Promise<Record<string, unknown> | ToolCallResult> {
  const parsed = directQuoteFulfillmentArgumentsSchema.safeParse(
    input.arguments,
  );
  if (!parsed.success) {
    return {
      toolName: 'quoteFulfillment',
      ok: false,
      errorCode: 'invalid_tool_arguments',
      message: parsed.error.message,
      provenance: [],
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
  input.session.deliveryAddressDraft = addressDraft;
  input.session.deliveryAdministrativeOptions = administrative.options;
  if (JSON.stringify(previousDraft) !== JSON.stringify(addressDraft)) {
    input.session.address = undefined;
    input.session.fulfillment = undefined;
  }
  const missingFields = [
    ...new Set([...missingDeliveryAddressFields(addressDraft)]),
  ];
  if (missingFields.length > 0) {
    input.session.deliveryAddressStatus = 'incomplete';
    input.session.deliveryAddressMissingFields = missingFields;
    return directQuoteSuccess({
      status: 'incomplete',
      addressDraft,
      missingFields,
    });
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
    itemCodes: input.session.cart.items.map((item) => item.itemCode),
  };
  const context = executionContext(
    input.session,
    input.accessContext,
    'quoteFulfillment',
    effectiveArguments,
  );
  const result = await executeToolCall(
    input.clients,
    { toolName: 'quoteFulfillment', arguments: effectiveArguments },
    context,
  );
  if (!result.ok && result.errorCode === 'address_resolution_failed') {
    input.session.deliveryAddressStatus = 'unsupported';
    input.session.deliveryAddressMissingFields = [];
    return directQuoteSuccess({
      status: 'unsupported',
      addressDraft,
      missingFields: [],
    });
  }
  if (!result.ok || result.toolName !== 'quoteFulfillment') return result;
  applyResult(input.session, result, effectiveArguments);
  input.session.deliveryAddressStatus = 'quoted';
  input.session.deliveryAddressMissingFields = [];
  return directQuoteSuccess({
    status: 'quoted',
    addressDraft,
    missingFields: [],
    fulfillment: result.value,
  });
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

function executionContext(
  session: KfcToolSession,
  accessContext: CustomerAccessContext | undefined,
  toolName: ToolName,
  arguments_: Record<string, unknown>,
): ExecutorContext {
  const toolCallSequence = ++session.toolCallSequence;
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
  };
}

function applyResult(
  session: KfcToolSession,
  result: ToolCallResult,
  arguments_: Record<string, unknown>,
): void {
  if (!result.ok) return;
  switch (result.toolName) {
    case 'updateCart':
    case 'previewCart':
      session.cart = result.value;
      break;
    case 'quoteFulfillment': {
      const parsed = toolArgumentSchemas.quoteFulfillment.safeParse(arguments_);
      if (result.value.resolvedAddress) {
        session.address = result.value.resolvedAddress;
      } else if (
        parsed.success &&
        parsed.data.address.label !== null &&
        parsed.data.address.district !== null &&
        parsed.data.address.city !== null
      ) {
        session.address = parsed.data.address as Address;
      }
      session.fulfillment = result.value;
      session.cart = {
        ...session.cart,
        deliveryFeeVnd: result.value.feeVnd,
        totalVnd: Math.max(
          0,
          session.cart.subtotalVnd -
            session.cart.discountVnd +
            result.value.feeVnd,
        ),
      };
      break;
    }
    case 'validateVoucher': {
      if (!result.value.ok) break;
      session.cart = {
        ...session.cart,
        voucherCode: result.value.publicCode,
        discountVnd: result.value.discountVnd,
        totalVnd: Math.max(
          0,
          session.cart.subtotalVnd -
            result.value.discountVnd +
            session.cart.deliveryFeeVnd,
        ),
      };
      break;
    }
    case 'previewOrder':
      session.orderPreview = result.value;
      break;
    case 'placeOrder':
    case 'getOrderStatus':
      session.order = result.value;
      break;
    case 'createPaymentLink': {
      const parsed =
        toolArgumentSchemas.createPaymentLink.safeParse(arguments_);
      session.paymentAttempt = {
        orderId: result.value.orderId,
        method: parsed.success ? parsed.data.methodId : undefined,
        status: result.value.status,
        paymentUrl: result.value.url,
      };
      break;
    }
    case 'checkPaymentStatus':
      session.paymentAttempt = {
        ...session.paymentAttempt,
        status: result.value.status,
      };
      break;
    case 'handoff': {
      const parsed = toolArgumentSchemas.handoff.safeParse(arguments_);
      session.handoff = {
        escalationId: result.value.escalationId,
        reasons: parsed.success ? parsed.data.reasons : [],
      };
      break;
    }
    case 'resolveHandoff':
      session.handoff = undefined;
      break;
    default:
      break;
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
  const availableMenuCategories = [
    ...new Set(input.fixtures?.menuItems.map(({ category }) => category) ?? []),
  ];
  return toolNames.map((toolName) => ({
    definition: {
      type: 'function',
      name: toolName,
      description: `${descriptions[toolName]}${planningGuidance[toolName] ?? ''}${retryGuidance(toolName)}`,
      parameters: jsonSchemaFor(toolName),
      strict: toolName === 'quoteFulfillment' || toolName === 'updateCart',
    },
    async execute(arguments_: Record<string, unknown>, options) {
      // Mutate a private session snapshot. A late non-cancellable provider
      // promise is quarantined after the SDK timeout wins.
      const session = cloneKfcToolSession(input.session);
      const originalExternalCallContext = input.session.externalCallContext;
      session.externalCallContext = {
        signal: AbortSignal.any([
          input.session.externalCallContext.signal,
          options?.signal ?? input.session.externalCallContext.signal,
        ]),
        deadlineAt: Math.min(
          input.session.externalCallContext.deadlineAt,
          options?.deadlineAt ?? input.session.externalCallContext.deadlineAt,
        ),
      };
      const commit = () => {
        if (!options?.signal.aborted) {
          Object.assign(input.session, session);
          input.session.externalCallContext = originalExternalCallContext;
        }
      };
      if (toolName === 'quoteFulfillment') {
        const result = await executeDirectQuoteFulfillment({
          clients: input.clients,
          session,
          accessContext: input.accessContext,
          arguments: arguments_,
          fixtures: input.fixtures,
        });
        commit();
        return result;
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
              'Read the named payment method with listPaymentMethods and use its exact supported methodId',
            provenance: [],
          } satisfies ToolCallResult;
        }
        session.selectedPaymentMethod =
          selectedPaymentMethodAuthority(authority);
      }
      const context = executionContext(
        session,
        input.accessContext,
        toolName,
        effectiveArguments,
      );
      const legacyResult = await executeToolCall(
        input.clients,
        { toolName, arguments: effectiveArguments },
        context,
      );
      if (toolName === 'listPaymentMethods') {
        const result = await adaptAgentToolResult({
          clients: input.clients,
          request: { toolName, arguments: effectiveArguments },
          context,
          legacy: legacyResult,
          scope:
            typeof effectiveArguments.query === 'string'
              ? {
                  scope: 'filtered',
                  query: effectiveArguments.query,
                }
              : { scope: 'all' },
        });
        if (result.ok && result.verifiedCollection) {
          session.activeCollectionKeys = {
            ...session.activeCollectionKeys,
            listPaymentMethods: result.verifiedCollection.key,
          };
          session.verifiedCollections = replaceVerifiedCollection(
            session.verifiedCollections,
            'listPaymentMethods',
            result.verifiedCollection,
          );
        }
        commit();
        return withEmptyReadRecovery(toolName, result, availableMenuCategories);
      }
      if (toolName === 'listMembershipRewards') {
        const profileContext = executionContext(
          session,
          input.accessContext,
          'getMembershipProfile',
          {},
        );
        const profileResult = await executeToolCall(
          input.clients,
          { toolName: 'getMembershipProfile', arguments: {} },
          profileContext,
        );
        const result = rewardCatalogWithEligibility(
          legacyResult,
          profileResult,
        );
        commit();
        return withEmptyReadRecovery(toolName, result, availableMenuCategories);
      }
      if (toolName === 'listMembershipWallet') {
        const result = walletWithRuntimeCapability(legacyResult);
        commit();
        return withEmptyReadRecovery(toolName, result, availableMenuCategories);
      }
      if (toolName === 'listMembershipTools') {
        const result = membershipToolsWithRuntimeCapability(legacyResult);
        commit();
        return withEmptyReadRecovery(toolName, result, availableMenuCategories);
      }
      applyResult(session, legacyResult, effectiveArguments);
      commit();
      return withEmptyReadRecovery(
        toolName,
        legacyResult,
        availableMenuCategories,
      );
    },
  }));
}
