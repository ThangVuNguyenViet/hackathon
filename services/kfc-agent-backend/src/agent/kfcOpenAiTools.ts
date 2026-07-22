import { createHash } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../clients/interfaces.js';
import type {
  Address,
  Channel,
  CustomerAccessContext,
  Order,
} from '../domain/types.js';
import type { SelectedPaymentMethodAuthority } from '../domain/opaqueProviderId.js';
import type { AgentGraphState } from '../graph/state.js';
import { toolArgumentSchemas, toolNames } from '../ordering/toolCatalog.js';
import {
  executeToolCall,
  type ExecutorContext,
} from '../ordering/toolExecutor.js';
import { adaptAgentToolResult } from '../ordering/agentToolResultAdapter.js';
import { replaceVerifiedCollection } from '../ordering/verifiedCollections.js';
import type {
  CartWithModifiers,
  FulfillmentState,
  PaymentAttempt,
  ToolCallResult,
  ToolName,
} from '../ordering/types.js';
import type { OpenAiFunctionTool } from './openAiKfcAgent.js';

export interface KfcToolSession {
  sessionId: string;
  customerId: string;
  channel: Channel;
  cart: CartWithModifiers;
  address?: Address;
  fulfillment?: FulfillmentState;
  orderPreview?: Order;
  order?: Order;
  selectedPaymentMethod?: SelectedPaymentMethodAuthority;
  paymentAttempt?: PaymentAttempt;
  activeCollectionKeys?: AgentGraphState['activeCollectionKeys'];
  verifiedCollections?: AgentGraphState['verifiedCollections'];
  externalCallContext: ExternalCallContext;
  toolCallSequence: number;
}

export interface CreateKfcOpenAiToolsInput {
  clients: ExternalClients;
  session: KfcToolSession;
  accessContext?: CustomerAccessContext;
}

export function hydrateKfcToolSession(
  session: KfcToolSession,
  state: Partial<
    Pick<
      KfcToolSession,
      | 'cart'
      | 'address'
      | 'fulfillment'
      | 'orderPreview'
      | 'order'
      | 'selectedPaymentMethod'
      | 'paymentAttempt'
      | 'activeCollectionKeys'
      | 'verifiedCollections'
    >
  >,
): KfcToolSession {
  return {
    ...session,
    ...(state.cart ? { cart: state.cart } : {}),
    ...(state.address ? { address: state.address } : {}),
    ...(state.fulfillment ? { fulfillment: state.fulfillment } : {}),
    ...(state.orderPreview ? { orderPreview: state.orderPreview } : {}),
    ...(state.order ? { order: state.order } : {}),
    ...(state.selectedPaymentMethod
      ? { selectedPaymentMethod: state.selectedPaymentMethod }
      : {}),
    ...(state.paymentAttempt ? { paymentAttempt: state.paymentAttempt } : {}),
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
    ...(session.cart.items.length > 0 ? { cart: session.cart } : {}),
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
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

const descriptions: Record<ToolName, string> = {
  searchMenu:
    'Search verified menu items and their modifiers deterministically in one searchMenu call in the same user turn. Translate the customer intent into concise product terms in query and independent positive option terms in modifierQueries; for example, "gà không cay, không phô mai" becomes query "gà" with modifierQueries ["không cay", "phô mai"]. Keep search terms in Vietnamese to match the Vietnamese fixture; do not translate them to English. Put category, partySize, and maxPriceVnd in their structured arguments. Each candidate returns compact matchedModifiers evidence and matchesAllModifierQueries. Absence of a match does not prove absence of an ingredient; never say an item satisfies every modifier request unless matchesAllModifierQueries is true. Use mode "full" only for the complete menu. When an exact item code is already known or a full modifier tree is needed for cart selection, call getModifierOptions directly.',
  getItemDetails: 'Get verified details for one KFC menu item code.',
  getModifierOptions: 'Get available modifier choices for one menu item code.',
  updateCart: 'Add, update, or remove one or more items in the current cart.',
  previewCart: 'Read the current cart with verified prices and totals.',
  recommendAddOns: 'Recommend add-ons that fit the current cart.',
  findStores: 'Find KFC stores by query, city, or district.',
  checkStoreAvailability: 'Check whether menu items are available at a store.',
  quoteFulfillment: 'Quote pickup or delivery for an address and item list.',
  searchPromotions: 'Search current KFC promotions and vouchers.',
  explainPromotion: 'Explain one promotion using its offer ID.',
  validateVoucher: 'Validate a voucher against the current cart subtotal.',
  getMembershipProfile:
    'Read the authenticated fixture customer membership profile.',
  listMembershipRewards:
    'List membership rewards available to the fixture customer.',
  listMembershipWallet:
    'List vouchers in the fixture customer membership wallet.',
  getMembershipPointHistory:
    'Read membership point history for the fixture customer.',
  listMembershipTools: 'List available membership capabilities.',
  listPaymentMethods: 'List supported KFC payment methods.',
  getSavedAddresses:
    'Read saved delivery addresses for the authenticated customer.',
  getRecentOrder: 'Read the authenticated customer’s most recent order.',
  getFavoriteItems: 'Read the authenticated customer’s favorite menu items.',
  acquireVoucher: 'Preview or acquire a membership reward voucher.',
  redeemReward: 'Preview or redeem a membership wallet voucher.',
  searchContentPolicy:
    'Search approved KFC policy, promotion, news, or allergen knowledge.',
  answerAllergenQuestion: 'Search approved KFC allergen knowledge.',
  previewOrder:
    'Create an order preview from the current cart and fulfillment quote.',
  placeOrder: 'Place the current fixture order immediately from its preview.',
  getOrderStatus: 'Read the current fixture order status.',
  createPaymentLink: 'Create a fixture payment link for the placed order.',
  checkPaymentStatus: 'Read the current fixture payment status.',
  collectInvoice: 'Collect invoice details for the order.',
  handoff: 'Escalate the conversation to a human operator.',
  resolveHandoff: 'Resolve an existing human-support escalation.',
};

function jsonSchemaFor(toolName: ToolName): Record<string, unknown> {
  const schema = zodToJsonSchema(toolArgumentSchemas[toolName], {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  const { $schema: _schemaVersion, ...parameters } = schema;
  if (toolName === 'updateCart' && Array.isArray(parameters.anyOf)) {
    const variants = parameters.anyOf.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null,
    );
    return {
      type: 'object',
      properties: Object.assign(
        {},
        ...variants.map((variant) => variant.properties ?? {}),
      ),
      additionalProperties: false,
    };
  }
  if (
    toolName === 'quoteFulfillment' &&
    typeof parameters.properties === 'object'
  ) {
    const { itemCodes: _itemCodes, ...properties } =
      parameters.properties as Record<string, unknown>;
    return {
      ...parameters,
      properties,
      required: Array.isArray(parameters.required)
        ? parameters.required.filter((name) => name !== 'itemCodes')
        : parameters.required,
    };
  }
  return parameters;
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
    default:
      break;
  }
}

export function createKfcOpenAiTools(
  input: CreateKfcOpenAiToolsInput,
): OpenAiFunctionTool[] {
  return toolNames.map((toolName) => ({
    definition: {
      type: 'function',
      name: toolName,
      description: descriptions[toolName],
      parameters: jsonSchemaFor(toolName),
      strict: false,
    },
    async execute(arguments_: Record<string, unknown>) {
      const directArguments =
        toolName === 'listPaymentMethods'
          ? Object.fromEntries(
              Object.entries(arguments_).filter(([, value]) => value !== null),
            )
          : arguments_;
      const effectiveArguments =
        toolName === 'quoteFulfillment' && input.session.cart.items.length > 0
          ? {
              ...directArguments,
              itemCodes: input.session.cart.items.map((item) => item.itemCode),
            }
          : directArguments;
      const context = executionContext(
        input.session,
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
          scope: { scope: 'all' },
        });
        if (result.ok && result.verifiedCollection) {
          input.session.activeCollectionKeys = {
            ...input.session.activeCollectionKeys,
            listPaymentMethods: result.verifiedCollection.key,
          };
          input.session.verifiedCollections = replaceVerifiedCollection(
            input.session.verifiedCollections,
            'listPaymentMethods',
            result.verifiedCollection,
          );
        }
        return result;
      }
      applyResult(input.session, legacyResult, effectiveArguments);
      return legacyResult;
    },
  }));
}
