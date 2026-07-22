import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ExternalClients } from '../clients/interfaces.js';
import type {
  Address,
  Channel,
  CustomerAccessContext,
  Order,
} from '../domain/types.js';
import {
  toolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import {
  executeToolCall,
  type ExecutorContext,
} from '../ordering/toolExecutor.js';
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
  paymentAttempt?: PaymentAttempt;
}

export interface CreateKfcOpenAiToolsInput {
  clients: ExternalClients;
  session: KfcToolSession;
  accessContext?: CustomerAccessContext;
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
    ...(session.paymentAttempt ? { paymentAttempt: session.paymentAttempt } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

const descriptions: Record<ToolName, string> = {
  searchMenu: 'Search and rank the current KFC menu. Pass the complete customer wording in query, set partySize and maxPriceVnd whenever stated, and use mode "full" only for the complete menu. Results are compact; use getItemDetails or getModifierOptions for detail.',
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
  getMembershipProfile: 'Read the authenticated fixture customer membership profile.',
  listMembershipRewards: 'List membership rewards available to the fixture customer.',
  listMembershipWallet: 'List vouchers in the fixture customer membership wallet.',
  getMembershipPointHistory: 'Read membership point history for the fixture customer.',
  listMembershipTools: 'List available membership capabilities.',
  listPaymentMethods: 'List supported KFC payment methods.',
  acquireVoucher: 'Preview or acquire a membership reward voucher.',
  redeemReward: 'Preview or redeem a membership wallet voucher.',
  searchContentPolicy: 'Search approved KFC policy, promotion, news, or allergen knowledge.',
  answerAllergenQuestion: 'Search approved KFC allergen knowledge.',
  previewOrder: 'Create an order preview from the current cart and fulfillment quote.',
  placeOrder: 'Place the current fixture order immediately from its preview.',
  getOrderStatus: 'Read the current fixture order status.',
  createPaymentLink: 'Create a fixture payment link for the placed order.',
  checkPaymentStatus: 'Read the current fixture payment status.',
  collectInvoice: 'Collect invoice details for the order.',
  handoff: 'Escalate the conversation to a human operator.',
};

function jsonSchemaFor(toolName: ToolName): Record<string, unknown> {
  const schema = zodToJsonSchema(toolArgumentSchemas[toolName], {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  const { $schema: _schemaVersion, ...parameters } = schema;
  if (toolName === 'updateCart' && Array.isArray(parameters.anyOf)) {
    const variants = parameters.anyOf.filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    );
    return {
      type: 'object',
      properties: Object.assign({}, ...variants.map((variant) => variant.properties ?? {})),
      additionalProperties: false,
    };
  }
  if (toolName === 'quoteFulfillment' && typeof parameters.properties === 'object') {
    const { itemCodes: _itemCodes, ...properties } = parameters.properties as Record<string, unknown>;
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
): Promise<KfcToolSession> {
  const cart = await clients.cart.createCart(sessionId);
  if (!cart.ok || !cart.value) {
    throw new Error(cart.message || 'Fixture cart could not be created');
  }
  return { sessionId, customerId, channel, cart: cart.value };
}

function executionContext(
  session: KfcToolSession,
  accessContext: CustomerAccessContext | undefined,
  toolName: ToolName,
): ExecutorContext {
  return {
    sessionId: session.sessionId,
    customerId: session.customerId,
    channel: session.channel,
    accessContext,
    cart: session.cart,
    address: session.address,
    fulfillment: session.fulfillment,
    orderPreview: session.orderPreview,
    order: session.order,
    userConfirmedOrder: toolName === 'placeOrder',
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
      if (parsed.success) session.address = parsed.data.address;
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
      const parsed = toolArgumentSchemas.createPaymentLink.safeParse(arguments_);
      session.paymentAttempt = {
        method: parsed.success ? parsed.data.method : undefined,
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

export function createKfcOpenAiTools(input: CreateKfcOpenAiToolsInput): OpenAiFunctionTool[] {
  return toolNames.map((toolName) => ({
    definition: {
      type: 'function',
      name: toolName,
      description: descriptions[toolName],
      parameters: jsonSchemaFor(toolName),
      strict: false,
    },
    async execute(arguments_: Record<string, unknown>) {
      const effectiveArguments = toolName === 'quoteFulfillment' && input.session.cart.items.length > 0
        ? {
            ...arguments_,
            itemCodes: input.session.cart.items.map((item) => item.itemCode),
          }
        : arguments_;
      const result = await executeToolCall(
        input.clients,
        { toolName, arguments: effectiveArguments },
        executionContext(input.session, input.accessContext, toolName),
      );
      applyResult(input.session, result, effectiveArguments);
      return result;
    },
  }));
}
