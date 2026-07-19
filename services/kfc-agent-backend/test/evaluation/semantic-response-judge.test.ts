import { describe, expect, it } from 'vitest';
import {
  LIVE_QUALITY_INVENTORY_VERSION,
  type LiveQualityExperimentOutput,
} from '../../src/evaluation/liveQualityContracts.js';
import { buildLiveQualityDatasetCases } from '../../src/evaluation/liveQualityDataset.js';
import { createLiveQualityExperimentEvaluator } from '../../src/evaluation/liveQualityEvaluators.js';
import {
  createSemanticResponseJudge,
  parseSemanticResponseJudgment,
} from '../../src/evaluation/semanticResponseJudge.js';
import type { OutcomeJudgeClient } from '../../src/evaluation/outcomeJudge.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

class StaticJudgeClient implements OutcomeJudgeClient {
  readonly requests: Array<{ model: string; system: string; user: string }> = [];

  constructor(private readonly response: string) {}

  async complete(input: {
    model: string;
    system: string;
    user: string;
  }): Promise<string> {
    this.requests.push(input);
    return this.response;
  }
}

function complaintOutput(responseText: string): LiveQualityExperimentOutput {
  return {
    responseText,
    plannerRecords: [{
      toolNames: [],
      calls: [],
      booleanEntities: {},
      catalogCandidateCodes: [],
      catalogModifierOptionNames: [],
      fulfillmentLocations: [],
    }],
    executedTools: [],
    stateBefore: {},
    stateAfter: {},
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

function complaintCase() {
  return buildLiveQualityDatasetCases({
    inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
    scenarioCases: liveScenarioCases,
  }).find(({ inputs }) =>
    inputs.caseId === '05-khieu-nai-va-human-handoff.json#1:text')!;
}

describe('semantic response judge', () => {
  it('accepts natural Vietnamese wording without prescribing a fixed phrase', async () => {
    const requirementId = complaintCase().outputs.expectation.claims.required[0]!.requirementId;
    const client = new StaticJudgeClient(JSON.stringify({
      passed: true,
      requirements: [{
        requirementId,
        passed: true,
        rationale: 'The response acknowledges the missing item and asks for support detail.',
      }],
    }));
    const judge = createSemanticResponseJudge({ client, model: 'judge-test' });
    const output = complaintOutput(
      'Mình rất tiếc vì phần khoai bị thiếu. Bạn cho mình xin thêm thông tin trên đơn để đội hỗ trợ kiểm tra nhé.',
    );
    const scores = await createLiveQualityExperimentEvaluator(
      [complaintCase()],
      { semanticJudge: judge },
    )({
      inputs: { caseId: complaintCase().inputs.caseId },
      outputs: output as unknown as Record<string, unknown>,
    });

    expect(scores.find(({ key }) => key === 'semantic_response')).toMatchObject({
      score: 1,
      value: true,
    });
    expect(scores.find(({ key }) => key === 'acceptance')).toMatchObject({
      score: 1,
      value: true,
    });
    expect(client.requests[0]?.system).toContain('Judge semantic meaning, not exact wording');
    expect(client.requests[0]?.user).not.toContain('apiKey');
  });

  it('rejects a generic non-empty answer when it misses the required behavior', async () => {
    const requirementId = complaintCase().outputs.expectation.claims.required[0]!.requirementId;
    const judge = createSemanticResponseJudge({
      client: new StaticJudgeClient(JSON.stringify({
        passed: false,
        requirements: [{
          requirementId,
          passed: false,
          rationale: 'The response is generic and does not acknowledge the missing fries complaint.',
        }],
      })),
      model: 'judge-test',
    });
    const scores = await createLiveQualityExperimentEvaluator(
      [complaintCase()],
      { semanticJudge: judge },
    )({
      inputs: { caseId: complaintCase().inputs.caseId },
      outputs: complaintOutput('Cảm ơn bạn đã liên hệ.') as unknown as Record<string, unknown>,
    });

    expect(scores.find(({ key }) => key === 'semantic_response')).toMatchObject({
      score: 0,
      value: false,
      comment: expect.stringContaining('generic'),
    });
    expect(scores.find(({ key }) => key === 'acceptance')).toMatchObject({
      score: 0,
      value: false,
    });
  });

  it('fails closed on incomplete or internally inconsistent judge output', () => {
    expect(() => parseSemanticResponseJudgment(JSON.stringify({
      passed: true,
      requirements: [],
    }), ['required-1'])).toThrow(/every expected requirement exactly once/);
    expect(() => parseSemanticResponseJudgment(JSON.stringify({
      passed: true,
      requirements: [{
        requirementId: 'required-1',
        passed: false,
        rationale: 'missing',
      }],
    }), ['required-1'])).toThrow(/must equal all requirement results/);
  });
});
