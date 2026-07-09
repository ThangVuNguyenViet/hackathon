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

export interface KfcGenUiActionSpec {
  id: string;
  label: string;
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
    case 'confirm_order':
      return `Tôi xác nhận đơn${valueText}`.trim();
    case 'add_item':
      return `Thêm món${valueText}`.trim();
    case 'remove_item':
      return `Bỏ món${valueText}`.trim();
    case 'update_quantity':
      return `Cập nhật số lượng${valueText}`.trim();
    case 'apply_voucher':
      return `Áp dụng voucher${valueText}`.trim();
    case 'retry_payment':
      return 'Gửi lại link thanh toán';
    case 'switch_payment_method':
      return `Đổi phương thức thanh toán${valueText}`.trim();
    case 'track_order':
      return 'Kiểm tra trạng thái đơn hàng';
    case 'request_human':
      return 'Cho tôi gặp nhân viên';
    case 'submit_complaint':
      return `Tôi muốn khiếu nại${valueText}`.trim();
    default:
      return [action.actionId, action.value].filter(Boolean).join(' ');
  }
}
