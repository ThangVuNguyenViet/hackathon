import { describe, expect, it } from 'vitest';
import type { Channel } from '../../src/domain/types.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
  getChannelCapabilities,
  MESSENGER_TEXT_MAX_CHARACTERS,
  projectChannelTextForDelivery,
  textOnlyPresentation,
} from '../../src/presentation/channelPresentation.js';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'messenger',
    latestUserMessage: 'Cho mình xem menu',
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
    ['messenger_mock', 'standalone_text', false, true, true],
    ['zalo_mock', 'standalone_text', false, true, true],
  ])(
    'returns immutable capabilities for %s',
    (
      channel,
      presentationMode,
      supportsGenUi,
      requiresStandaloneText,
      supportsCatalogMedia,
    ) => {
      expect(getChannelCapabilities(channel)).toEqual({
        presentationMode,
        supportsGenUi,
        supportsCatalogMedia,
        requiresStandaloneText,
      });
    },
  );

  it('builds a discriminated GenUI companion plan for first-party KFC', () => {
    expect(
      buildChannelPresentation({
        channel: 'kfc',
        graphResponseText: 'Mời bạn chọn món.',
        genUi,
      }),
    ).toEqual({
      profile: 'genui',
      text: 'Mời bạn chọn món.',
      genUi,
    });
  });

  it('honors an explicit response profile independently of channel defaults', () => {
    expect(
      buildChannelPresentation({
        channel: 'kfc',
        responseProfile: 'social',
        graphResponseText: '',
      }),
    ).toEqual({
      profile: 'social',
      text: '',
    });
  });

  it('allows the controlled Messenger fixture to exercise GenUI projection', () => {
    expect(
      buildChannelPresentation({
        channel: 'messenger_mock',
        responseProfile: 'genui',
        graphResponseText: 'Choose from the verified surface.',
        genUi,
      }),
    ).toEqual({
      profile: 'genui',
      text: 'Choose from the verified surface.',
      genUi,
    });
  });

  it.each(['messenger', 'zalo', 'zalo_mock'] as const)(
    'rejects a GenUI override for social channel %s',
    (channel) => {
      expect(() =>
        buildChannelPresentation({
          channel,
          responseProfile: 'genui',
          graphResponseText: 'Choose from the verified surface.',
          genUi,
        }),
      ).toThrow(`response_profile_channel_mismatch:${channel}:genui`);
    },
  );

  it.each(['messenger', 'zalo', 'messenger_mock', 'zalo_mock'] as const)(
    'rejects GenUI input at the %s presenter boundary',
    (channel) => {
      expect(() =>
        buildChannelPresentation({ channel, graphResponseText: 'Text', genUi }),
      ).toThrow('Social presentation cannot consume a GenUI attachment');
    },
  );

  it('projects trusted catalog media alongside standalone social text', () => {
    const presentation = buildSocialPresentation({
      channel: 'messenger',
      standaloneText: 'Combo Hợp Gu 99K có giá 99.000đ.',
      state: state({
        menuSearchResults: [
          {
            code: '20751',
            name: 'Combo Hợp Gu 99K',
            category: 'Ưu Đãi',
            categoryId: '20000',
            description: 'Combo',
            priceVnd: 99_000,
            originalPriceVnd: null,
            imageUrl:
              'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg',
            available: true,
          },
        ],
      }),
    });

    expect(presentation).toEqual({
      profile: 'social',
      text: 'Combo Hợp Gu 99K có giá 99.000đ.',
      media: [
        {
          key: 'social:20751:0',
          imageUrl:
            'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg',
          title: 'Combo Hợp Gu 99K',
        },
      ],
    });
    expect(presentation.genUi).toBeUndefined();
  });

  it('does not deliver untrusted catalog media', () => {
    const presentation = buildSocialPresentation({
      channel: 'zalo',
      standaloneText: 'Combo Hợp Gu 99K có giá 99.000đ.',
      state: state({
        menuSearchResults: [
          {
            code: '20751',
            name: 'Combo Hợp Gu 99K',
            category: 'Ưu Đãi',
            categoryId: '20000',
            description: 'Combo',
            priceVnd: 99_000,
            originalPriceVnd: null,
            imageUrl: 'https://example.test/item.jpg',
            available: true,
          },
        ],
      }),
    });
    expect(presentation.media).toBeUndefined();
  });

  it('creates profile-aware text-only plans', () => {
    expect(
      textOnlyPresentation('Nhân viên đã tiếp nhận.', 'messenger'),
    ).toEqual({
      profile: 'social',
      text: 'Nhân viên đã tiếp nhận.',
    });
    expect(textOnlyPresentation('Nhân viên đã tiếp nhận.', 'kfc')).toEqual({
      profile: 'genui',
      text: 'Nhân viên đã tiếp nhận.',
    });
  });

  it('projects oversized Messenger text within the provider limit', () => {
    const recommendation = 'Mình gợi ý Cơm Gà Giòn, vị không cay và dễ ăn.';
    const response =
      `${recommendation}\n\n${'Menu đầy đủ. '.repeat(500)}`.slice(0, 5_298);
    const projected = projectChannelTextForDelivery('messenger', response);
    const presentation = buildSocialPresentation({
      channel: 'messenger',
      standaloneText: response,
      state: state(),
    });

    expect(response).toHaveLength(5_298);
    expect(projected.length).toBeLessThanOrEqual(MESSENGER_TEXT_MAX_CHARACTERS);
    expect(projected).toMatch(/^Mình gợi ý Cơm Gà Giòn/);
    expect(projected).toMatch(/…$/);
    expect(presentation.text).toBe(projected);
  });

  it('preserves text already within the Messenger limit and leaves other channels unchanged', () => {
    const exactLimit = 'a'.repeat(MESSENGER_TEXT_MAX_CHARACTERS);
    expect(projectChannelTextForDelivery('messenger', exactLimit)).toBe(
      exactLimit,
    );
    expect(projectChannelTextForDelivery('zalo', `${exactLimit}more`)).toBe(
      `${exactLimit}more`,
    );
  });

  it('does not split a grapheme when bounding Messenger text', () => {
    const prefix = 'a'.repeat(MESSENGER_TEXT_MAX_CHARACTERS - 2);
    expect(projectChannelTextForDelivery('messenger', `${prefix}👨‍👩‍👧‍👦tail`)).toBe(
      `${prefix}…`,
    );
  });

  it('blocks a presentation whose profile does not match the trusted channel', () => {
    expect(() =>
      assertPresentationMatchesChannel('messenger', {
        profile: 'genui',
        text: 'wrong',
      }),
    ).toThrow('Presentation profile mismatch');
  });
});
