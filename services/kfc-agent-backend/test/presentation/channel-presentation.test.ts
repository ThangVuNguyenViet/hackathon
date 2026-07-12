import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/domain/types.js';
import type { KfcGenUiAttachment, KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import {
  buildChannelPresentation,
  getChannelCapabilities,
  textOnlyPresentation,
} from '../../src/presentation/channelPresentation.js';

function attachment(
  widgetKind: KfcGenUiWidgetKind,
  data: Record<string, unknown>,
  summary = 'Tóm tắt đã xác minh',
): KfcGenUiAttachment {
  return {
    id: `attachment_${widgetKind}`,
    lifecycleStage: 'test',
    widgetKind,
    status: 'active',
    title: 'Tiêu đề',
    summary,
    data,
    actions: [{ id: 'next', label: 'Tiếp tục', intent: 'primary' }],
  };
}

describe('channel presentation capabilities', () => {
  it.each<[Channel, string, boolean, boolean, boolean]>([
    ['kfc', 'structured_companion', true, false, false],
    ['messenger', 'standalone_text', false, true, true],
    ['zalo', 'standalone_text', false, true, true],
    ['messenger_mock', 'standalone_text', false, true, false],
    ['zalo_mock', 'standalone_text', false, true, false],
  ])('returns capabilities for %s', (channel, presentationMode, supportsGenUi, requiresStandaloneText, supportsCatalogMedia) => {
    expect(getChannelCapabilities(channel)).toEqual({
      presentationMode,
      supportsGenUi,
      supportsCatalogMedia,
      requiresStandaloneText,
    });
  });

  it('keeps concise companion text and GenUI for KFC', () => {
    const genUi = attachment('smartMenuPicker', { items: [] });

    expect(buildChannelPresentation({ channel: 'kfc', graphResponseText: 'Mời bạn chọn món.', genUi })).toEqual({
      text: 'Mời bạn chọn món.',
      genUi,
    });
  });

  it('builds reusable text-only presentations', () => {
    expect(textOnlyPresentation('Nhân viên đã tiếp nhận.')).toEqual({ text: 'Nhân viên đã tiếp nhận.' });
  });
});

describe('standalone GenUI rendering', () => {
  it('adds trusted official menu images with collision-safe presentation keys', () => {
    const imageUrl = 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL';
    const presentation = buildChannelPresentation({
      channel: 'messenger',
      graphResponseText: 'Mời bạn chọn món.',
      genUi: attachment('smartMenuPicker', {
        items: [
          { code: '20751', name: 'Combo Hợp Gu', priceVnd: 99_000, imageUrl },
          { code: '20751', name: 'Combo Hợp Gu lần hai', priceVnd: 99_000, imageUrl },
        ],
      }),
    });

    expect(presentation.media).toEqual([
      { key: 'smartMenuPicker:20751:0', imageUrl, title: 'Combo Hợp Gu' },
      { key: 'smartMenuPicker:20751:1', imageUrl, title: 'Combo Hợp Gu lần hai' },
    ]);
  });

  it.each([
    ['productDetailCard', { item: { code: '41141', name: 'Burger Zinger', imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg' } }, 'Burger Zinger'],
    ['promotionGallery', { offers: [{ offerId: 'lunch', offerName: 'Bữa trưa 42K', imageUrl: 'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg' }] }, 'Bữa trưa 42K'],
  ] as const)('adds trusted official media for %s', (widgetKind, data, title) => {
    const presentation = buildChannelPresentation({
      channel: 'zalo', graphResponseText: 'Thông tin KFC.',
      genUi: attachment(widgetKind, data),
    });
    expect(presentation.media).toEqual([
      expect.objectContaining({ imageUrl: expect.stringMatching(/^https:\/\/static\.kfcvietnam\.com\.vn\//), title }),
    ]);
  });

  it.each([
    undefined,
    '',
    'http://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg',
    'https://example.test/HOPGU.jpg',
    'https://static.kfcvietnam.com.vn.evil.test/HOPGU.jpg',
  ])('omits missing or untrusted media URL %s without changing standalone text', (imageUrl) => {
    const presentation = buildChannelPresentation({
      channel: 'zalo',
      graphResponseText: 'Mời bạn chọn món.',
      genUi: attachment('smartMenuPicker', {
        items: [{ code: '20751', name: 'Combo Hợp Gu', priceVnd: 99_000, imageUrl }],
      }),
    });

    expect(presentation.text).toContain('Combo Hợp Gu');
    expect(presentation.media).toBeUndefined();
  });

  it.each([
    {
      kind: 'smartMenuPicker' as const,
      data: {
        items: Array.from({ length: 6 }, (_, index) => ({
          name: `Món ${index + 1}`,
          priceVnd: (index + 1) * 10_000,
        })),
      },
      expected: ['Món 1', '10.000đ', 'Món 5', '50.000đ', 'Bạn muốn chọn món nào?'],
      absent: 'Món 6',
    },
    {
      kind: 'cartBuilder' as const,
      data: { cart: { items: [{ quantity: 2, name: 'Gà Rán' }], totalVnd: 120_000 } },
      expected: ['2 x Gà Rán', '120.000đ', 'tiếp tục giao hàng', 'sửa món nào'],
    },
    {
      kind: 'addressFulfillmentCheck' as const,
      data: {
        address: { line1: '12 Nguyễn Huệ', district: 'Quận 1', city: 'TP.HCM' },
        fulfillment: { storeName: 'KFC Nguyễn Huệ', feeVnd: 20_000, etaMinutes: 30 },
      },
      expected: ['12 Nguyễn Huệ', 'Quận 1', 'TP.HCM', 'KFC Nguyễn Huệ', '20.000đ', '30 phút', 'dùng địa chỉ này'],
    },
    {
      kind: 'orderReviewConfirm' as const,
      data: {
        cart: { items: [{ quantity: 1, name: 'Combo Hợp Gu' }], totalVnd: 99_000 },
        invoiceRequest: { companyName: 'KFC Test', taxCode: '0123456789', email: 'test@example.com' },
      },
      expected: ['1 x Combo Hợp Gu', '99.000đ', 'hóa đơn', 'KFC Test', '0123456789', 'test@example.com', 'xác nhận đặt đơn'],
    },
    {
      kind: 'paymentOrderStatus' as const,
      data: {
        order: { id: 'ORDER-1', status: 'created', paymentStatus: 'pending' },
        paymentAttempt: { method: 'zalopay', status: 'pending', paymentUrl: 'https://pay.example/ORDER-1' },
      },
      expected: ['ORDER-1', 'Đã tiếp nhận đơn', 'Đang chờ thanh toán', 'Ví ZaloPay', 'https://pay.example/ORDER-1', 'tiếp tục thanh toán'],
    },
    {
      kind: 'orderTrackingStatus' as const,
      data: { order: { id: 'ORDER-2', status: 'delivering', paymentStatus: 'paid' } },
      expected: ['ORDER-2', 'Đang giao hàng', 'Đã thanh toán', 'cập nhật mới nhất'],
    },
    {
      kind: 'supportHandoff' as const,
      data: { handoff: { escalationId: 'ESC-1', reasons: ['payment_failed'] }, handoffStatus: 'queued' },
      expected: ['ESC-1', 'Thanh toán chưa thành công', 'Đang chuyển tới nhân viên hỗ trợ', 'gửi thêm mô tả'],
    },
    {
      kind: 'paymentMethodPicker' as const,
      data: { methods: [{ displayName: 'Tiền mặt khi nhận hàng' }, { displayName: 'ZaloPay' }] },
      expected: ['Tiền mặt khi nhận hàng', 'ZaloPay', 'chọn phương thức thanh toán'],
    },
  ])('renders verified $kind facts and actions', ({ kind, data, expected, absent }) => {
    const presentation = buildChannelPresentation({
      channel: 'messenger',
      graphResponseText: 'Nội dung chung chung.',
      genUi: attachment(kind, data),
    });

    for (const value of expected) expect(presentation.text).toContain(value);
    if (absent) expect(presentation.text).not.toContain(absent);
    expect(presentation.genUi).toBeUndefined();
  });

  it.each(['messenger', 'zalo'] as const)('does not leak raw GenUI cart actions into %s prose', (channel) => {
    const cart = attachment('cartBuilder', {
      cart: { items: [{ quantity: 1, name: 'Combo Đẫy Đà 129K' }], totalVnd: 129_000 },
    });
    cart.actions = [
      { id: 'continue_to_fulfillment', label: 'Tiếp tục giao hàng', intent: 'primary' },
      { id: 'edit_cart', label: 'Sửa giỏ hàng' },
      { id: 'update_item_quantity', label: 'Đổi số lượng' },
      { id: 'remove_item', label: 'Xóa món', intent: 'destructive' },
    ];

    const presentation = buildChannelPresentation({
      channel,
      graphResponseText: 'Mình đã cập nhật giỏ hàng.',
      genUi: cart,
    });

    expect(presentation.text).toContain('Bạn muốn tiếp tục giao hàng hay cần sửa món nào trong giỏ?');
    expect(presentation.text).not.toContain('Bước tiếp theo:');
    expect(presentation.text).not.toContain(' · ');
    expect(presentation.text).not.toContain('Đổi số lượng · Xóa món');
  });

  it('falls back from structured facts to verified summary, then graph text', () => {
    expect(
      buildChannelPresentation({
        channel: 'zalo',
        graphResponseText: 'Nội dung đồ thị.',
        genUi: attachment('paymentMethodPicker', {}, 'Tóm tắt phương thức đã xác minh.'),
      }).text,
    ).toContain('Tóm tắt phương thức đã xác minh.');

    expect(
      buildChannelPresentation({
        channel: 'zalo',
        graphResponseText: 'Nội dung đồ thị.',
        genUi: attachment('paymentMethodPicker', {}, ''),
      }).text,
    ).toContain('Nội dung đồ thị.');
  });

  it('asks for invoice details when the verified review data records an invoice request', () => {
    const presentation = buildChannelPresentation({
      channel: 'messenger_mock',
      graphResponseText: 'Nội dung chung chung.',
      genUi: attachment('orderReviewConfirm', {
        cart: { items: [{ quantity: 1, name: 'Combo Hợp Gu' }], totalVnd: 99_000 },
        invoiceRequested: true,
      }),
    });

    expect(presentation.text).toContain('Bạn vui lòng cung cấp thông tin hóa đơn.');
  });

  it('preserves verified payment-method support when rendering standalone choices', () => {
    const presentation = buildChannelPresentation({
      channel: 'messenger',
      graphResponseText: 'Nội dung chung chung.',
      genUi: attachment('paymentMethodPicker', {
        methods: [
          {
            methodId: 'zalopay_wallet',
            displayName: 'Ví ZaloPay',
            category: 'digital_wallet',
            supported: true,
            supportStatus: 'listed_supported',
            paymentSurface: 'kfc_website_checkout',
            evidenceText: 'Verified',
            sourceUrl: 'https://example.test/payment',
            sourceFile: 'payment.json',
            notes: '',
            provenance: {
              sourceFile: 'payment.json',
              sourceUrl: 'https://example.test/payment',
              fixtureMode: 'public_crawl_seed',
            },
          },
          {
            methodId: 'momo_wallet',
            displayName: 'Ví MoMo',
            category: 'digital_wallet',
            supported: false,
            supportStatus: 'not_listed_in_policy',
            paymentSurface: 'kfc_website_checkout',
            evidenceText: 'Not listed in verified policy',
            sourceUrl: 'https://example.test/payment',
            sourceFile: 'payment.json',
            notes: '',
            provenance: {
              sourceFile: 'payment.json',
              sourceUrl: 'https://example.test/payment',
              fixtureMode: 'public_crawl_seed',
            },
          },
        ],
      }),
    });

    expect(presentation.text).toContain('Có thể chọn:\n- Ví ZaloPay');
    expect(presentation.text).toContain('Không khả dụng:\n- Ví MoMo (Hiện chưa được KFC hỗ trợ)');
    expect(presentation.text).not.toContain('not_listed_in_policy');
    expect(presentation.text).not.toContain('Có thể chọn:\n- Ví ZaloPay\n- Ví MoMo');
  });

  it('exposes verified POS and commerce tracking progress in standalone text', () => {
    const presentation = buildChannelPresentation({
      channel: 'zalo',
      graphResponseText: 'Nội dung chung chung.',
      genUi: attachment('orderTrackingStatus', {
        order: {
          id: 'ORDER-3',
          status: 'created',
          paymentStatus: 'paid',
          posStatus: 'preparing',
          commerceOutcome: 'accepted',
          commerceCustomerStatus: 'in_progress',
        },
      }),
    });

    expect(presentation.text).toContain('Trạng thái đơn: Đã tiếp nhận đơn');
    expect(presentation.text).toContain('Tiến trình tại nhà hàng: Nhà hàng đang chuẩn bị món');
    expect(presentation.text).toContain('Kết quả xử lý đơn: Đơn đã được tiếp nhận');
    expect(presentation.text).toContain('Tiến trình đơn hàng: Đơn đang được xử lý');
    expect(presentation.text).not.toMatch(/created|preparing|accepted|in_progress|Trạng thái POS|Kết quả thương mại/);
  });

  it.each([
    { kind: 'paymentOrderStatus' as const, orderStatus: 'pending', attemptStatus: 'paid', expected: 'Đã thanh toán', absent: 'Đang chờ thanh toán' },
    { kind: 'orderTrackingStatus' as const, orderStatus: 'pending', attemptStatus: 'paid', expected: 'Đã thanh toán', absent: 'Đang chờ thanh toán' },
    { kind: 'paymentOrderStatus' as const, orderStatus: 'paid', attemptStatus: 'failed', expected: 'Thanh toán chưa thành công', absent: 'Đã thanh toán' },
    { kind: 'orderTrackingStatus' as const, orderStatus: 'paid', attemptStatus: 'failed', expected: 'Thanh toán chưa thành công', absent: 'Đã thanh toán' },
  ])(
    'prefers newer payment-attempt status for standalone $kind rendering ($orderStatus -> $attemptStatus)',
    ({ kind, orderStatus, attemptStatus, expected, absent }) => {
      const presentation = buildChannelPresentation({
        channel: 'messenger',
        graphResponseText: 'Nội dung chung chung.',
        genUi: attachment(kind, {
          order: { id: 'ORDER-4', status: 'created', paymentStatus: orderStatus },
          paymentAttempt: { method: 'zalopay', status: attemptStatus },
          paymentStatusEvidence: {
            resolution: 'current_tool',
            selectedStatus: attemptStatus,
            selectedSource: 'paymentAttempt',
            statuses: { order: orderStatus, paymentAttempt: attemptStatus },
          },
        }),
      });

      expect(presentation.text).toContain(`Trạng thái thanh toán: ${expected}`);
      expect(presentation.text).not.toContain(`Trạng thái thanh toán: ${absent}`);
      expect(presentation.text).not.toContain(attemptStatus);
    },
  );

  it.each(['paymentOrderStatus', 'orderTrackingStatus'] as const)(
    'renders both explicitly sourced statuses for unresolved standalone %s conflicts',
    (kind) => {
      const presentation = buildChannelPresentation({
        channel: 'zalo',
        graphResponseText: 'Nội dung chung chung.',
        genUi: attachment(kind, {
          order: { id: 'ORDER-5', status: 'created', paymentStatus: 'paid' },
          paymentAttempt: { method: 'zalopay', status: 'failed' },
          paymentStatusEvidence: {
            resolution: 'conflict',
            statuses: { order: 'paid', paymentAttempt: 'failed' },
          },
        }),
      });

      expect(presentation.text).toContain('Trạng thái thanh toán (đơn hàng): Đã thanh toán');
      expect(presentation.text).toContain('Trạng thái thanh toán (lần thanh toán): Thanh toán chưa thành công');
      expect(presentation.text).not.toMatch(/:\s*(paid|failed)(?:\n|$)/);
    },
  );

  it.each(['messenger', 'zalo'] as const)('never echoes unknown structured status codes into %s', (channel) => {
    const internalCodes = [
      'future_order_state',
      'future_payment_state',
      'future_payment_method',
      'future_pos_state',
      'future_commerce_outcome',
      'future_customer_state',
    ];
    const presentation = buildChannelPresentation({
      channel,
      graphResponseText: 'Mình đang kiểm tra đơn hàng.',
      genUi: attachment('orderTrackingStatus', {
        order: {
          id: 'ORDER-FUTURE',
          status: internalCodes[0],
          paymentStatus: internalCodes[1],
          posStatus: internalCodes[3],
          commerceOutcome: internalCodes[4],
          commerceCustomerStatus: internalCodes[5],
        },
        paymentAttempt: { method: internalCodes[2], status: internalCodes[1] },
      }),
    });

    for (const code of internalCodes) expect(presentation.text).not.toContain(code);
    expect(presentation.text).toContain('Đang cập nhật trạng thái đơn');
    expect(presentation.text).toContain('Đang cập nhật trạng thái thanh toán');
    expect(presentation.text).toContain('Đang kiểm tra với nhà hàng');
  });

  it.each(['messenger', 'zalo'] as const)('uses safe customer language for unknown support and payment-policy codes in %s', (channel) => {
    const support = buildChannelPresentation({
      channel,
      graphResponseText: 'Mình đang chuyển yêu cầu hỗ trợ.',
      genUi: attachment('supportHandoff', {
        handoff: { escalationId: 'ESC-FUTURE', reasons: ['future_support_reason'] },
        handoffStatus: 'future_handoff_status',
      }),
    });
    const paymentMethods = buildChannelPresentation({
      channel,
      graphResponseText: 'Mình đang kiểm tra phương thức thanh toán.',
      genUi: attachment('paymentMethodPicker', {
        methods: [{ displayName: 'Ví thử nghiệm', supported: false, supportStatus: 'future_policy_status' }],
      }),
    });

    expect(support.text).toContain('Cần nhân viên kiểm tra thêm');
    expect(support.text).toContain('Đang chuyển tới nhân viên hỗ trợ');
    expect(support.text).not.toMatch(/future_support_reason|future_handoff_status/);
    expect(paymentMethods.text).toContain('Đang kiểm tra khả năng hỗ trợ');
    expect(paymentMethods.text).not.toContain('future_policy_status');
  });
});
