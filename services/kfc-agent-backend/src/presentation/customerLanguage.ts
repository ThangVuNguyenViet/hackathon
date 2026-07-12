type CustomerLanguageMap = Readonly<Record<string, string>>;

const orderStatuses: CustomerLanguageMap = {
  previewed: 'Đang chờ xác nhận',
  created: 'Đã tiếp nhận đơn',
  preparing: 'Đang chuẩn bị món',
  delivering: 'Đang giao hàng',
  completed: 'Đã giao hàng',
  cancelled: 'Đã hủy',
  cancellation_failed: 'Chưa thể hủy đơn',
};

const paymentStatuses: CustomerLanguageMap = {
  not_started: 'Chưa bắt đầu thanh toán',
  pending: 'Đang chờ thanh toán',
  paid: 'Đã thanh toán',
  failed: 'Thanh toán chưa thành công',
};

const paymentMethods: CustomerLanguageMap = {
  momo: 'Ví MoMo',
  momo_wallet: 'Ví MoMo',
  zalopay: 'Ví ZaloPay',
  zalopay_wallet: 'Ví ZaloPay',
  card: 'Thẻ ngân hàng',
  bank_atm: 'Thẻ ATM/ngân hàng',
  cod: 'Thanh toán khi nhận hàng',
  cash_on_delivery: 'Thanh toán khi nhận hàng',
};

const restaurantStatuses: CustomerLanguageMap = {
  accepted: 'Nhà hàng đã nhận đơn',
  preparing: 'Nhà hàng đang chuẩn bị món',
  ready: 'Món đã sẵn sàng',
  cancelled: 'Nhà hàng đã hủy đơn',
  rejected: 'Nhà hàng chưa thể nhận đơn',
  cancellation_failed: 'Nhà hàng chưa thể hủy đơn',
  unknown: 'Đang kiểm tra với nhà hàng',
};

const commerceOutcomes: CustomerLanguageMap = {
  accepted: 'Đơn đã được tiếp nhận',
  deduplicated: 'Đơn đã được ghi nhận',
  pos_rejected: 'Nhà hàng chưa thể nhận đơn',
  ambiguous_pos_submission: 'Đang xác minh với nhà hàng',
  cancelled: 'Đơn đã được hủy',
  partial_cancellation: 'Đang kiểm tra trạng thái hủy đơn',
  status_conflict: 'Đang đối chiếu trạng thái đơn',
  failed: 'Xử lý đơn chưa thành công',
};

const customerProgressStatuses: CustomerLanguageMap = {
  awaiting_confirmation: 'Đang chờ bạn xác nhận',
  submitting: 'Đang gửi đơn tới nhà hàng',
  accepted: 'Đơn đã được tiếp nhận',
  preparing: 'Đang chuẩn bị món',
  ready: 'Món đã sẵn sàng',
  in_progress: 'Đơn đang được xử lý',
  cancelled: 'Đơn đã được hủy',
  failed: 'Xử lý đơn chưa thành công',
};

const supportReasons: CustomerLanguageMap = {
  angry_customer: 'Bạn đang không hài lòng về đơn hàng',
  human_requested: 'Bạn yêu cầu gặp nhân viên',
  complaint: 'Bạn cần hỗ trợ về phản ánh đơn hàng',
  payment_failed: 'Thanh toán chưa thành công',
  tool_execution_failed: 'Hệ thống cần nhân viên kiểm tra thêm',
  cart_initialization_failed: 'Chưa thể tạo giỏ hàng',
  abnormal_large_order: 'Đơn hàng có số lượng lớn',
  human_review_required: 'Đơn hàng cần nhân viên xác nhận',
  order_cancellation_requested: 'Bạn yêu cầu hủy đơn',
  explicit_cart_mutation_required: 'Cần xác nhận thay đổi giỏ hàng',
  valid_fulfillment_required: 'Cần kiểm tra lại thông tin giao hàng',
  order_confirmation_required: 'Cần xác nhận đơn hàng',
  cart_mutation_confirmation_required: 'Cần xác nhận thay đổi giỏ hàng',
  promotion_evidence_required: 'Cần kiểm tra lại thông tin ưu đãi',
  payment_tool_success_required: 'Cần kiểm tra lại trạng thái thanh toán',
  allergen_certainty_not_allowed: 'Cần nhân viên kiểm tra thêm thông tin dị ứng',
  needs_verified_info: 'Cần nhân viên kiểm tra thêm thông tin',
};

const handoffStatuses: CustomerLanguageMap = {
  requested: 'Đang yêu cầu nhân viên hỗ trợ',
  queued: 'Đang chuyển tới nhân viên hỗ trợ',
  joined: 'Nhân viên đã tham gia hỗ trợ',
};

const paymentSupportStatuses: CustomerLanguageMap = {
  listed_supported: 'Được KFC hỗ trợ',
  not_listed_in_policy: 'Hiện chưa được KFC hỗ trợ',
  separate_channel_only: 'Chỉ hỗ trợ qua kênh thanh toán riêng',
};

function customerValue(value: unknown, values: CustomerLanguageMap, fallback: string): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return values[value.trim().toLowerCase()] ?? fallback;
}

export const customerOrderStatus = (value: unknown) =>
  customerValue(value, orderStatuses, 'Đang cập nhật trạng thái đơn');

export const customerPaymentStatus = (value: unknown) =>
  customerValue(value, paymentStatuses, 'Đang cập nhật trạng thái thanh toán');

export const customerPaymentMethod = (value: unknown) =>
  customerValue(value, paymentMethods, 'Phương thức thanh toán đã chọn');

export const customerRestaurantStatus = (value: unknown) =>
  customerValue(value, restaurantStatuses, 'Đang kiểm tra với nhà hàng');

export const customerCommerceOutcome = (value: unknown) =>
  customerValue(value, commerceOutcomes, 'Đang kiểm tra trạng thái xử lý đơn');

export const customerProgressStatus = (value: unknown) =>
  customerValue(value, customerProgressStatuses, 'Đơn đang được xử lý');

export const customerSupportReason = (value: unknown) =>
  customerValue(value, supportReasons, 'Cần nhân viên kiểm tra thêm');

export const customerHandoffStatus = (value: unknown) =>
  customerValue(value, handoffStatuses, 'Đang chuyển tới nhân viên hỗ trợ');

export const customerPaymentSupportStatus = (value: unknown) =>
  customerValue(value, paymentSupportStatuses, 'Đang kiểm tra khả năng hỗ trợ');
