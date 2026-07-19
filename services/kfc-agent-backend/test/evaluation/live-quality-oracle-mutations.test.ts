import { describe, expect, it } from 'vitest';
import type { ToolTraceEntry } from '../../src/ordering/types.js';
import {
  type LiveQualityExperimentOutput,
  type TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import { evaluateLiveQualityOutput } from '../../src/evaluation/liveQualityEvaluators.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

const provenance = [{
  fixtureMode: 'test_only' as const,
  sourceFile: 'test/evaluation/live-quality-oracle-mutations.test.ts',
}];

function expectation(id: string): TurnExpectation {
  const row = liveScenarioCases
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing ledger row ${id}`);
  return row;
}

function entry(
  toolName: ToolTraceEntry['toolName'],
  args: Record<string, unknown>,
  options: { ok?: boolean; resultSummary?: string } = {},
): ToolTraceEntry {
  return {
    toolName,
    arguments: args,
    ok: options.ok ?? true,
    resultSummary: options.resultSummary ?? `${toolName}_ok`,
    provenance,
  };
}

function output(input: {
  responseText: string;
  entries: ToolTraceEntry[];
  stateBefore?: Record<string, unknown>;
  stateAfter?: Record<string, unknown>;
}): LiveQualityExperimentOutput {
  return {
    responseText: input.responseText,
    plannerRecords: [{
      toolNames: input.entries.map(({ toolName }) => toolName),
      calls: input.entries.map(({ toolName, arguments: args }) => ({ toolName, arguments: args })),
      booleanEntities: {},
      catalogCandidateCodes: [],
      catalogModifierOptionNames: [],
      fulfillmentLocations: [],
    }],
    executedTools: input.entries,
    stateBefore: input.stateBefore ?? {},
    stateAfter: input.stateAfter ?? {},
    durationMs: 100,
    persistence: {
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: 1,
      eventIdsBefore: [],
      eventIds: ['event-1'],
      eventIdsAfter: ['event-1'],
      checkpointId: 'checkpoint-1',
      checkpointNamespace: 'run:test',
      checkpointThreadId: 'replay_test',
      checkpointVerified: true,
    },
  };
}

function component(
  expected: TurnExpectation,
  observed: LiveQualityExperimentOutput,
  key: 'tool_contract' | 'state_transition' | 'grounded_response',
) {
  return evaluateLiveQualityOutput(expected, observed, 'text')
    .find((score) => score.key === key);
}

describe('live quality oracle mutation sensitivity', () => {
  it('rejects a multi-tool response and trace that omit the promotion outcome', () => {
    const expected = expectation('02-tu-van-combo-va-upsell.json#3');
    const observed = output({
      responseText: 'Mình đã hiển thị toàn bộ menu.',
      entries: [entry('searchMenu', { query: 'toàn bộ menu' })],
      stateAfter: { menuSearchResults: [{ code: '41141', name: 'Burger Gà Zinger' }] },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('missing required tool group'),
    });
    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining('searchPromotions|explainPromotion|validateVoucher'),
    });
  });

  it('rejects reversed payment outcome polarity', () => {
    const expected = expectation('08-thanh-toan-loi-va-don-bat-thuong.json#1');
    const observed = output({
      responseText: 'Thanh toán đã thành công.',
      entries: [entry(
        'checkPaymentStatus',
        { orderId: 'KFC-MOCK-1001' },
        { ok: true, resultSummary: 'payment_paid' },
      )],
      stateAfter: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'failed' },
      },
    });

    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining('wrong checkPaymentStatus outcome'),
    });
  });

  it('distinguishes confirmation-required refusal from a provider failure', () => {
    const expected = expectation('07-ca-nhan-hoa-va-loyalty.json#7');
    const observed = output({
      responseText: 'Giỏ hàng đã đổi và voucher chưa được cấp.',
      entries: [
        entry('updateCart', { itemCode: '20698', quantity: 1 }),
        entry(
          'acquireVoucher',
          { rewardId: 'reward-discount-10k', confirmed: false },
          { ok: false, resultSummary: 'provider_timeout' },
        ),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: { cart: { items: [{ itemCode: '20698' }] } },
    });

    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining('wrong acquireVoucher outcome'),
    });
  });

  it('rejects duplicate irreversible side effects and incorrect exact arguments', () => {
    const expected = expectation('07-ca-nhan-hoa-va-loyalty.json#9');
    const acquire = entry(
      'acquireVoucher',
      { rewardId: 'wrong-reward', confirmed: true },
      { resultSummary: 'voucher_acquired' },
    );
    const observed = output({
      responseText: 'Đã đổi mã và dùng ưu đãi.',
      entries: [
        acquire,
        acquire,
        entry(
          'redeemReward',
          {
            voucherId: 'wallet-new-member-25k',
            channel: 'zalo_miniapp',
            confirmed: true,
          },
          { resultSummary: 'reward_redeemed' },
        ),
      ],
      stateBefore: { customerContext: { loyaltyPoints: 120 } },
      stateAfter: { customerContext: { loyaltyPoints: 90 } },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(/maximum 1|exact contract/),
    });
  });

  it('rejects missing invoice, order, and payment state evidence', () => {
    const expected = expectation('01-dat-mon-ro-rang-giao-hang.json#11');
    const observed = output({
      responseText: 'Đã ghi nhận thông tin.',
      entries: [
        entry('collectInvoice', {
          companyName: 'Công ty ABC',
          taxCode: '0312345678',
          email: 'finance@abc.test',
        }),
        entry('previewOrder', {}),
        entry('placeOrder', {}),
        entry('createPaymentLink', { method: 'zalopay' }),
      ],
      stateAfter: {},
    });

    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining('invoiceRequest failed present'),
    });
  });
});
