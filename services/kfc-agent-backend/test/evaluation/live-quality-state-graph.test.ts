import { describe, expect, it } from 'vitest';
import { projectStateGraphScenarioRun } from '../../src/evaluation/liveQualityStateGraph.js';
import type { ScenarioRunResult } from '../../src/scenarios/runner.js';

const paymentCheck = {
  toolName: 'checkPaymentStatus' as const,
  arguments: { orderId: 'KFC-MOCK-1001' },
  ok: false,
  resultSummary: 'payment_failed',
  provenance: [{
    fixtureMode: 'mock_external_state' as const,
    sourceFile: 'test/scenarios/liveScenarioFixtures.ts',
  }],
};

function paymentState(status: 'pending' | 'failed') {
  return {
    paymentAttempt: {
      method: 'zalopay_wallet',
      status,
      paymentUrl: 'https://pay.mock/zalopay_wallet/KFC-MOCK-1001',
    },
  };
}

function turnEvidence(
  turnIndex: number,
  stateBefore: ReturnType<typeof paymentState>,
  stateAfter: ReturnType<typeof paymentState>,
) {
  return {
    turnIndex,
    input: 'Mình bấm thanh toán mà lỗi.',
    durationMs: 100,
    transcriptRevisionBefore: turnIndex - 1,
    transcriptRevisionAfter: turnIndex + 1,
    eventRevisionBefore: turnIndex - 1,
    eventRevisionAfter: turnIndex,
    eventIdsBefore: [`before-${turnIndex}`],
    eventIds: [`event-${turnIndex}`],
    eventIdsAfter: [`before-${turnIndex}`, `event-${turnIndex}`],
    checkpointId: `checkpoint-${turnIndex}`,
    checkpointNamespace: `run:${turnIndex}`,
    checkpointThreadId: `agent:["session","run:${turnIndex}"]`,
    checkpointVerified: true,
    assistantText: 'Giao dịch vẫn chưa thành công.',
    genUi: {
      id: `payment-${turnIndex}`,
      title: 'Trạng thái thanh toán',
      lifecycleStage: 'active' as const,
      widgetKind: 'paymentOrderStatus' as const,
      status: 'active' as const,
      data: {},
      actions: [],
    },
    approvalRequested: false,
    approvalResumes: [],
    stateBefore,
    stateAfter,
  };
}

describe('StateGraph live-quality projection', () => {
  it('records a failed payment check without inverting the durable pending state', () => {
    const pending = paymentState('pending');
    const result = {
      toolTraceByTurn: [
        { turnIndex: 1, entries: [paymentCheck] },
        { turnIndex: 3, entries: [paymentCheck] },
      ],
      turnEvidence: [
        turnEvidence(1, pending, structuredClone(pending)),
        turnEvidence(3, pending, structuredClone(pending)),
      ],
    } satisfies Pick<ScenarioRunResult, 'turnEvidence' | 'toolTraceByTurn'>;

    const outputs = projectStateGraphScenarioRun(result, 'text');

    expect(outputs).toHaveLength(2);
    expect(outputs.map(({ observations }) => observations)).toEqual([
      [{
        kind: 'payment_status_refreshed',
        toolName: 'checkPaymentStatus',
        orderId: 'KFC-MOCK-1001',
        status: 'failed',
      }],
      [{
        kind: 'payment_status_refreshed',
        toolName: 'checkPaymentStatus',
        orderId: 'KFC-MOCK-1001',
        status: 'failed',
      }],
    ]);
    expect(outputs[1]!.stateAfter.paymentAttempt)
      .toEqual(outputs[1]!.stateBefore.paymentAttempt);
    expect(outputs[1]).not.toHaveProperty('plannerRecords');
    expect(outputs.every((output) => output.genUi === undefined)).toBe(true);
  });

  it('retains GenUI only for an explicitly selected GenUI run', () => {
    const failed = paymentState('failed');
    const result = {
      toolTraceByTurn: [{ turnIndex: 3, entries: [paymentCheck] }],
      turnEvidence: [
        turnEvidence(3, failed, structuredClone(failed)),
      ],
    } satisfies Pick<ScenarioRunResult, 'turnEvidence' | 'toolTraceByTurn'>;

    expect(projectStateGraphScenarioRun(result, 'genui')[0]?.genUi)
      .toMatchObject({ widgetKind: 'paymentOrderStatus' });
  });
});
