import type { AgentGraphState } from "../graph/state.js";
import type { ToolName } from "../ordering/types.js";
import type { KfcGenUiAttachment } from "./kfcGenUi.js";

const maxMenuChoices = 5;

function groupRequestContext(state: AgentGraphState) {
  const normalized = state.latestUserMessage.toLowerCase().replace(/[.,]/g, '');
  const partySize = typeof state.entities?.partySize === 'number'
    ? state.entities.partySize
    : Number(/(?:cho|for)\s+(\d+)\s*(?:người|nguoi|people)/i.exec(normalized)?.[1] ?? 0) || undefined;
  const budgetMatch = /(\d+)\s*(k|nghìn|nghin|triệu|trieu)/i.exec(normalized);
  const budgetVnd = typeof state.entities?.budgetVnd === 'number'
    ? state.entities.budgetVnd
    : budgetMatch
      ? Number(budgetMatch[1]) * (/tri/i.test(budgetMatch[2]) ? 1_000_000 : 1_000)
      : undefined;
  return { partySize, budgetVnd };
}

function menuItemsWithContext(state: AgentGraphState) {
  const context = groupRequestContext(state);
  const choiceLimit = context.partySize || context.budgetVnd ? 3 : maxMenuChoices;
  return (state.menuSearchResults ?? []).slice(0, choiceLimit).map((item) => {
    const recommendedQuantity = context.budgetVnd
      ? Math.max(1, Math.floor(context.budgetVnd / item.priceVnd))
      : 1;
    const composedTotalVnd = item.priceVnd * recommendedQuantity;
    return {
      ...item,
      recommendedQuantity,
      composedTotalVnd,
      budgetDeltaVnd: context.budgetVnd === undefined ? undefined : context.budgetVnd - composedTotalVnd,
      servingCoverageVerified: false,
    };
  });
}

export interface SelectKfcGenUiInput {
  state: AgentGraphState;
  turnToolNames: ToolName[];
  reuseVerifiedMenuResults?: boolean;
}

interface PaymentStatusEvidence {
  resolution: 'current_tool' | 'consistent' | 'single_source' | 'conflict';
  selectedStatus?: string;
  selectedSource?: 'order' | 'paymentAttempt' | 'matching_sources';
  statuses: {
    order?: string;
    paymentAttempt?: string;
  };
}

function paymentStatusEvidence(state: AgentGraphState, turnToolNames: ToolName[]): PaymentStatusEvidence | undefined {
  const orderStatus = state.order?.paymentStatus;
  const paymentAttemptStatus = state.paymentAttempt?.status;
  const statuses = {
    ...(orderStatus ? { order: orderStatus } : {}),
    ...(paymentAttemptStatus ? { paymentAttempt: paymentAttemptStatus } : {}),
  };

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
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
}

function paymentActionLabel(method: string | undefined): string {
  switch (method) {
    case "zalopay":
      return "Thanh toán ZaloPay";
    case "card":
      return "Thanh toán thẻ";
    case "cod":
      return "Thanh toán khi nhận hàng";
    case "momo":
      return "Thanh toán MoMo";
    default:
      return "Mở thanh toán";
  }
}

export function selectKfcGenUiAttachment(
  input: SelectKfcGenUiInput,
): KfcGenUiAttachment | undefined {
  const { state, turnToolNames } = input;
  const statusEvidence = paymentStatusEvidence(state, turnToolNames);
  const idBase = `${state.sessionId}_${Date.now()}`;
  if (
    typeof state.entities === "object" &&
    state.entities !== null &&
    state.entities.suppressGenUi === true
  ) {
    return undefined;
  }
  const usesConfirmedSavedAddress =
    typeof state.entities === "object" &&
    state.entities !== null &&
    (state.entities.useSavedAddress === true ||
      state.entities.fulfillmentAccepted === true);
  const keepsMenuSurface =
    typeof state.entities === "object" &&
    state.entities !== null &&
    state.entities.keepMenuSurface === true;
  const prefersFulfillmentSurface =
    typeof state.entities === "object" &&
    state.entities !== null &&
    state.entities.preferFulfillmentSurface === true;
  const hasCurrentMenuEvidence = turnToolNames.some(
    (name) => name === "searchMenu" || name === "recommendAddOns" || name === "getItemDetails",
  );
  const isPromotionOnlyTurn =
    (turnToolNames.some((name) => name === "searchPromotions" || name === "explainPromotion") ||
      /khuyến mãi|khuyen mai|ưu đãi|uu dai|voucher|promotion|discount/i.test(state.latestUserMessage)) &&
    !hasCurrentMenuEvidence;

  const supportReasons = (
    state.handoff?.reasons ?? state.escalationReasons
  ).filter(
    (reason) =>
      reason !== "menu_item_verification_required" &&
      reason !== "unverified_item_code" &&
      reason !== "handoff_not_justified" &&
      reason !== "previous_order_confirmation_required",
  );
  if (state.handoff || (supportReasons.length > 0 && !state.cart)) {
    return {
      id: `genui_${idBase}_support`,
      lifecycleStage: "support",
      widgetKind: "supportHandoff",
      status: "active",
      title: "Cần nhân viên hỗ trợ",
      summary: state.handoff?.reasons.join(", ") || supportReasons.join(", "),
      data: { handoff: state.handoff ?? null, reasons: supportReasons, handoffStatus: state.handoff ? "queued" : "requested" },
      actions: state.handoff
        ? [{ id: "send_issue_summary", label: "Bổ sung thông tin", intent: "primary" }]
        : [{ id: "request_human", label: "Gặp nhân viên ngay", intent: "primary" }],
    };
  }

  if (
    state.paymentMethodEvidence?.length &&
    turnToolNames.includes("listPaymentMethods") &&
    !state.order &&
    !state.paymentAttempt
  ) {
    return {
      id: `genui_${idBase}_payment_methods`,
      lifecycleStage: "payment_method",
      widgetKind: "paymentMethodPicker",
      status: "active",
      title: "Chọn phương thức thanh toán",
      data: { methods: state.paymentMethodEvidence },
      actions: [{ id: "select_payment_method", label: "Chọn phương thức", intent: "primary" }],
    };
  }

  const hasPaidPaymentEvidence = statusEvidence?.selectedStatus === 'paid' || (
    statusEvidence?.resolution === 'conflict' &&
    (statusEvidence.statuses.order === 'paid' || statusEvidence.statuses.paymentAttempt === 'paid')
  );
  if (hasPaidPaymentEvidence) {
    return {
      id: `genui_${idBase}_tracking`,
      lifecycleStage: "post_order",
      widgetKind: "orderTrackingStatus",
      status: "active",
      title: "Theo dõi đơn hàng",
      data: {
        order: state.order ?? null,
        paymentAttempt: state.paymentAttempt ?? null,
        fulfillment: state.fulfillment ?? null,
        ...(statusEvidence ? { paymentStatusEvidence: statusEvidence } : {}),
      },
      actions: [
        { id: "track_order", label: "Theo dõi đơn", intent: "primary" },
      ],
    };
  }

  if (
    state.order ||
    state.paymentAttempt ||
    turnToolNames.some(
      (name) => name === "checkPaymentStatus" || name === "getOrderStatus",
    )
  ) {
    return {
      id: `genui_${idBase}_payment`,
      lifecycleStage: "post_order",
      widgetKind: "paymentOrderStatus",
      status: "active",
      title: "Trạng thái đơn hàng",
      data: {
        order: state.order ?? null,
        paymentAttempt: state.paymentAttempt ?? null,
        ...(statusEvidence ? { paymentStatusEvidence: statusEvidence } : {}),
      },
      actions: [
        {
          id: "open_payment",
          label: paymentActionLabel(state.paymentAttempt?.method),
          intent: "primary",
          value: state.paymentAttempt?.method,
        },
        { id: "change_payment_method", label: "Đổi phương thức" },
      ],
    };
  }

  if (
    state.cart &&
    typeof state.entities === "object" &&
    state.entities !== null &&
    state.entities.preferCartSurface === true
  ) {
    return {
      id: `genui_${idBase}_cart`,
      lifecycleStage: "cart",
      widgetKind: "cartBuilder",
      status: "active",
      title: "Giỏ hàng của bạn",
      data: { cart: state.cart },
      actions: [
        {
          id: "continue_to_fulfillment",
          label: "Tiếp tục giao hàng",
          intent: "primary",
        },
        { id: "edit_cart", label: "Sửa giỏ hàng" },
        { id: "update_item_quantity", label: "Đổi số lượng" },
        { id: "remove_item", label: "Xóa món", intent: "destructive" },
      ],
    };
  }

  if (
    ((prefersFulfillmentSurface && !state.fulfillment) ||
      turnToolNames.includes("quoteFulfillment") ||
      turnToolNames.includes("findStores") ||
      turnToolNames.includes("checkStoreAvailability")) &&
    !(usesConfirmedSavedAddress && state.cart && state.fulfillment)
  ) {
    const canAcceptFulfillment = Boolean(state.address && state.fulfillment);
    return {
      id: `genui_${idBase}_fulfillment`,
      lifecycleStage: "fulfillment",
      widgetKind: "addressFulfillmentCheck",
      status: "active",
      title: "Kiểm tra giao hàng",
      data: {
        address: state.address ?? null,
        fulfillment: state.fulfillment ?? null,
      },
      actions: canAcceptFulfillment
        ? [
            {
              id: "accept_fulfillment",
              label: "Giao đến địa chỉ này",
              intent: "primary",
            },
            { id: "submit_address", label: "Đổi địa chỉ" },
          ]
        : [
            {
              id: "submit_address",
              label: "Nhập địa chỉ giao hàng",
              intent: "primary",
            },
          ],
    };
  }

  const hasMenuResults = (state.menuSearchResults?.length ?? 0) > 0;
  if (keepsMenuSurface && hasMenuResults && !isPromotionOnlyTurn) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: "menu",
      widgetKind: "smartMenuPicker",
      status: "active",
      title: "Gợi ý món phù hợp",
      data: {
        latestUserMessage: state.latestUserMessage,
        items: menuItemsWithContext(state),
        ...groupRequestContext(state),
      },
      actions: [
        { id: "add_item", label: "Thêm vào giỏ", intent: "primary" },
        { id: "customize_item", label: "Tùy chỉnh combo" },
      ],
    };
  }

  if (state.cart && state.fulfillment && !state.order) {
    return {
      id: `genui_${idBase}_review`,
      lifecycleStage: "checkout",
      widgetKind: "orderReviewConfirm",
      status: "active",
      title: "Kiểm tra đơn trước khi đặt",
      data: {
        cart: state.cart,
        fulfillment: state.fulfillment,
        promotionContext: state.promotionContext ?? null,
        invoiceRequest: state.invoiceRequest ?? null,
        invoiceRequested:
          typeof state.entities === "object" &&
          state.entities !== null &&
          "invoiceRequested" in state.entities &&
          state.entities.invoiceRequested === true,
      },
      actions: [
        {
          id: "confirm_order",
          label: `Đặt đơn ${moneyVnd(state.cart.totalVnd) || "ngay"}`,
          intent: "primary",
          value: "confirmed",
        },
        { id: "apply_voucher", label: "Áp mã giảm giá" },
      ],
    };
  }

  if (state.cart) {
    return {
      id: `genui_${idBase}_cart`,
      lifecycleStage: "cart",
      widgetKind: "cartBuilder",
      status: "active",
      title: "Giỏ hàng của bạn",
      data: { cart: state.cart },
      actions: [
        {
          id: "continue_to_fulfillment",
          label: "Tiếp tục giao hàng",
          intent: "primary",
        },
        { id: "edit_cart", label: "Sửa giỏ hàng" },
        { id: "update_item_quantity", label: "Đổi số lượng" },
        { id: "remove_item", label: "Xóa món", intent: "destructive" },
      ],
    };
  }

  if (
    hasMenuResults &&
    !isPromotionOnlyTurn &&
    (keepsMenuSurface ||
      input.reuseVerifiedMenuResults ||
      hasCurrentMenuEvidence)
  ) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: "menu",
      widgetKind: "smartMenuPicker",
      status: "active",
      title: "Gợi ý món phù hợp",
      data: {
        latestUserMessage: state.latestUserMessage,
        items: menuItemsWithContext(state),
        ...groupRequestContext(state),
      },
      actions: [
        { id: "add_item", label: "Thêm vào giỏ", intent: "primary" },
        { id: "customize_item", label: "Tùy chỉnh combo" },
      ],
    };
  }

  return undefined;
}
