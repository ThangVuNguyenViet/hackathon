import type { Address, MenuItem, Order } from '../domain/types.js';
import type { VerifiedRef } from '../domain/verifiedRef.js';
import type { AgentGraphState } from '../graph/state.js';
import { activeCartSupersedesSubmittedOrder } from '../graph/activeCheckout.js';
import type { PaymentAttempt, ToolName } from '../ordering/types.js';
import {
  KFC_GENUI_SCHEMA_VERSION,
  kfcGenUiVerifiedStateRevision,
  type KfcGenUiAttachment,
} from './kfcGenUi.js';
import { customerSupportReason } from '../presentation/customerLanguage.js';
import {
  activePaymentMethodCollectionAuthority,
  selectedPaymentMethodAuthorityMatchesActiveCollection,
} from '../ordering/paymentMethodAuthority.js';
import {
  paymentAttemptForVerifiedOrder,
  paymentAttemptMatchesOrder,
} from '../ordering/paymentOrderAuthority.js';
import {
  projectFulfillment,
  projectPaymentMethod,
} from '../agent/modelPublicationStateProjection.js';

const smartMenuActions: KfcGenUiAttachment['actions'] = [
  { id: 'add_items', label: 'Xác nhận món', intent: 'primary' },
];

function verifiedMenuItems(state: AgentGraphState) {
  return (
    state.activeMenuCollection?.result.items ?? state.menuSearchResults ?? []
  );
}

function verifiedMenuCategories(
  items: MenuItem[],
): Array<{ categoryId: string; label: string }> {
  const seen = new Set<string>();
  return items.flatMap(({ categoryId, category }) => {
    if (seen.has(categoryId)) return [];
    seen.add(categoryId);
    return [{ categoryId, label: category }];
  });
}

function menuCollectionData(
  state: AgentGraphState,
  includeCurrentPromotionEvidence: boolean,
): Record<string, unknown> {
  const items = verifiedMenuItems(state);
  const collection = state.activeMenuCollection;
  return {
    latestUserMessage: state.latestUserMessage,
    items,
    categories: verifiedMenuCategories(items),
    selectionLimit: 5,
    ...(includeCurrentPromotionEvidence
      ? { promotions: state.promotionOffers ?? [] }
      : {}),
    ...(collection
      ? {
          total: collection.result.total,
          returned: collection.result.returned,
          complete: collection.result.complete,
          collection: {
            key: collection.key,
            revision: collection.revision,
            total: collection.result.total,
            returned: collection.result.returned,
            complete: collection.result.complete,
            scope: collection.result.scope,
            ...(collection.result.cursor
              ? { cursor: collection.result.cursor }
              : {}),
          },
        }
      : {}),
  };
}

type PaymentStatusPresentation =
  | {
      executionOutcome: 'success';
      status: PaymentAttempt['status'];
    }
  | {
      executionOutcome: 'error';
      errorCode: 'payment_failed' | 'payment_status_check_failed';
    };

export interface SelectKfcGenUiInput {
  state: AgentGraphState;
  /** Full state persisted with this turn; presentation policy may hide fields but cannot change authority. */
  authorityState?: AgentGraphState;
  turnToolNames: ToolName[];
  reuseVerifiedMenuResults?: boolean;
  /**
   * Turn-local authenticated private evidence. The address may be rendered in
   * this response, while only its opaque ref is carried by the action.
   */
  savedAddressPresentation?: {
    address: Address;
    ref: VerifiedRef;
  };
  /**
   * Turn-local authenticated recent-order evidence. It may populate the
   * current payment-status presentation but must not be persisted as durable
   * customer state or conversation metadata.
   */
  recentOrderPresentation?: Order;
  /**
   * Turn-local issued result of checkPaymentStatus. This can differ from the
   * durable payment attempt when the provider check itself reports failure.
   */
  paymentStatusPresentation?: PaymentStatusPresentation;
  issuedAt?: Date;
}

interface PaymentStatusEvidence {
  resolution: 'current_tool' | 'consistent' | 'single_source' | 'conflict';
  selectedStatus?: string;
  selectedSource?:
    'order' | 'paymentAttempt' | 'matching_sources' | 'payment_status_check';
  statuses: {
    order?: string;
    paymentAttempt?: string;
  };
  currentCheck?: PaymentStatusPresentation;
}

interface PaymentOrderPresentation {
  id: string;
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  amountVnd: number;
}

function paymentOrderPresentation(
  order: Order | undefined,
): PaymentOrderPresentation | undefined {
  if (!order) return undefined;
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    amountVnd: order.cart.totalVnd,
  };
}

function paymentStatusEvidence(
  state: AgentGraphState,
  turnToolNames: ToolName[],
  currentCheck?: SelectKfcGenUiInput['paymentStatusPresentation'],
): PaymentStatusEvidence | undefined {
  const orderStatus = state.order?.paymentStatus;
  const paymentAttemptStatus = state.paymentAttempt?.status;
  const statuses = {
    ...(orderStatus ? { order: orderStatus } : {}),
    ...(paymentAttemptStatus ? { paymentAttempt: paymentAttemptStatus } : {}),
  };

  if (currentCheck) {
    return {
      resolution: 'current_tool',
      ...(currentCheck.executionOutcome === 'success'
        ? {
            selectedStatus: currentCheck.status,
            selectedSource: 'payment_status_check' as const,
          }
        : {}),
      statuses,
      currentCheck,
    };
  }
  const latestStatusTool = [...turnToolNames]
    .reverse()
    .find((name) => name === 'checkPaymentStatus' || name === 'getOrderStatus');
  if (latestStatusTool === 'checkPaymentStatus' && paymentAttemptStatus) {
    return {
      resolution: 'current_tool',
      selectedStatus: paymentAttemptStatus,
      selectedSource: 'paymentAttempt',
      statuses,
    };
  }
  if (latestStatusTool === 'getOrderStatus' && orderStatus) {
    return {
      resolution: 'current_tool',
      selectedStatus: orderStatus,
      selectedSource: 'order',
      statuses,
    };
  }
  if (orderStatus && paymentAttemptStatus) {
    return orderStatus === paymentAttemptStatus
      ? {
          resolution: 'consistent',
          selectedStatus: orderStatus,
          selectedSource: 'matching_sources',
          statuses,
        }
      : { resolution: 'conflict', statuses };
  }
  if (paymentAttemptStatus) {
    return {
      resolution: 'single_source',
      selectedStatus: paymentAttemptStatus,
      selectedSource: 'paymentAttempt',
      statuses,
    };
  }
  if (orderStatus) {
    return {
      resolution: 'single_source',
      selectedStatus: orderStatus,
      selectedSource: 'order',
      statuses,
    };
  }
  return undefined;
}

function moneyVnd(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

function paymentActionLabel(
  state: AgentGraphState,
  methodId: string | undefined,
): string {
  return (
    state.paymentMethodEvidence?.find((method) => method.methodId === methodId)
      ?.displayName ?? 'Mở thanh toán'
  );
}

function selectKfcGenUiAttachmentUnbound(
  input: SelectKfcGenUiInput,
): KfcGenUiAttachment | undefined {
  const { state, turnToolNames } = input;
  const currentPaymentOrder =
    input.paymentStatusPresentation && !state.order
      ? input.recentOrderPresentation
      : undefined;
  const presentationState = currentPaymentOrder
    ? { ...state, order: currentPaymentOrder }
    : state;
  const refreshedSubmittedStatus =
    turnToolNames.some(
      (name) => name === 'checkPaymentStatus' || name === 'getOrderStatus',
    ) || input.paymentStatusPresentation !== undefined;
  const hideSubmittedHistory =
    activeCartSupersedesSubmittedOrder(presentationState) &&
    !refreshedSubmittedStatus;
  const postOrderState: AgentGraphState = hideSubmittedHistory
    ? {
        ...presentationState,
        order: undefined,
        paymentAttempt: undefined,
      }
    : presentationState;
  const authorizedPostOrderState: AgentGraphState = {
    ...postOrderState,
    paymentAttempt: paymentAttemptForVerifiedOrder(
      postOrderState.paymentAttempt,
      postOrderState.order,
    ),
  };
  const statusEvidence = paymentStatusEvidence(
    authorizedPostOrderState,
    turnToolNames,
    input.paymentStatusPresentation,
  );
  const presentedOrder = paymentOrderPresentation(
    authorizedPostOrderState.order,
  );
  const idBase = `${state.sessionId}_${Date.now()}`;
  const usesConfirmedSavedAddress =
    state.trustedPresentation?.fulfillmentAccepted === true;
  const prefersFulfillmentSurface =
    state.trustedPresentation?.preferredSurface === 'fulfillment';
  const hasCurrentMenuEvidence = turnToolNames.some(
    (name) =>
      name === 'searchMenu' ||
      name === 'recommendAddOns' ||
      name === 'getItemDetails',
  );
  const currentModifierItemCode = state.menuModifierOptions?.itemCode;
  const keepsModifierSurface = Boolean(
    currentModifierItemCode &&
    (turnToolNames.includes('getModifierOptions') ||
      (turnToolNames.includes('updateCart') &&
        ((state.selectedModifiers?.[currentModifierItemCode]?.length ?? 0) >
          0 ||
          (state.cart?.items.find(
            (item) => item.itemCode === currentModifierItemCode,
          )?.modifiers?.length ?? 0) > 0))),
  );
  const hasCurrentPromotionEvidence = turnToolNames.some(
    (name) => name === 'searchPromotions' || name === 'explainPromotion',
  );
  const isPromotionOnlyTurn =
    hasCurrentPromotionEvidence && !hasCurrentMenuEvidence;

  const supportReasons = (
    state.handoff?.reasons ?? state.escalationReasons
  ).filter(
    (reason) =>
      reason !== 'menu_item_verification_required' &&
      reason !== 'unverified_item_code' &&
      reason !== 'handoff_not_justified' &&
      reason !== 'previous_order_confirmation_required',
  );
  if (state.handoff) {
    return {
      id: `genui_${idBase}_support`,
      lifecycleStage: 'support',
      widgetKind: 'supportHandoff',
      status: 'active',
      title: 'Cần nhân viên hỗ trợ',
      summary: state.handoff.reasons
        .map(customerSupportReason)
        .filter((reason): reason is string => Boolean(reason))
        .join(', '),
      data: {
        handoff: state.handoff,
        reasons: supportReasons,
        handoffStatus: 'queued',
      },
      actions: [
        {
          id: 'send_issue_summary',
          label: 'Bổ sung thông tin',
          intent: 'primary',
        },
      ],
    };
  }

  if (
    state.paymentMethodEvidence?.length &&
    turnToolNames.includes('listPaymentMethods')
  ) {
    const paymentMethodCollection =
      activePaymentMethodCollectionAuthority(state);
    if (!paymentMethodCollection) return undefined;
    return {
      id: `genui_${idBase}_payment_methods`,
      lifecycleStage: 'payment_method',
      widgetKind: 'paymentMethodPicker',
      status: 'active',
      title: 'Chọn phương thức thanh toán',
      data: {
        methods: state.paymentMethodEvidence.map((method) =>
          projectPaymentMethod(method as unknown as Record<string, unknown>),
        ),
        paymentMethodCollection,
      },
      actions: [
        {
          id: 'select_payment_method',
          label: 'Chọn phương thức',
          intent: 'primary',
        },
      ],
    };
  }

  if (
    (state.contentEvidence?.length ?? 0) > 0 &&
    turnToolNames.includes('answerAllergenQuestion')
  ) {
    const evidence = state.contentEvidence![0]!;
    return {
      id: `genui_${idBase}_allergen`,
      lifecycleStage: 'content',
      widgetKind: 'allergenEvidence',
      status: 'active',
      title: 'Thông tin dị ứng',
      data: { evidence, item: null },
      actions: [
        {
          id: 'open_allergen_chart',
          label: 'Xem bảng dị ứng',
          value: evidence.sourceUrl,
          payload: { sourceUrl: evidence.sourceUrl },
        },
      ],
    };
  }

  if (
    hasCurrentMenuEvidence &&
    !keepsModifierSurface &&
    !turnToolNames.includes('updateCart') &&
    (state.menuSearchResults?.length ?? 0) > 0 &&
    !isPromotionOnlyTurn &&
    !prefersFulfillmentSurface
  ) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: 'menu',
      widgetKind: 'smartMenuPicker',
      status: 'active',
      title: 'Gợi ý món phù hợp',
      data: menuCollectionData(state, hasCurrentPromotionEvidence),
      actions: smartMenuActions,
    };
  }

  const hasPaidPaymentEvidence =
    statusEvidence?.selectedStatus === 'paid' ||
    (statusEvidence?.resolution === 'conflict' &&
      (statusEvidence.statuses.order === 'paid' ||
        statusEvidence.statuses.paymentAttempt === 'paid'));
  const durablePaymentAttemptMatchesOrder = paymentAttemptMatchesOrder(
    state.paymentAttempt,
    state.order,
  );
  const canContinuePayment =
    !currentPaymentOrder &&
    input.paymentStatusPresentation?.executionOutcome !== 'error' &&
    ((durablePaymentAttemptMatchesOrder &&
      state.paymentAttempt?.status === 'pending' &&
      Boolean(state.paymentAttempt.paymentUrl)) ||
      Boolean(
        state.order &&
        state.selectedPaymentMethod &&
        selectedPaymentMethodAuthorityMatchesActiveCollection(
          state,
          state.selectedPaymentMethod,
        ),
      ));
  const continuePaymentMethodId =
    (durablePaymentAttemptMatchesOrder
      ? state.paymentAttempt?.method
      : undefined) ?? state.selectedPaymentMethod?.methodId;
  const presentedPaymentAttempt =
    currentPaymentOrder &&
    input.paymentStatusPresentation?.executionOutcome === 'success'
      ? { status: input.paymentStatusPresentation.status }
      : authorizedPostOrderState.paymentAttempt;
  if (hasPaidPaymentEvidence) {
    return {
      id: `genui_${idBase}_tracking`,
      lifecycleStage: 'post_order',
      widgetKind: 'orderTrackingStatus',
      status: 'active',
      title: 'Theo dõi đơn hàng',
      data: {
        order: presentedOrder ?? null,
        paymentAttempt: presentedPaymentAttempt ?? null,
        fulfillment: state.fulfillment
          ? projectFulfillment(state.fulfillment)
          : null,
        ...(statusEvidence ? { paymentStatusEvidence: statusEvidence } : {}),
      },
      actions: state.order
        ? [
            {
              id: 'track_order',
              label: 'Theo dõi đơn',
              intent: 'primary',
            },
          ]
        : [],
    };
  }

  if (
    authorizedPostOrderState.order ||
    authorizedPostOrderState.paymentAttempt ||
    turnToolNames.some(
      (name) => name === 'checkPaymentStatus' || name === 'getOrderStatus',
    )
  ) {
    return {
      id: `genui_${idBase}_payment`,
      lifecycleStage: 'post_order',
      widgetKind: 'paymentOrderStatus',
      status: 'active',
      title: 'Trạng thái đơn hàng',
      data: {
        order: presentedOrder ?? null,
        paymentAttempt: presentedPaymentAttempt ?? null,
        ...(statusEvidence ? { paymentStatusEvidence: statusEvidence } : {}),
      },
      actions: [
        ...(canContinuePayment
          ? [
              {
                id: 'open_payment',
                label: paymentActionLabel(state, continuePaymentMethodId),
                intent: 'primary' as const,
                value: continuePaymentMethodId,
              },
            ]
          : []),
        { id: 'change_payment_method', label: 'Đổi phương thức' },
      ],
    };
  }

  if (supportReasons.length > 0 && !state.cart) {
    return {
      id: `genui_${idBase}_support`,
      lifecycleStage: 'support',
      widgetKind: 'supportHandoff',
      status: 'active',
      title: 'Cần nhân viên hỗ trợ',
      summary: supportReasons
        .map(customerSupportReason)
        .filter((reason): reason is string => Boolean(reason))
        .join(', '),
      data: {
        handoff: null,
        reasons: supportReasons,
        handoffStatus: 'requested',
      },
      actions: [
        { id: 'request_human', label: 'Gặp nhân viên ngay', intent: 'primary' },
      ],
    };
  }

  if (state.cart && state.trustedPresentation?.preferredSurface === 'cart') {
    return {
      id: `genui_${idBase}_cart`,
      lifecycleStage: 'cart',
      widgetKind: 'cartBuilder',
      status: 'active',
      title: 'Giỏ hàng của bạn',
      data: { cart: state.cart },
      actions: [
        {
          id: 'continue_to_fulfillment',
          label: 'Tiếp tục giao hàng',
          intent: 'primary',
        },
        { id: 'edit_cart', label: 'Sửa giỏ hàng' },
        { id: 'update_item_quantity', label: 'Đổi số lượng' },
        { id: 'remove_item', label: 'Xóa món', intent: 'destructive' },
      ],
    };
  }

  const verifiedMenuResults = verifiedMenuItems(state);
  const hasMenuResults = verifiedMenuResults.length > 0;
  if (
    input.reuseVerifiedMenuResults === true &&
    hasMenuResults &&
    !isPromotionOnlyTurn
  ) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: 'menu',
      widgetKind: 'smartMenuPicker',
      status: 'active',
      title: 'Gợi ý món phù hợp',
      data: menuCollectionData(state, hasCurrentPromotionEvidence),
      actions: smartMenuActions,
    };
  }

  if (
    ((prefersFulfillmentSurface && !state.fulfillment) ||
      input.savedAddressPresentation !== undefined ||
      turnToolNames.includes('getSavedAddresses') ||
      turnToolNames.includes('quoteFulfillment') ||
      turnToolNames.includes('findStores') ||
      turnToolNames.includes('checkStoreAvailability')) &&
    (input.savedAddressPresentation !== undefined ||
      !(usesConfirmedSavedAddress && state.cart && state.fulfillment))
  ) {
    const savedAddressCandidate = input.savedAddressPresentation?.address;
    const displayedAddress = savedAddressCandidate ?? state.address ?? null;
    const addressStatus = savedAddressCandidate
      ? 'candidate'
      : state.address
        ? 'confirmed'
        : 'missing';
    const canAcceptFulfillment = Boolean(displayedAddress);
    return {
      id: `genui_${idBase}_fulfillment`,
      lifecycleStage: 'fulfillment',
      widgetKind: 'addressFulfillmentCheck',
      status: 'active',
      title: 'Kiểm tra giao hàng',
      data: {
        cart: state.cart ?? null,
        address: displayedAddress,
        addressStatus,
        fulfillment:
          !savedAddressCandidate && state.fulfillment
            ? projectFulfillment(state.fulfillment)
            : null,
      },
      actions: canAcceptFulfillment
        ? [
            {
              id: 'accept_fulfillment',
              label: 'Giao đến địa chỉ này',
              intent: 'primary',
              ...(savedAddressCandidate
                ? { value: input.savedAddressPresentation?.ref.id }
                : {}),
            },
            { id: 'submit_address', label: 'Đổi địa chỉ' },
          ]
        : [
            {
              id: 'submit_address',
              label: 'Nhập địa chỉ giao hàng',
              intent: 'primary',
            },
          ],
    };
  }

  if (state.menuModifierOptions && keepsModifierSurface) {
    const actions = state.menuModifierOptions.modifierGroups.flatMap((group) =>
      group.options.map((option) => ({
        id: `customize_item:${encodeURIComponent(group.groupId)}:${encodeURIComponent(option.modifierId)}`,
        label: option.name,
        value: option.name,
        payload: {
          itemCode: state.menuModifierOptions!.itemCode,
          groupId: group.groupId,
          modifierId: option.modifierId,
        },
      })),
    );
    return {
      id: `genui_${idBase}_modifier`,
      lifecycleStage: 'menu',
      widgetKind: 'modifierPicker',
      status: 'active',
      title: `Tùy chỉnh ${state.menuModifierOptions.name}`,
      data: {
        modifierTree: state.menuModifierOptions,
        ...(state.cart ? { cart: state.cart } : {}),
      },
      actions,
    };
  }

  if (state.menuItemDetail && turnToolNames.includes('getItemDetails')) {
    return {
      id: `genui_${idBase}_menu_detail`,
      lifecycleStage: 'menu',
      widgetKind: 'productDetailCard',
      status: 'active',
      title: state.menuItemDetail.name,
      data: { item: state.menuItemDetail, items: [state.menuItemDetail] },
      actions: [
        {
          id: 'add_item',
          label: 'Thêm vào giỏ',
          intent: 'primary',
          value: state.menuItemDetail.name,
          payload: { itemCode: state.menuItemDetail.code, quantity: 1 },
        },
      ],
    };
  }

  if (
    (state.promotionOffers?.length ?? 0) > 0 &&
    turnToolNames.some(
      (name) => name === 'searchPromotions' || name === 'explainPromotion',
    )
  ) {
    return {
      id: `genui_${idBase}_promotions`,
      lifecycleStage: 'promotion',
      widgetKind: 'promotionGallery',
      status: 'active',
      title: 'Khuyến mãi đang áp dụng',
      data: { offers: state.promotionOffers },
      actions: [],
    };
  }

  if (state.cart && state.fulfillment && !state.order) {
    return {
      id: `genui_${idBase}_review`,
      lifecycleStage: 'checkout',
      widgetKind: 'orderReviewConfirm',
      status: 'active',
      title: 'Kiểm tra đơn trước khi đặt',
      data: {
        cart: state.cart,
        fulfillment: projectFulfillment(state.fulfillment),
        promotionContext: state.promotionContext ?? null,
        invoiceRequest: state.invoiceRequest ?? null,
        invoiceRequested: state.invoiceRequest !== undefined,
      },
      actions: [
        {
          id: 'confirm_order',
          label: `Đặt đơn ${moneyVnd(state.cart.totalVnd) || 'ngay'}`,
          intent: 'primary',
          value: 'confirmed',
        },
        { id: 'apply_voucher', label: 'Áp mã giảm giá' },
      ],
    };
  }

  if (state.cart) {
    return {
      id: `genui_${idBase}_cart`,
      lifecycleStage: 'cart',
      widgetKind: 'cartBuilder',
      status: 'active',
      title: 'Giỏ hàng của bạn',
      data: { cart: state.cart },
      actions: [
        {
          id: 'continue_to_fulfillment',
          label: 'Tiếp tục giao hàng',
          intent: 'primary',
        },
        { id: 'edit_cart', label: 'Sửa giỏ hàng' },
        { id: 'update_item_quantity', label: 'Đổi số lượng' },
        { id: 'remove_item', label: 'Xóa món', intent: 'destructive' },
      ],
    };
  }

  if (
    hasMenuResults &&
    !isPromotionOnlyTurn &&
    (input.reuseVerifiedMenuResults || hasCurrentMenuEvidence)
  ) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: 'menu',
      widgetKind: 'smartMenuPicker',
      status: 'active',
      title: 'Gợi ý món phù hợp',
      data: menuCollectionData(state, hasCurrentPromotionEvidence),
      actions: smartMenuActions,
    };
  }

  return undefined;
}

function actionLifecycleForWidget(
  widgetKind: KfcGenUiAttachment['widgetKind'],
): NonNullable<KfcGenUiAttachment['authority']>['actionLifecycle'] {
  switch (widgetKind) {
    case 'modifierPicker':
    case 'promotionGallery':
    case 'allergenEvidence':
    case 'cartBuilder':
    case 'orderTrackingStatus':
      return 'replayable';
    default:
      return 'one_shot';
  }
}

export function selectKfcGenUiAttachment(
  input: SelectKfcGenUiInput,
): KfcGenUiAttachment | undefined {
  const attachment = selectKfcGenUiAttachmentUnbound(input);
  if (!attachment) return undefined;
  const issuedAt = input.issuedAt ?? new Date();
  const expiresAt =
    attachment.expiresAt ??
    new Date(issuedAt.getTime() + 60 * 60_000).toISOString();
  return {
    ...attachment,
    expiresAt,
    authority: {
      schemaVersion: KFC_GENUI_SCHEMA_VERSION,
      sessionId: input.state.sessionId,
      customerId: input.state.customerId,
      verifiedRevision: kfcGenUiVerifiedStateRevision(
        input.authorityState ?? input.state,
      ),
      actionLifecycle: actionLifecycleForWidget(attachment.widgetKind),
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    },
  };
}
