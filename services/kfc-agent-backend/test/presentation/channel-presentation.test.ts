import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/domain/types.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
  buildStandaloneSocialFallback,
  getChannelCapabilities,
  textOnlyPresentation,
} from '../../src/presentation/channelPresentation.js';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'messenger',
    latestUserMessage: 'Cho mình xem menu',
    intent: 'ordering',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

const genUi: KfcGenUiAttachment = {
  id: 'attachment_menu',
  lifecycleStage: 'discovery',
  widgetKind: 'smartMenuPicker',
  status: 'active',
  title: 'Chọn món',
  summary: 'Đã tìm thấy món',
  data: { items: [] },
  actions: [{ id: 'add_items', label: 'Xác nhận món', intent: 'primary' }],
};

describe('channel presentation profile isolation', () => {
  it.each<[Channel, string, boolean, boolean, boolean]>([
    ['kfc', 'structured_companion', true, false, false],
    ['messenger', 'standalone_text', false, true, true],
    ['zalo', 'standalone_text', false, true, true],
    ['messenger_mock', 'standalone_text', false, true, false],
    ['zalo_mock', 'standalone_text', false, true, false],
  ])('returns immutable capabilities for %s', (channel, presentationMode, supportsGenUi, requiresStandaloneText, supportsCatalogMedia) => {
    expect(getChannelCapabilities(channel)).toEqual({
      presentationMode,
      supportsGenUi,
      supportsCatalogMedia,
      requiresStandaloneText,
    });
  });

  it('builds a discriminated GenUI companion plan for first-party KFC', () => {
    expect(buildChannelPresentation({ channel: 'kfc', graphResponseText: 'Mời bạn chọn món.', genUi })).toEqual({
      profile: 'genui',
      text: 'Mời bạn chọn món.',
      genUi,
    });
  });

  it.each(['messenger', 'zalo', 'messenger_mock', 'zalo_mock'] as const)(
    'rejects GenUI input at the %s presenter boundary',
    (channel) => {
      expect(() => buildChannelPresentation({ channel, graphResponseText: 'Text', genUi }))
        .toThrow('Social presentation cannot consume a GenUI attachment');
    },
  );

  it('derives trusted native media directly from verified commerce state', () => {
    const imageUrl = 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg';
    const presentation = buildSocialPresentation({
      channel: 'messenger',
      standaloneText: 'Combo Hợp Gu 99K có giá 99.000đ.',
      state: state({
        menuSearchResults: [{
          code: '20751',
          name: 'Combo Hợp Gu 99K',
          category: 'Ưu Đãi',
          description: 'Combo',
          priceVnd: 99_000,
          originalPriceVnd: null,
          imageUrl,
          available: true,
        }],
      }),
    });

    expect(presentation).toEqual({
      profile: 'social',
      text: 'Combo Hợp Gu 99K có giá 99.000đ.',
      media: [{ key: 'social:20751:0', imageUrl, title: 'Combo Hợp Gu 99K' }],
    });
    expect(presentation.genUi).toBeUndefined();
  });

  it('does not deliver untrusted catalog media', () => {
    const presentation = buildSocialPresentation({
      channel: 'zalo',
      standaloneText: 'Combo Hợp Gu 99K có giá 99.000đ.',
      state: state({
        menuSearchResults: [{
          code: '20751', name: 'Combo Hợp Gu 99K', category: 'Ưu Đãi', description: 'Combo',
          priceVnd: 99_000, originalPriceVnd: null, imageUrl: 'https://example.test/item.jpg', available: true,
        }],
      }),
    });
    expect(presentation.media).toBeUndefined();
  });

  it('renders a complete deterministic social cart fallback from verified state', () => {
    const text = buildStandaloneSocialFallback(state({
      cart: {
        id: 'cart_1',
        items: [{ itemCode: '20751', name: 'Combo Hợp Gu 99K', quantity: 1, unitPriceVnd: 99_000 }],
        subtotalVnd: 99_000,
        discountVnd: 0,
        voucherCode: null,
        deliveryFeeVnd: 0,
        totalVnd: 99_000,
      },
      toolTrace: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 }, ok: true, resultSummary: 'updated', provenance: [] }],
    }), 'Đã cập nhật giỏ.');

    expect(text).toContain('Combo Hợp Gu 99K');
    expect(text).toContain('99.000đ');
    expect(text).toContain('địa chỉ giao hàng');
  });

  it('presents a selected saved address ahead of a stale partial address prompt', () => {
    const text = buildStandaloneSocialFallback(state({
      addressDraft: { district: 'Nhà Bè' },
      entities: {
        savedAddressDecision: { addressIndex: 0, decision: 'suggest' },
        preferFulfillmentSurface: true,
        asksClarification: true,
      },
      customerContext: {
        savedAddresses: [{ label: 'Nhà', line1: '123 Nguyễn Trãi', district: 'Quận 5', city: 'Hồ Chí Minh' }],
        recentOrders: [], favorites: [],
      },
    }), 'fallback');

    expect(text).toContain('123 Nguyễn Trãi, Quận 5, Hồ Chí Minh');
    expect(text).toContain('xác nhận');
  });

  it('presents a current inventory regression ahead of stale fulfillment state', () => {
    const text = buildStandaloneSocialFallback(state({
      address: { label: 'Nhà', line1: '123 Nguyễn Trãi', district: 'Quận 5', city: 'Hồ Chí Minh' },
      cart: {
        id: 'cart_1',
        items: [{ itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 55_000 }],
        subtotalVnd: 55_000, discountVnd: 0, voucherCode: null, deliveryFeeVnd: 0, totalVnd: 55_000,
      },
      escalationReasons: ['item_unavailable_before_confirmation'],
      entities: { unavailableItemCodes: ['41141'], asksClarification: true },
      toolTrace: [{
        toolName: 'checkStoreAvailability', arguments: { storeId: 'store_1', itemCodes: ['41141'] },
        ok: true, resultSummary: 'checked', provenance: [],
      }],
    }), 'fallback');

    expect(text).toContain('Burger Gà Zinger');
    expect(text).toContain('hết tại cửa hàng');
    expect(text).not.toContain('Bạn muốn dùng địa chỉ này');
  });

  it('creates profile-aware text-only plans', () => {
    expect(textOnlyPresentation('Nhân viên đã tiếp nhận.', 'messenger')).toEqual({
      profile: 'social', text: 'Nhân viên đã tiếp nhận.',
    });
    expect(textOnlyPresentation('Nhân viên đã tiếp nhận.', 'kfc')).toEqual({
      profile: 'genui', text: 'Nhân viên đã tiếp nhận.',
    });
  });

  it('blocks a presentation whose profile does not match the trusted channel', () => {
    expect(() => assertPresentationMatchesChannel('messenger', { profile: 'genui', text: 'wrong' }))
      .toThrow('Presentation profile mismatch');
  });
});
