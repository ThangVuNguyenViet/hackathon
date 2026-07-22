import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADVISORY_CALIBRATION_CORE_SCENARIOS,
  ADVISORY_CALIBRATION_EXAMPLES_SHA256,
  ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS,
  advisoryOutcomeCalibrationDraftSchema,
  assertAdvisoryCalibrationQualificationEvidence,
  assertQualificationEvidenceIsNotAdvisoryCalibrationDraft,
  computeAdvisoryCalibrationExamplesSha256,
  validateAdvisoryOutcomeCalibrationDraft,
  type AdvisoryOutcomeCalibrationDraft,
} from '../../src/evaluation/advisoryOutcomeCalibration.js';
import { ADVISORY_SCENARIO_CATALOG } from '../../src/evaluation/advisoryCriteria.js';
import { outcomeJudgePromptVersion } from '../../src/evaluation/outcomeJudge.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

const fixturePath = new URL(
  '../../fixtures/evaluation/openai-advisory-outcome-calibration-draft.json',
  import.meta.url,
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
}

function cloneFixture(): AdvisoryOutcomeCalibrationDraft {
  return structuredClone(
    validateAdvisoryOutcomeCalibrationDraft(loadFixture()),
  );
}

describe('OpenAI advisory outcome calibration draft', () => {
  it('validates the repository-owned draft with its pinned judge identity and hash', () => {
    const artifact = validateAdvisoryOutcomeCalibrationDraft(loadFixture());

    expect(artifact).toMatchObject({
      schema_version: 1,
      artifact_kind: 'kfc-advisory-outcome-calibration',
      status: 'draft',
      review_status: 'human_review_required',
      redaction_status: 'redacted',
      judge: {
        provider: 'openai',
        model: 'gpt-5-mini-2025-08-07',
        profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
        prompt_version: outcomeJudgePromptVersion,
      },
      examples_sha256: ADVISORY_CALIBRATION_EXAMPLES_SHA256,
    });
    expect(artifact.examples).toHaveLength(24);
    expect(computeAdvisoryCalibrationExamplesSha256(artifact.examples)).toBe(
      ADVISORY_CALIBRATION_EXAMPLES_SHA256,
    );
  });

  it('contains six unique examples per core scenario with balanced proposal labels', () => {
    const artifact = validateAdvisoryOutcomeCalibrationDraft(loadFixture());
    const exampleIds = artifact.examples.map((example) => example.id);

    expect(new Set(exampleIds).size).toBe(24);
    for (const scenario of ADVISORY_CALIBRATION_CORE_SCENARIOS) {
      const examples = artifact.examples.filter(
        (example) => example.scenario_id === scenario.scenario_id,
      );
      expect(examples).toHaveLength(6);
      expect(
        examples.filter((example) => example.proposed_label === 'pass'),
      ).toHaveLength(3);
      expect(
        examples.filter((example) => example.proposed_label === 'fail'),
      ).toHaveLength(3);
      expect(
        new Set(examples.flatMap((example) => example.criterion_ids)),
      ).toEqual(new Set(scenario.criterion_ids));
    }
  });

  it('binds active ledger advisory metadata to the shared criterion catalog', () => {
    const activeAdvisoryMetadata = liveScenarioCases.flatMap((scenario) =>
      scenario.advisory
        ? [{ file_name: scenario.fileName, advisory: scenario.advisory }]
        : [],
    );
    const catalogMetadata = Object.entries(ADVISORY_SCENARIO_CATALOG).map(
      ([fileName, advisory]) => ({ file_name: fileName, advisory }),
    );

    expect(activeAdvisoryMetadata).toEqual(catalogMetadata);
    expect(ADVISORY_CALIBRATION_CORE_SCENARIOS).toEqual(
      catalogMetadata
        .filter(({ advisory }) => advisory.role === 'core')
        .map(({ file_name, advisory }) => ({
          scenario_id: file_name.replace(/\.json$/, ''),
          criterion_ids: advisory.criteria.map((criterion) => criterion.id),
        })),
    );
  });

  it('includes verified composition in the proposed passing combo comparison', () => {
    const artifact = validateAdvisoryOutcomeCalibrationDraft(loadFixture());
    const comparison = artifact.examples.find(
      (example) => example.id === 'adv-cal-10-01',
    );
    const evidenceText = JSON.stringify(comparison?.evidence);

    expect(evidenceText).toContain('Burger Gà Zinger');
    expect(evidenceText).toContain('Khoai');
    expect(evidenceText).toContain('Gà Lắc Tiêu Chanh');
  });

  it('covers required advisory success and failure modes with pending human review', () => {
    const artifact = validateAdvisoryOutcomeCalibrationDraft(loadFixture());
    const coverageTags = new Set(
      artifact.examples.flatMap((example) => example.coverage_tags),
    );

    expect(coverageTags).toEqual(
      new Set(ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS),
    );
    expect(
      artifact.examples.every(
        (example) =>
          example.review.status === 'pending' &&
          example.review.reviewer === null &&
          example.review.reviewed_at === null,
      ),
    ).toBe(true);
    expect(
      artifact.examples.some(
        (example) =>
          example.proposed_label === 'pass' &&
          example.coverage_tags.includes('clarification_then_resolution'),
      ),
    ).toBe(true);
  });

  it.each([
    [
      'provider drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.judge.provider = 'google';
      },
    ],
    [
      'model drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.judge.model = 'gpt-5';
      },
    ],
    [
      'profile drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.judge.profile = 'openai-unpinned';
      },
    ],
    [
      'prompt drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.judge.prompt_version = 'outcome-judge-v0';
      },
    ],
    [
      'draft status drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        Reflect.set(artifact, 'status', 'approved');
      },
    ],
    [
      'human review status drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        Reflect.set(artifact, 'review_status', 'approved');
      },
    ],
    [
      'review completion',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        const review = artifact.examples[0]!.review;
        Reflect.set(review, 'status', 'approved');
        Reflect.set(review, 'reviewer', 'reviewer');
        Reflect.set(review, 'reviewed_at', '2026-07-22T00:00:00Z');
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const artifact = cloneFixture();
    mutate(artifact);

    expect(() => validateAdvisoryOutcomeCalibrationDraft(artifact)).toThrow();
  });

  it('rejects mutation even when the artifact hash is recomputed', () => {
    const artifact = cloneFixture();
    artifact.examples[0]!.evidence.assistant_response += ' Mutated.';
    artifact.examples_sha256 = computeAdvisoryCalibrationExamplesSha256(
      artifact.examples,
    );

    expect(() => validateAdvisoryOutcomeCalibrationDraft(artifact)).toThrow(
      /canonical examples hash/i,
    );
  });

  it('rejects reordering even when the artifact hash is recomputed', () => {
    const artifact = cloneFixture();
    [artifact.examples[0], artifact.examples[1]] = [
      artifact.examples[1]!,
      artifact.examples[0]!,
    ];
    artifact.examples_sha256 = computeAdvisoryCalibrationExamplesSha256(
      artifact.examples,
    );

    expect(() => validateAdvisoryOutcomeCalibrationDraft(artifact)).toThrow(
      /canonical example order/i,
    );
  });

  it.each([
    [
      'duplicate IDs',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.examples[1]!.id = artifact.examples[0]!.id;
      },
      /unique example ids/i,
    ],
    [
      'wrong count',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.examples.pop();
      },
      /exactly 24 examples/i,
    ],
    [
      'scenario coverage drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.examples[0]!.scenario_id = '03-ton-kho-dia-chi-va-cua-hang';
      },
      /six examples per core scenario/i,
    ],
    [
      'criterion coverage drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.examples[0]!.criterion_ids = [
          'advisory.03.unavailable-item-boundary',
        ];
      },
      /criterion ids/i,
    ],
    [
      'proposal balance drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        artifact.examples[0]!.proposed_label = 'fail';
      },
      /three proposed passes and three proposed failures/i,
    ],
    [
      'coverage tag drift',
      (artifact: AdvisoryOutcomeCalibrationDraft) => {
        for (const example of artifact.examples) {
          example.coverage_tags = example.coverage_tags.map((tag) =>
            tag === 'wrong_price_or_delta' ? 'correct_advice' : tag,
          );
        }
      },
      /required coverage tags/i,
    ],
  ])(
    'rejects %s independently of the stored hash',
    (_label, mutate, message) => {
      const artifact = cloneFixture();
      mutate(artifact);

      expect(() => validateAdvisoryOutcomeCalibrationDraft(artifact)).toThrow(
        message,
      );
    },
  );

  it('rejects unknown fields', () => {
    const artifact = cloneFixture();
    Reflect.set(artifact, 'release_approved', true);

    expect(() => validateAdvisoryOutcomeCalibrationDraft(artifact)).toThrow();
  });

  it.each([
    'authorization=Bearer private-value',
    'sk-abc123',
    'sk-proj-abc123',
    'api key sk-private-value',
    'access token is private-value',
    'password is private-value',
    'secret=private-value',
    'customer_id=cust-private-value',
    'customerId=cust-private-value',
    '{"customerId":"cust-private-value"}',
    'external_id is ext-private-value',
    'externalId=ext-private-value',
    '{"externalId":"ext-private-value"}',
    'privateArgs={"address":"private-value"}',
    '{"privateArgs":{"address":"private-value"}}',
  ])(
    'rejects unredacted credential or private-argument text: %s',
    (unsafeText) => {
      const artifact = cloneFixture();
      artifact.examples[0]!.evidence.assistant_response = unsafeText;

      expect(() =>
        advisoryOutcomeCalibrationDraftSchema.parse(artifact),
      ).toThrow(/credential|private|redacted/i);
    },
  );

  it.each([
    'Item ID 41042 is Burger Gà Yo.',
    'The secret recipe is not part of the supplied evidence.',
    'Use the item identifier from the public catalog.',
  ])('accepts ordinary catalog and non-assignment text: %s', (safeText) => {
    const artifact = cloneFixture();
    artifact.examples[0]!.evidence.assistant_response = safeText;

    expect(() =>
      advisoryOutcomeCalibrationDraftSchema.parse(artifact),
    ).not.toThrow();
  });

  it('cannot be presented as qualification or release evidence', () => {
    expect(() =>
      assertAdvisoryCalibrationQualificationEvidence(loadFixture()),
    ).toThrow(/draft.*not.*qualification.*release evidence/i);
  });

  it('exposes a qualification-intake guard that rejects this draft and ignores other artifact kinds', () => {
    expect(() =>
      assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(loadFixture()),
    ).toThrow(/draft.*not.*qualification.*release evidence/i);
    expect(() =>
      assertQualificationEvidenceIsNotAdvisoryCalibrationDraft({
        artifact_kind: 'kfc-live-text-qualification',
      }),
    ).not.toThrow();
  });
});
