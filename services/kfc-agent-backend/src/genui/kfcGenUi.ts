export const KFC_GENUI_WIDGET_KINDS = [
  'smartMenuPicker',
  'cartBuilder',
  'addressFulfillmentCheck',
  'orderReviewConfirm',
  'paymentOrderStatus',
  'supportHandoff',
] as const;

export type KfcGenUiWidgetKind = (typeof KFC_GENUI_WIDGET_KINDS)[number];

export type KfcGenUiStatus = 'active' | 'answered' | 'expired' | 'blocked';

export type KfcGenUiActionIntent = 'primary' | 'secondary' | 'destructive' | 'recovery';

export interface KfcGenUiActionSpec {
  id: string;
  label: string;
  intent?: KfcGenUiActionIntent;
  value?: string;
  payload?: Record<string, unknown>;
  destructive?: boolean;
}

export interface KfcGenUiAttachment {
  id: string;
  lifecycleStage: string;
  widgetKind: KfcGenUiWidgetKind;
  status: KfcGenUiStatus;
  title: string;
  summary?: string;
  data: Record<string, unknown>;
  actions: KfcGenUiActionSpec[];
  selectedAction?: string;
  expiresAt?: string;
}

export interface KfcGenUiAction {
  attachmentId: string;
  actionId: string;
  value?: string;
  payload?: Record<string, unknown>;
}

export function isKfcGenUiWidgetKind(value: unknown): value is KfcGenUiWidgetKind {
  return typeof value === 'string' && KFC_GENUI_WIDGET_KINDS.includes(value as KfcGenUiWidgetKind);
}

export function isKfcGenUiAttachment(value: unknown): value is KfcGenUiAttachment {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.lifecycleStage === 'string' &&
    isKfcGenUiWidgetKind(record.widgetKind) &&
    typeof record.status === 'string' &&
    typeof record.title === 'string' &&
    typeof record.data === 'object' &&
    record.data !== null &&
    Array.isArray(record.actions)
  );
}

export function normalizeGenUiActionToText(action: KfcGenUiAction): string {
  const valueText = action.value ? ` ${action.value}` : '';
  switch (action.actionId) {
    case 'add_item':
      return `Thêm${valueText} vào giỏ`.trim();
    case 'customize_item':
      return `Tùy chỉnh${valueText || ' combo'}`.trim();
    case 'continue_to_fulfillment':
      return 'Tiếp tục giao hàng';
    case 'edit_cart':
      return 'Sửa giỏ hàng';
    case 'remove_item':
      return `Xóa${valueText || ' món này'}`.trim();
    case 'accept_fulfillment':
      return 'Giao đến địa chỉ này';
    case 'submit_address':
      return 'Tôi muốn đổi địa chỉ';
    case 'confirm_order':
      return 'Tôi đặt đơn này';
    case 'apply_voucher':
      return `Áp mã giảm giá${valueText}`.trim();
    case 'open_payment':
      return `Thanh toán bằng${valueText || ' MoMo'}`.trim();
    case 'change_payment_method':
      return `Đổi phương thức thanh toán${valueText}`.trim();
    case 'track_order':
      return 'Kiểm tra trạng thái đơn hàng';
    case 'request_human':
      return 'Cho tôi gặp nhân viên ngay';
    case 'send_issue_summary':
      return 'Gửi tóm tắt lỗi cho nhân viên';
    default:
      return [action.actionId, action.value].filter(Boolean).join(' ');
  }
}
