import type { CustomerCommand } from '../domain/customerCommand.js';
import type {
  AgentGraphState,
  TrustedPresentationDirective,
} from '../graph/state.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { ToolCallResult, ToolName } from '../ordering/types.js';
import { replaceVerifiedCollection } from '../ordering/verifiedCollections.js';
import type { OpenAiToolCallTrace } from './openAiKfcAgent.js';
import type { KfcToolSession } from './kfcOpenAiTools.js';

export interface SelectKfcOpenAiGenUiInput {
  session: KfcToolSession;
  latestUserMessage: string;
  toolCalls: OpenAiToolCallTrace[];
  customerCommand?: CustomerCommand;
}

type SuccessfulToolCallResult = Exclude<ToolCallResult, { ok: false }>;

function successfulResult(
  call: OpenAiToolCallTrace,
): SuccessfulToolCallResult | undefined {
  if (typeof call.result !== 'object' || call.result === null) return undefined;
  const result = call.result as Partial<ToolCallResult>;
  return result.ok === true && result.toolName === call.name
    ? (result as SuccessfulToolCallResult)
    : undefined;
}

function completeFullMenuResult(
  call: OpenAiToolCallTrace,
): Extract<SuccessfulToolCallResult, { toolName: 'searchMenu' }> | undefined {
  const result = successfulResult(call);
  if (
    result?.toolName !== 'searchMenu' ||
    result.value.mode !== 'full' ||
    result.value.items.length === 0 ||
    result.value.items.length !== result.value.total
  ) {
    return undefined;
  }
  const { category, maxPriceVnd, partySize, modifierQueries, query } =
    call.arguments;
  if (
    category !== undefined ||
    maxPriceVnd !== undefined ||
    partySize !== undefined ||
    modifierQueries !== undefined ||
    (typeof query === 'string' && query.trim().length > 0)
  ) {
    return undefined;
  }
  return result;
}

function presentationFor(
  command: CustomerCommand | undefined,
  toolNames: ToolName[],
): TrustedPresentationDirective | undefined {
  const preferredSurface =
    command?.kind === 'edit_cart' || toolNames.includes('previewCart')
      ? 'cart'
      : command?.kind === 'start_fulfillment' ||
          (command?.kind === 'cart_draft_commit' &&
            command.continueToFulfillment) ||
          command?.kind === 'submit_address' ||
          toolNames.some(
            (name) =>
              name === 'findStores' ||
              name === 'checkStoreAvailability' ||
              name === 'quoteFulfillment',
          )
        ? 'fulfillment'
        : undefined;
  if (!preferredSurface && command?.kind !== 'accept_fulfillment') {
    return undefined;
  }
  return {
    ...(preferredSurface ? { preferredSurface } : {}),
    ...(command?.kind === 'accept_fulfillment'
      ? { fulfillmentAccepted: true }
      : {}),
  };
}

export function selectKfcOpenAiGenUi(
  input: SelectKfcOpenAiGenUiInput,
): KfcGenUiAttachment | undefined {
  const { state, toolNames } = projectKfcOpenAiGenUiState(input);
  const attachment = selectKfcGenUiAttachment({
    state,
    turnToolNames: toolNames,
  });
  if (attachment?.widgetKind !== 'smartMenuPicker') return attachment;

  const fullMenu = input.toolCalls.map(completeFullMenuResult).find(Boolean);
  if (!fullMenu) return attachment;

  return {
    ...attachment,
    widgetKind: 'fullMenuBrowser',
    title: 'Toàn bộ thực đơn',
    data: {
      ...attachment.data,
      total: fullMenu.value.total,
      returned: fullMenu.value.items.length,
      complete: true,
    },
  };
}

export function projectKfcOpenAiGenUiState(input: SelectKfcOpenAiGenUiInput): {
  state: AgentGraphState;
  toolNames: ToolName[];
} {
  const results = input.toolCalls.flatMap((call) => {
    const result = successfulResult(call);
    return result ? [{ call, result }] : [];
  });
  const toolNames = results.map(({ result }) => result.toolName);
  const state: AgentGraphState = {
    sessionId: input.session.sessionId,
    customerId: input.session.customerId,
    channel: 'kfc',
    latestUserMessage: input.latestUserMessage,
    userConfirmedOrder: toolNames.includes('placeOrder'),
    escalationReasons: [],
    retrievedEvidence: [],
    ...(presentationFor(input.customerCommand, toolNames)
      ? {
          trustedPresentation: presentationFor(
            input.customerCommand,
            toolNames,
          ),
        }
      : {}),
    cart: input.session.cart,
    ...(input.session.address ? { address: input.session.address } : {}),
    ...(input.session.fulfillment
      ? { fulfillment: input.session.fulfillment }
      : {}),
    ...(input.session.orderPreview
      ? { orderPreview: input.session.orderPreview }
      : {}),
    ...(input.session.order ? { order: input.session.order } : {}),
    ...(input.session.selectedPaymentMethod
      ? { selectedPaymentMethod: input.session.selectedPaymentMethod }
      : {}),
    ...(input.session.activeCollectionKeys
      ? { activeCollectionKeys: input.session.activeCollectionKeys }
      : {}),
    ...(input.session.verifiedCollections
      ? { verifiedCollections: input.session.verifiedCollections }
      : {}),
    ...(input.session.paymentAttempt
      ? { paymentAttempt: input.session.paymentAttempt }
      : {}),
  };

  for (const { call, result } of results) {
    switch (result.toolName) {
      case 'searchMenu':
        state.menuSearchResults = result.value.items.map((item) => ({
          ...item,
          categoryId: item.category,
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
        {
          const collectionKey =
            input.session.activeCollectionKeys?.listPaymentMethods;
          const collection = collectionKey
            ? input.session.verifiedCollections?.listPaymentMethods?.[
                collectionKey
              ]
            : undefined;
          state.paymentMethodEvidence = collection
            ? collection.result.items
            : result.value;
          if (collection) {
            state.activeCollectionKeys = {
              ...state.activeCollectionKeys,
              listPaymentMethods: collection.key,
            };
            state.verifiedCollections = replaceVerifiedCollection(
              state.verifiedCollections,
              'listPaymentMethods',
              collection,
            );
          }
        }
        break;
      case 'collectInvoice':
        state.invoiceRequest = result.value;
        break;
      case 'handoff': {
        const reasons = Array.isArray(call.arguments.reasons)
          ? call.arguments.reasons.filter(
              (reason): reason is string => typeof reason === 'string',
            )
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

  return { state, toolNames };
}
