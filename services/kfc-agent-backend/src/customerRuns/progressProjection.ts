import type { ToolCallRequest } from '../ordering/types.js';

// Closed vocabulary from
// docs/wayfinder/kfc-customer-chat-streaming/assets/
// customer-safe-progress-language-and-projection-rules.md.
// Never derive customer copy from raw tool names or arguments.
export const customerSafeProgressLabels = {
  reviewing_request: 'Đang xem yêu cầu của bạn…',
  preparing_response: 'Đang chuẩn bị câu trả lời…',
  checking_menu: 'Đang kiểm tra menu…',
  checking_promotions: 'Đang kiểm tra ưu đãi…',
  checking_food_information: 'Đang kiểm tra thông tin món…',
  checking_fulfillment: 'Đang kiểm tra địa chỉ và giao hàng…',
  checking_payment: 'Đang kiểm tra thanh toán…',
  checking_order_status: 'Đang kiểm tra trạng thái đơn…',
  updating_cart: 'Đang cập nhật giỏ hàng…',
  applying_promotion: 'Đang áp dụng ưu đãi…',
  updating_fulfillment: 'Đang cập nhật phương thức nhận món…',
  recording_invoice: 'Đang ghi nhận thông tin hóa đơn…',
  preparing_order: 'Đang chuẩn bị đơn hàng…',
  submitting_order: 'Đang gửi yêu cầu đặt đơn…',
  preparing_payment: 'Đang chuẩn bị thanh toán…',
  transferring_support: 'Đang chuyển yêu cầu hỗ trợ…',
} as const;

export type CustomerSafeProgressFamily = keyof typeof customerSafeProgressLabels;

export function projectToolProgressFamily(
  call: ToolCallRequest,
): CustomerSafeProgressFamily | undefined {
  switch (call.toolName) {
    case 'searchMenu':
    case 'getItemDetails':
    case 'getModifierOptions':
    case 'recommendAddOns':
      return 'checking_menu';
    case 'searchPromotions':
    case 'explainPromotion':
    case 'validateVoucher':
      return 'checking_promotions';
    case 'answerAllergenQuestion':
      return 'checking_food_information';
    case 'searchContentPolicy':
      return call.arguments.kind === 'allergen'
        ? 'checking_food_information'
        : undefined;
    case 'findStores':
    case 'checkStoreAvailability':
    case 'quoteFulfillment':
      return 'checking_fulfillment';
    case 'listPaymentMethods':
    case 'checkPaymentStatus':
      return 'checking_payment';
    case 'getOrderStatus':
      return 'checking_order_status';
    case 'updateCart':
      return 'updating_cart';
    case 'previewOrder':
      return 'preparing_order';
    case 'placeOrder':
      return 'submitting_order';
    case 'createPaymentLink':
      return 'preparing_payment';
    case 'collectInvoice':
      return 'recording_invoice';
    case 'handoff':
      return 'transferring_support';
    default:
      return undefined;
  }
}
