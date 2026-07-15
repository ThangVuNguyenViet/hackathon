import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import { evaluateMessengerProjectionParity } from '../../src/evaluation/messengerProjectionParity.js';
import type { VerifiedCommerceProjection } from '../../src/commerce/verifiedCommerceProjection.js';

const imageUrl = 'https://static.kfcvietnam.com.vn/images/20702.png';
const projection: VerifiedCommerceProjection<unknown> = {
  environment: 'sandbox',
  providerFingerprint: 'provider-1',
  subjectId: 'customer-1',
  journeyId: 'journey-1',
  catalogObservationId: 'catalog-1',
  verifiedAt: '2026-07-15T00:00:00.000Z',
  expiresAt: '2026-07-15T01:00:00.000Z',
  facts: {
    menu: {
      key: 'menu',
      environment: 'sandbox',
      providerFingerprint: 'provider-1',
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      revision: 'menu-1',
      verifiedAt: '2026-07-15T00:00:00.000Z',
      expiresAt: '2026-07-15T01:00:00.000Z',
      dependencies: [],
      value: { code: '20702', name: 'Combo Nhóm 2', priceVnd: 129000, imageUrl },
    },
  },
};

const state = {
  menuSearchResults: [{ code: '20702', name: 'Combo Nhóm 2', priceVnd: 129000, imageUrl }],
} as AgentGraphState;

describe('Messenger verified projection parity', () => {
  it('renders approved facts and verified media without GenUI or a model replay', () => {
    const result = evaluateMessengerProjectionParity({
      projection,
      state,
      standaloneText: 'Combo Nhóm 2: 129.000đ. Bạn muốn chọn món nào?',
      requiredSemanticFacts: ['Combo Nhóm 2', '129.000đ'],
      now: new Date('2026-07-15T00:10:00.000Z'),
    });

    expect(result).toEqual({
      profile: 'social',
      text: 'Combo Nhóm 2: 129.000đ. Bạn muốn chọn món nào?',
      media: [{ key: 'social:20702:0', imageUrl, title: 'Combo Nhóm 2' }],
    });
    expect('genUi' in result).toBe(false);
  });

  it.each([
    ['omitted fact', 'Combo Nhóm 2.', ['129.000đ'], undefined],
    ['forbidden fact', 'Combo Nhóm 2 đã thanh toán.', ['Combo Nhóm 2'], ['đã thanh toán']],
    ['debug text', 'Combo Nhóm 2 debug.', ['Combo Nhóm 2'], undefined],
    ['unverified URL', 'Combo Nhóm 2 https://evil.example/pay', ['Combo Nhóm 2'], undefined],
  ])('rejects %s', (_name, standaloneText, requiredSemanticFacts, forbiddenSemanticFacts) => {
    expect(() => evaluateMessengerProjectionParity({
      projection,
      state,
      standaloneText,
      requiredSemanticFacts,
      forbiddenSemanticFacts,
      now: new Date('2026-07-15T00:10:00.000Z'),
    })).toThrow();
  });
});
