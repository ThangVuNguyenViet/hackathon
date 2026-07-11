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
  it.each<[Channel, string, boolean, boolean]>([
    ['kfc', 'structured_companion', true, false],
    ['messenger', 'standalone_text', false, true],
    ['zalo', 'standalone_text', false, true],
    ['messenger_mock', 'standalone_text', false, true],
    ['zalo_mock', 'standalone_text', false, true],
  ])('returns capabilities for %s', (channel, presentationMode, supportsGenUi, requiresStandaloneText) => {
    expect(getChannelCapabilities(channel)).toEqual({
      presentationMode,
      supportsGenUi,
      supportsCatalogMedia: false,
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
      expected: ['2 x Gà Rán', '120.000đ', 'Tiếp tục'],
    },
    {
      kind: 'addressFulfillmentCheck' as const,
      data: {
        address: { line1: '12 Nguyễn Huệ', district: 'Quận 1', city: 'TP.HCM' },
        fulfillment: { storeName: 'KFC Nguyễn Huệ', feeVnd: 20_000, etaMinutes: 30 },
      },
      expected: ['12 Nguyễn Huệ', 'Quận 1', 'TP.HCM', 'KFC Nguyễn Huệ', '20.000đ', '30 phút', 'Tiếp tục'],
    },
    {
      kind: 'orderReviewConfirm' as const,
      data: {
        cart: { items: [{ quantity: 1, name: 'Combo Hợp Gu' }], totalVnd: 99_000 },
        invoiceRequest: { companyName: 'KFC Test', taxCode: '0123456789', email: 'test@example.com' },
      },
      expected: ['1 x Combo Hợp Gu', '99.000đ', 'hóa đơn', 'KFC Test', '0123456789', 'test@example.com', 'Tiếp tục'],
    },
    {
      kind: 'paymentOrderStatus' as const,
      data: {
        order: { id: 'ORDER-1', status: 'created', paymentStatus: 'pending' },
        paymentAttempt: { method: 'zalopay', status: 'pending', paymentUrl: 'https://pay.example/ORDER-1' },
      },
      expected: ['ORDER-1', 'created', 'pending', 'zalopay', 'https://pay.example/ORDER-1', 'Tiếp tục'],
    },
    {
      kind: 'orderTrackingStatus' as const,
      data: { order: { id: 'ORDER-2', status: 'delivering', paymentStatus: 'paid' } },
      expected: ['ORDER-2', 'delivering', 'paid', 'Tiếp tục'],
    },
    {
      kind: 'supportHandoff' as const,
      data: { handoff: { escalationId: 'ESC-1', reasons: ['payment_failed'] }, handoffStatus: 'queued' },
      expected: ['ESC-1', 'payment_failed', 'queued', 'Tiếp tục'],
    },
    {
      kind: 'paymentMethodPicker' as const,
      data: { methods: [{ displayName: 'Tiền mặt khi nhận hàng' }, { displayName: 'ZaloPay' }] },
      expected: ['Tiền mặt khi nhận hàng', 'ZaloPay', 'Tiếp tục'],
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
});
