import type { AgentGraphState } from '../graph/state.js';
import type { ToolName } from '../ordering/types.js';
import type { KfcGenUiAttachment } from './kfcGenUi.js';

export interface SelectKfcGenUiInput {
  state: AgentGraphState;
  turnToolNames: ToolName[];
}

const humanSupportReasons = new Set([
  'abnormal_large_order',
  'customer_requested_human',
  'human_review_required',
  'payment_failed',
  'complaint',
  'angry_customer',
]);

export function selectKfcGenUiAttachment(input: SelectKfcGenUiInput): KfcGenUiAttachment | undefined {
  const { state, turnToolNames } = input;
  const idBase = `${state.sessionId}_${Date.now()}`;

  const supportReasons = state.escalationReasons.filter((reason) => humanSupportReasons.has(reason));
  if (state.handoff || supportReasons.length > 0) {
    return {
      id: `genui_${idBase}_support`,
      lifecycleStage: 'support',
      widgetKind: 'supportHandoff',
      status: 'active',
      title: 'Cần nhân viên hỗ trợ',
      summary: state.handoff?.reasons.join(', ') || supportReasons.join(', '),
      data: { handoff: state.handoff ?? null, reasons: supportReasons },
      actions: [{ id: 'request_human', label: 'Gặp nhân viên' }],
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
        { id: 'track_order', label: 'Kiểm tra đơn' },
        { id: 'retry_payment', label: 'Gửi lại thanh toán' },
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
        { id: 'apply_voucher', label: 'Áp dụng voucher' },
        { id: 'select_payment_method', label: 'Chọn thanh toán' },
        { id: 'confirm_order', label: 'Xác nhận đơn', value: 'confirmed' },
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
        { id: 'submit_address', label: 'Nhập địa chỉ' },
        { id: 'accept_eta', label: 'Đồng ý thời gian giao' },
      ],
    };
  }

  if (state.cart && turnToolNames.some((name) => name === 'updateCart' || name === 'previewCart')) {
    return {
      id: `genui_${idBase}_cart`,
      lifecycleStage: 'cart',
      widgetKind: 'cartBuilder',
      status: 'active',
      title: 'Giỏ hàng của bạn',
      data: { cart: state.cart },
      actions: [
        { id: 'update_quantity', label: 'Cập nhật số lượng' },
        { id: 'remove_item', label: 'Bỏ món' },
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
      data: { latestUserMessage: state.latestUserMessage },
      actions: [
        { id: 'add_item', label: 'Thêm món' },
        { id: 'view_details', label: 'Xem chi tiết' },
      ],
    };
  }

  return undefined;
}
