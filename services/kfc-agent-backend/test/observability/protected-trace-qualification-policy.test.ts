import { describe, expect, it } from 'vitest';
import {
  currentLiveQualityProtectedTracePolicy,
  deriveProtectedTraceCampaignDimensions,
  protectedTraceApplicabilityForTurn,
  protectedTraceDatasetInventoryDigest,
  reviewProtectedTraceRuntimeIdentity,
} from '../../src/evaluation/protectedTraceQualificationPolicy.js';

describe('protected trace qualification policy', () => {
  it('selects the reviewed remote V2 policy without teaching the generic verifier V3', () => {
    expect(currentLiveQualityProtectedTracePolicy).toMatchObject({
      policyId: 'kfc-live-quality-v2-protected-trace-v1',
      dataset: {
        name: 'kfc-live-quality-v2',
        schemaVersion: 'kfc-live-quality-v2',
        inventoryVersion: '2026-07-20.1',
        inventoryDigest:
          '9684774444e7b844fab12de0da5b9530035aa8f8cf5b5c275fbebd68e2cb76d5',
        scenarioCount: 9,
        turnCount: 46,
        caseCount: 92,
      },
      modes: ['text', 'genui'],
      repetitionsPerMode: 3,
      costPolicy: 'provider_reported_or_unavailable',
    });
    expect(JSON.stringify(currentLiveQualityProtectedTracePolicy)).not.toContain(
      'kfc-live-quality-v3',
    );
  });

  it('derives conditional span applicability from the reviewed turn oracle', () => {
    const expectation = {
      toolCounts: [{ toolName: 'placeOrder', min: 1 }],
      stateTransition: { mustChange: ['order'] },
      genUi: { required: true },
    };

    expect(protectedTraceApplicabilityForTurn(expectation, 'genui')).toEqual({
      tool: 'required',
      approval: 'required',
      verifiedState: 'required',
      genui: 'required',
    });
    expect(protectedTraceApplicabilityForTurn(expectation, 'text')).toEqual({
      tool: 'required',
      approval: 'required',
      verifiedState: 'required',
      genui: 'forbidden',
    });
  });

  it('computes an order-independent remote dataset inventory digest', () => {
    const examples = [
      { inputs: { caseId: 'b' }, outputs: {}, metadata: {}, split: 'acceptance' },
      { inputs: { caseId: 'a' }, outputs: {}, metadata: {}, split: 'acceptance' },
    ];
    expect(protectedTraceDatasetInventoryDigest(examples)).toMatch(/^[0-9a-f]{64}$/u);
    expect(protectedTraceDatasetInventoryDigest(examples)).toBe(
      protectedTraceDatasetInventoryDigest([...examples].reverse()),
    );
  });

  it('normalizes only an explicitly resolved provider identity', () => {
    expect(
      reviewProtectedTraceRuntimeIdentity({
        runtimeId: 'langgraph-stategraph-v1',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        profile: 'openai-qualification',
      }),
    ).toEqual({
      runtimeId: 'langgraph-stategraph-v1',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai-qualification',
    });
    expect(() =>
      reviewProtectedTraceRuntimeIdentity({
        runtimeId: 'langgraph-stategraph-v1',
        provider: 'unreviewed-provider',
        model: 'unknown',
        profile: 'unknown',
      }),
    ).toThrow('protected_trace_runtime_identity_invalid');
  });

  it('derives campaign totals from explicit modes and repetitions', () => {
    expect(
      deriveProtectedTraceCampaignDimensions(
        currentLiveQualityProtectedTracePolicy,
      ),
    ).toEqual({
      receiptCount: 6,
      scenarioModeRuns: 54,
      turnEvaluations: 276,
    });
  });
});
