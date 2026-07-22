import type { CustomerCommand } from '../domain/customerCommand.js';
import type { AgentGraphState } from '../graph/state.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { AgentEntities, ToolCallResult, ToolName } from '../ordering/types.js';
import type { OpenAiToolCallTrace } from './openAiKfcAgent.js';
import type { KfcToolSession } from './kfcOpenAiTools.js';

export interface SelectKfcOpenAiGenUiInput {
  session: KfcToolSession;
  latestUserMessage: string;
  toolCalls: OpenAiToolCallTrace[];
  customerCommand?: CustomerCommand;
}

type SuccessfulToolCallResult = Exclude<ToolCallResult, { ok: false }>;

function successfulResult(call: OpenAiToolCallTrace): SuccessfulToolCallResult | undefined {
  if (typeof call.result !== 'object' || call.result === null) return undefined;
  const result = call.result as Partial<ToolCallResult>;
  return result.ok === true && result.toolName === call.name
    ? result as SuccessfulToolCallResult
    : undefined;
}

function entitiesFor(command: CustomerCommand | undefined, toolNames: ToolName[]): AgentEntities {
  return {
    ...(command?.kind === 'edit_cart' || toolNames.includes('previewCart')
      ? { preferCartSurface: true }
      : {}),
    ...(command?.kind === 'start_fulfillment' ||
      command?.kind === 'submit_address' ||
      toolNames.some((name) =>
        name === 'findStores' || name === 'checkStoreAvailability' || name === 'quoteFulfillment',
      )
      ? { preferFulfillmentSurface: true }
      : {}),
    ...(command?.kind === 'accept_fulfillment' ? { fulfillmentAccepted: true } : {}),
  };
}

export function selectKfcOpenAiGenUi(
  input: SelectKfcOpenAiGenUiInput,
): KfcGenUiAttachment | undefined {
  const results = input.toolCalls.flatMap((call) => {
    const result = successfulResult(call);
    return result ? [{ call, result }] : [];
  });
  const toolNames = results.map(({ result }) => result.toolName);
  const exposesCart =
    input.session.cart.items.length > 0 &&
    (toolNames.some((name) =>
      name === 'updateCart' ||
      name === 'previewCart' ||
      name === 'quoteFulfillment' ||
      name === 'previewOrder' ||
      name === 'placeOrder'
    ) || Boolean(input.customerCommand));
  const state: AgentGraphState = {
    sessionId: input.session.sessionId,
    customerId: input.session.customerId,
    channel: 'kfc',
    latestUserMessage: input.latestUserMessage,
    intent: 'unclear',
    userConfirmedOrder: toolNames.includes('placeOrder'),
    escalationReasons: [],
    retrievedEvidence: [],
    entities: entitiesFor(input.customerCommand, toolNames),
    ...(exposesCart ? { cart: input.session.cart } : {}),
    ...(input.session.address ? { address: input.session.address } : {}),
    ...(input.session.fulfillment ? { fulfillment: input.session.fulfillment } : {}),
    ...(input.session.orderPreview ? { orderPreview: input.session.orderPreview } : {}),
    ...(input.session.order ? { order: input.session.order } : {}),
    ...(input.session.paymentAttempt ? { paymentAttempt: input.session.paymentAttempt } : {}),
  };

  for (const { call, result } of results) {
    switch (result.toolName) {
      case 'searchMenu':
        state.menuSearchResults = result.value.items.map((item) => ({
          ...item,
          originalPriceVnd: item.originalPriceVnd ?? null,
        }));
        break;
      case 'recommendAddOns':
        state.menuSearchResults = result.value;
        break;
      case 'getItemDetails':
        state.menuItemDetail = result.value;
        break;
      case 'getModifierOptions':
        state.menuModifierOptions = result.value;
        break;
      case 'searchPromotions':
        state.promotionOffers = result.value;
        break;
      case 'explainPromotion':
        state.promotionOffers = [result.value];
        break;
      case 'validateVoucher':
        state.promotionContext = {
          matchedOfferIds: [],
          validation: result.value,
          caveats: [],
        };
        break;
      case 'searchContentPolicy':
      case 'answerAllergenQuestion':
        state.contentEvidence = result.value;
        break;
      case 'listPaymentMethods':
        state.paymentMethodEvidence = result.value;
        break;
      case 'collectInvoice':
        state.invoiceRequest = result.value;
        break;
      case 'handoff': {
        const reasons = Array.isArray(call.arguments.reasons)
          ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
          : [];
        state.handoff = {
          escalationId: result.value.escalationId,
          reasons,
        };
        break;
      }
      default:
        break;
    }
  }

  return selectKfcGenUiAttachment({ state, turnToolNames: toolNames });
}
