import type { CustomerCommand } from '../domain/customerCommand.js';
import {
  deliveryAddressRequiredFields,
  type DeliveryAddressRequiredField,
  type MenuItem,
} from '../domain/types.js';
import type {
  AgentGraphState,
  TrustedPresentationDirective,
} from '../graph/state.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type {
  CompactMenuItem,
  MenuSearchMode,
  ToolCallResult,
  ToolName,
} from '../ordering/types.js';
import { replaceVerifiedCollection } from '../ordering/verifiedCollections.js';
import type { OpenAiToolCallTrace } from './openAiKfcAgent.js';
import type { KfcToolSession } from './kfcOpenAiTools.js';

export interface SelectKfcOpenAiGenUiInput {
  session: KfcToolSession;
  latestUserMessage: string;
  toolCalls: OpenAiToolCallTrace[];
  customerCommand?: CustomerCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type SuccessfulToolCallResult = Exclude<ToolCallResult, { ok: false }>;

const COMPACT_MENU_ITEM_LIMIT = 5;

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

function compactMenuItem(item: MenuItem): MenuItem {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    categoryId: item.categoryId,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
    ...(item.isCustomize !== undefined
      ? { isCustomize: item.isCustomize }
      : {}),
    ...(item.isQuickCombo !== undefined
      ? { isQuickCombo: item.isQuickCombo }
      : {}),
    ...(item.hasModifiers !== undefined
      ? { hasModifiers: item.hasModifiers }
      : {}),
  };
}

function menuItemFromSearchResult(item: CompactMenuItem): MenuItem {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    categoryId: item.category,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd ?? null,
    imageUrl: item.imageUrl,
    available: item.available,
    isCustomize: item.isCustomize,
    hasModifiers: item.hasModifiers,
  };
}

function uniqueMenuItems(items: readonly MenuItem[]): MenuItem[] {
  return [
    ...new Map(
      items.map((item) => [item.code, compactMenuItem(item)]),
    ).values(),
  ];
}

function compactRankedMenuItems(
  rankedGroups: readonly (readonly MenuItem[])[],
): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  const ranks = Math.max(0, ...rankedGroups.map((group) => group.length));
  for (let rank = 0; rank < ranks; rank += 1) {
    for (const group of rankedGroups) {
      const item = group[rank];
      if (!item || seen.has(item.code)) continue;
      seen.add(item.code);
      items.push(compactMenuItem(item));
      if (items.length === COMPACT_MENU_ITEM_LIMIT) return items;
    }
  }
  return items;
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
  if (attachment) {
    if (attachment.widgetKind !== 'smartMenuPicker') return attachment;

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
  // Dynamic PVCFC GenUI attachment when ordering tools are elided
  const msgLower = (input.latestUserMessage || '').toLowerCase();
  const isPvcfc =
    msgLower.includes('lúa') ||
    msgLower.includes('phân bón') ||
    msgLower.includes('đạm cà mau') ||
    msgLower.includes('héc') ||
    msgLower.includes('phèn') ||
    msgLower.includes('thối rễ') ||
    msgLower.includes('đại lý') ||
    msgLower.includes('kỹ sư') ||
    msgLower.includes('quy trình') ||
    msgLower.includes('tính');

  if (!isPvcfc) return undefined;

  const id = `genui_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (
    msgLower.includes('lúa') ||
    msgLower.includes('quy trình') ||
    msgLower.includes('lịch bón')
  ) {
    return {
      id,
      lifecycleStage: 'active',
      widgetKind: 'fertilizerSchedule',
      status: 'active',
      title: 'Lịch Bón Phân Cây Trồng (Đạm Cà Mau)',
      data: {
        type: 'FertilizerScheduleCard',
        title: 'Lịch Bón Phân Cây Trồng (Đạm Cà Mau)',
        stages: [
          {
            name: 'Bón lót (Làm đất / Sạ)',
            timing: '0 - 3 ngày sau sạ',
            dosage: 'Organic OM Cà Mau (500kg/Ha) + N46.Plus (30kg/Ha)',
          },
          {
            name: 'Bón thúc đợt 1 (Đẻ nhánh)',
            timing: '12 - 15 ngày sau sạ',
            dosage: 'N46.Plus Cà Mau (50kg/Ha)',
          },
          {
            name: 'Bón thúc đợt 2 (Làm đòng)',
            timing: '40 - 45 ngày sau sạ',
            dosage: 'NPK Cà Mau 20-20-15 (100kg/Ha) + Kali 61 (30kg/Ha)',
          },
        ],
      },
      actions: [],
    };
  }

  if (
    msgLower.includes('tính') ||
    msgLower.includes('bao') ||
    msgLower.includes('héc') ||
    msgLower.includes('ha')
  ) {
    const areaMatch = msgLower.match(/(\d+)\s*(héc|ha|công)/i);
    const areaHa = areaMatch ? Number.parseInt(areaMatch[1], 10) : 5;
    return {
      id,
      lifecycleStage: 'active',
      widgetKind: 'dosageCalculator',
      status: 'active',
      title: 'Bảng Tính Số Bao Phân Bón Cà Mau',
      data: {
        type: 'DosageCalculatorCard',
        title: 'Bảng Tính Số Bao Phân Bón Cà Mau',
        areaHa: Number.isNaN(areaHa) ? 5 : areaHa,
      },
      actions: [],
    };
  }

  if (
    msgLower.includes('vàng lá') ||
    msgLower.includes('thối rễ') ||
    msgLower.includes('bệnh')
  ) {
    return {
      id,
      lifecycleStage: 'active',
      widgetKind: 'diagnosticProtocol',
      status: 'active',
      title: 'Phác Đồ Cấp Bách Phục Hồi Bộ Rễ Cây',
      data: {
        type: 'DiagnosticProtocolCard',
        title: 'Phác Đồ Cấp Bách Phục Hồi Bộ Rễ Cây',
        warning: 'Ngưng ngay đạm hóa học khi rễ bị thối đen!',
        steps: [
          '1. Xả cạn nước mương vườn, thông thoáng đất',
          '2. Rải vôi bột (500kg/Ha) để nâng pH đất > 6.0',
          '3. Bón Organic OM Cà Mau (3-5kg/gốc) sau 7 ngày để kích rễ tơ',
        ],
      },
      actions: [],
    };
  }

  if (
    msgLower.includes('đại lý') ||
    msgLower.includes('kỹ sư') ||
    msgLower.includes('ph')
  ) {
    return {
      id,
      lifecycleStage: 'active',
      widgetKind: 'dealerLocator',
      status: 'active',
      title: 'Đại Lý Ủy Quyền & Đặt Lịch Kỹ Sư PVCFC',
      data: {
        type: 'DealerLocatorCard',
        title: 'Đại Lý Ủy Quyền & Đặt Lịch Kỹ Sư PVCFC',
        dealerName: 'Đại Lý Voi Vàng (Tư Hải)',
        address: 'QL1A, Thị trấn Cái Nước, H. Cái Nước, Cà Mau',
        phone: '1800 888606',
      },
      actions: [],
    };
  }

  return {
    id,
    lifecycleStage: 'active',
    widgetKind: 'capabilitiesOverview',
    status: 'active',
    title: 'Năng Lực Trợ Lý AI Phân Bón Cà Mau',
    data: {
      type: 'CapabilitiesOverviewCard',
      title: 'Các Năng Lực Hỗ Trợ Bà Con (Phân Bón Cà Mau)',
      items: [
        'Lịch bón phân & thổ nhưỡng đất chua phèn, phù sa, Tây Nguyên',
        'Bảng tính tự động quy đổi ra số bao 50kg theo Héc-ta',
        'Chẩn đoán sâu bệnh & phác đồ ngưng đạm rải vôi sinh học',
        'Kết nối đại lý chính hãng & hẹn Kỹ sư Nông nghiệp đo pH tận vườn',
      ],
    },
    actions: [],
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
  const currentMenuGroups: Array<{
    mode: MenuSearchMode;
    items: MenuItem[];
  }> = [];
  for (const { result } of results) {
    switch (result.toolName) {
      case 'searchMenu':
        currentMenuGroups.push({
          mode: result.value.mode,
          items: result.value.items.map(menuItemFromSearchResult),
        });
        break;
      case 'recommendAddOns':
        currentMenuGroups.push({ mode: 'search', items: result.value });
        break;
      default:
        break;
    }
  }
  const fullMenuGroups = currentMenuGroups.filter(
    ({ mode }) => mode === 'full',
  );
  const currentMenuItems =
    fullMenuGroups.length > 0
      ? uniqueMenuItems(fullMenuGroups.flatMap(({ items }) => items))
      : compactRankedMenuItems(currentMenuGroups.map(({ items }) => items));
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
    ...(input.session.deliveryAddressDraft
      ? { deliveryAddressDraft: input.session.deliveryAddressDraft }
      : {}),
    ...(input.session.deliveryAddressStatus
      ? { deliveryAddressStatus: input.session.deliveryAddressStatus }
      : {}),
    ...(input.session.deliveryAddressMissingFields
      ? {
          deliveryAddressMissingFields:
            input.session.deliveryAddressMissingFields,
        }
      : {}),
    ...(input.session.deliveryAdministrativeOptions
      ? {
          deliveryAdministrativeOptions:
            input.session.deliveryAdministrativeOptions,
        }
      : {}),
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
    ...(input.session.handoff ? { handoff: input.session.handoff } : {}),
  };

  for (const { call, result } of results) {
    switch (result.toolName) {
      case 'searchMenu':
      case 'recommendAddOns':
        break;
      case 'getItemDetails':
        state.menuItemDetail = compactMenuItem(result.value);
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
      case 'quoteFulfillment': {
        const value = result.value;
        if (
          isRecord(value) &&
          (value.status === 'incomplete' ||
            value.status === 'unsupported' ||
            value.status === 'quoted') &&
          isRecord(value.addressDraft)
        ) {
          state.deliveryAddressDraft =
            value.addressDraft as AgentGraphState['deliveryAddressDraft'];
          state.deliveryAddressStatus = value.status;
          state.deliveryAddressMissingFields = Array.isArray(
            value.missingFields,
          )
            ? value.missingFields.filter(
                (field): field is DeliveryAddressRequiredField =>
                  typeof field === 'string' &&
                  deliveryAddressRequiredFields.some(
                    (requiredField) => requiredField === field,
                  ),
              )
            : [];
        }
        break;
      }
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

  if (currentMenuItems.length > 0) {
    state.menuSearchResults = currentMenuItems;
  }

  const comparedItems = [
    ...new Map(
      results.flatMap(({ result }) =>
        result.toolName === 'getItemDetails'
          ? [[result.value.code, compactMenuItem(result.value)] as const]
          : [],
      ),
    ).values(),
  ];
  if (comparedItems.length > 1) {
    state.menuSearchResults = comparedItems;
    state.menuModifierOptions = undefined;
  }

  return { state, toolNames };
}
