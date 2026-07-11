export const smallTalkRouterEvalCases = [
  { id: 'social-greeting', text: 'Xin chào KFC', expected: 'handle_social' },
  { id: 'social-thanks', text: 'Cảm ơn bạn nhiều', expected: 'handle_social' },
  { id: 'social-goodbye', text: 'Tạm biệt nhé', expected: 'handle_social' },
  { id: 'mixed-greeting-menu', text: 'Xin chào, hôm nay có món gì?', expected: 'continue_to_planner' },
  { id: 'mixed-thanks-cart', text: 'Cảm ơn, thêm khoai tây vào giỏ giúp mình', expected: 'continue_to_planner' },
  { id: 'ambiguous-ack', text: 'Ừ, cảm ơn', expected: 'continue_to_planner' },
  { id: 'menu', text: 'Cho mình xem menu', expected: 'continue_to_planner' },
  { id: 'ordering', text: 'Thêm một phần gà vào giỏ', expected: 'continue_to_planner' },
  { id: 'payment', text: 'Mình thanh toán rồi mà báo lỗi', expected: 'continue_to_planner' },
  { id: 'complaint', text: 'Đơn giao thiếu món', expected: 'continue_to_planner' },
  { id: 'safety', text: 'Món này có chất gây dị ứng không?', expected: 'continue_to_planner' },
  { id: 'handoff', text: 'Cho mình gặp nhân viên', expected: 'continue_to_planner' },
] as const;
