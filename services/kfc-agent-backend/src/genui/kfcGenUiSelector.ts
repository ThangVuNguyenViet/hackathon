import type { AgentGraphState } from '../graph/state.js';
import type { ToolName } from '../ordering/types.js';
import type { KfcGenUiAttachment } from './kfcGenUi.js';

export interface SelectKfcGenUiInput {
  state: AgentGraphState;
  turnToolNames: ToolName[];
}

function moneyVnd(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

export function selectKfcGenUiAttachment(input: SelectKfcGenUiInput): KfcGenUiAttachment | undefined {
  const { state, turnToolNames } = input;
  const idBase = `${state.sessionId}_${Date.now()}`;

  const supportReasons = (state.handoff?.reasons ?? state.escalationReasons).filter(
    (reason) => reason !== 'menu_item_verification_required' && reason !== 'handoff_not_justified',
  );
  if (state.handoff || (supportReasons.length > 0 && !state.cart)) {
    return {
      id: `genui_${idBase}_support`,
      lifecycleStage: 'support',
      widgetKind: 'supportHandoff',
      status: 'active',
      title: 'Cần nhân viên hỗ trợ',
      summary: state.handoff?.reasons.join(', ') || supportReasons.join(', '),
      data: { handoff: state.handoff ?? null, reasons: supportReasons },
      actions: [
        { id: 'request_human', label: 'Gặp nhân viên ngay', intent: 'primary' },
        { id: 'send_issue_summary', label: 'Gửi tóm tắt lỗi' },
      ],
    };
  }

  if (state.order?.paymentStatus === 'paid' || state.paymentAttempt?.status === 'paid') {
    return {
      id: `genui_${idBase}_tracking`,
      lifecycleStage: 'post_order',
      widgetKind: 'orderTrackingStatus',
      status: 'active',
      title: 'Theo dõi đơn hàng',
      data: { order: state.order ?? null, paymentAttempt: state.paymentAttempt ?? null, fulfillment: state.fulfillment ?? null },
      actions: [{ id: 'track_order', label: 'Theo dõi đơn', intent: 'primary' }],
    };
  }

  if (state.order || state.paymentAttempt || turnToolNames.some((name) => name === 'checkPaymentStatus' || name === 'getOrderStatus')) {
    return {
      id: `genui_${idBase}_payment`,
      lifecycleStage: 'post_order',
      widgetKind: 'paymentOrderStatus',
      status: 'active',
      title: 'Trạng thái đơn hàng',
      data: { order: state.order ?? null, paymentAttempt: state.paymentAttempt ?? null },
      actions: [
        { id: 'open_payment', label: 'Thanh toán MoMo', intent: 'primary', value: 'MoMo' },
        { id: 'change_payment_method', label: 'Đổi phương thức' },
      ],
    };
  }

  if (turnToolNames.includes('quoteFulfillment') || turnToolNames.includes('findStores') || turnToolNames.includes('checkStoreAvailability')) {
    return {
      id: `genui_${idBase}_fulfillment`,
      lifecycleStage: 'fulfillment',
      widgetKind: 'addressFulfillmentCheck',
      status: 'active',
      title: 'Kiểm tra giao hàng',
      data: { address: state.address ?? null, fulfillment: state.fulfillment ?? null },
      actions: [
        { id: 'accept_fulfillment', label: 'Giao đến địa chỉ này', intent: 'primary' },
        { id: 'submit_address', label: 'Đổi địa chỉ' },
      ],
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
        fulfillment: state.fulfillment,
        promotionContext: state.promotionContext ?? null,
        invoiceRequest: state.invoiceRequest ?? null,
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
        { id: 'continue_to_fulfillment', label: 'Tiếp tục giao hàng', intent: 'primary' },
        { id: 'edit_cart', label: 'Sửa giỏ hàng' },
        { id: 'remove_item', label: 'Xóa món', intent: 'destructive' },
      ],
    };
  }

  if (turnToolNames.some((name) => name === 'searchMenu' || name === 'recommendAddOns' || name === 'getItemDetails')) {
    return {
      id: `genui_${idBase}_menu`,
      lifecycleStage: 'menu',
      widgetKind: 'smartMenuPicker',
      status: 'active',
      title: 'Gợi ý món phù hợp',
      data: { latestUserMessage: state.latestUserMessage, items: state.menuSearchResults ?? [] },
      actions: [
        { id: 'add_item', label: 'Thêm vào giỏ', intent: 'primary' },
        { id: 'customize_item', label: 'Tùy chỉnh combo' },
      ],
    };
  }

  return undefined;
}
