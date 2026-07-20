import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  isPrivateResponseEvidenceTool,
} from '../../src/agent/responseEvidenceContracts.js';
import { projectStateGraphScenarioRun } from '../../src/evaluation/liveQualityStateGraph.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';
import type { ScenarioRunResult } from '../../src/scenarios/runner.js';

const privateToolNames = toolNames.filter(
  isPrivateResponseEvidenceTool,
);

const paymentArgumentsDigest = createHash('sha256')
  .update(JSON.stringify({ orderId: 'KFC-MOCK-1001' }))
  .digest('hex');

const paymentCheck = {
  toolName: 'checkPaymentStatus' as const,
  arguments: { orderId: 'KFC-MOCK-1001' },
  ok: false,
  resultSummary: 'payment_failed',
  provenance: [{
    fixtureMode: 'mock_external_state' as const,
    sourceFile: 'test/scenarios/liveScenarioFixtures.ts',
  }],
  publicationEvidenceAudit: {
    schemaVersion: 'kfc-tool-trace-publication-audit-v1' as const,
    currentTurnId: 'payment-check-turn',
    traceIndex: 0,
    traceDigest: 'b'.repeat(64),
    argumentsDigest: paymentArgumentsDigest,
    toolCallId: 'payment-check-call',
    toolName: 'checkPaymentStatus' as const,
    executionOutcome: 'error' as const,
    evidenceId: `current:checkPaymentStatus:${'c'.repeat(64)}`,
    evidenceDigest: 'c'.repeat(64),
  },
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
  it('projects all private tool traces before exposing evaluation output', () => {
    expect(privateToolNames).toHaveLength(15);
    const sentinels = [
      'private-customer-argument',
      'private-provider-result',
      'private-provider-file',
      'https://private.invalid/provider',
      'private-provider-api',
    ] as const;
    const rawEntries: ToolTraceEntry[] = privateToolNames.map(
      (toolName) => ({
        toolName,
        arguments: { customerValue: sentinels[0] },
        ok: true,
        resultSummary: sentinels[1],
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: sentinels[2],
          sourceUrl: sentinels[3],
          sourceApi: sentinels[4],
        }],
      }),
    );
    const pending = paymentState('pending');
    const result = {
      toolTraceByTurn: [{ turnIndex: 1, entries: rawEntries }],
      turnEvidence: [
        turnEvidence(1, pending, structuredClone(pending)),
      ],
    } satisfies Pick<
      ScenarioRunResult,
      'turnEvidence' | 'toolTraceByTurn'
    >;

    const [projected] = projectStateGraphScenarioRun(result, 'text');
    const serialized = JSON.stringify(projected);

    expect(projected?.executedTools).toHaveLength(15);
    for (const entry of projected?.executedTools ?? []) {
      expect(entry.arguments).toEqual({
        privateArgumentsRedacted: true,
      });
      expect(entry.resultSummary).toMatch(
        /^(?:private_tool_observed|recent_order_observed|order_status_observed|payment_status_observed)$/u,
      );
      expect(entry.provenance).toEqual([{
        fixtureMode: 'provider_runtime',
      }]);
    }
    for (const sentinel of sentinels) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(JSON.stringify(rawEntries)).toContain(sentinels[0]);
    expect(rawEntries[0]?.arguments).toEqual({
      customerValue: sentinels[0],
    });
  });

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
        privateArgumentsDigest: paymentArgumentsDigest,
        status: 'failed',
      }],
      [{
        kind: 'payment_status_refreshed',
        toolName: 'checkPaymentStatus',
        privateArgumentsDigest: paymentArgumentsDigest,
        status: 'failed',
      }],
    ]);
    expect(outputs[1]!.stateAfter.paymentAttempt)
      .toEqual(outputs[1]!.stateBefore.paymentAttempt);
    expect(outputs[1]!.executedTools[0]?.arguments).toEqual({
      privateArgumentsDigest: paymentArgumentsDigest,
    });
    expect(JSON.stringify(outputs[1]!.observations))
      .not.toContain('KFC-MOCK-1001');
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
