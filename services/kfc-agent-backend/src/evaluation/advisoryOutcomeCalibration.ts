import { createHash } from 'node:crypto';
import { z } from 'zod';
import { outcomeJudgeModelProfiles } from '../config/outcomeJudgeModelProfile.js';
import { ADVISORY_SCENARIO_CATALOG } from './advisoryCriteria.js';
import { outcomeJudgePromptVersion } from './outcomeJudge.js';

export const ADVISORY_CALIBRATION_EXAMPLES_SHA256 =
  'a6694e181e4f19bfbbe1a8c19d75b895451368bf8e3b82b9d1325ae6fe24074a';

export const ADVISORY_CALIBRATION_CORE_SCENARIOS = Object.entries(
  ADVISORY_SCENARIO_CATALOG,
).flatMap(([fileName, advisory]) =>
  advisory.role === 'core'
    ? [
        {
          scenario_id: fileName.replace(/\.json$/, ''),
          criterion_ids: advisory.criteria.map((criterion) => criterion.id),
        },
      ]
    : [],
);

export const ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS = [
  'correct_advice',
  'wrong_price_or_delta',
  'unsupported_spice_or_health_claim',
  'false_availability_or_delivery_assurance',
  'premature_mutation',
  'false_milk_allergy_reassurance',
  'clarification_then_resolution',
] as const;

const coreScenarioIds = new Set(
  ADVISORY_CALIBRATION_CORE_SCENARIOS.map((scenario) => scenario.scenario_id),
);
const criterionIds = new Set<string>(
  ADVISORY_CALIBRATION_CORE_SCENARIOS.flatMap(
    (scenario) => scenario.criterion_ids,
  ),
);

const credentialLikeText = new RegExp(
  String.raw`(?:\bsk-(?:proj-)?[a-z0-9_-]{6,}\b|\bbearer\s+[a-z0-9._~+/=-]+|\b(?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|secret|(?:customer|user|order|session|conversation|message|external)[ _-]?(?:id|identifier)|private[ _-]?args)\b["']?\s*(?:(?::|=)\s*|\s+is\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+))`,
  'i',
);
const safeText = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !credentialLikeText.test(value),
    'calibration text must be redacted and contain no credential or private value',
  );
const uniqueSafeTextArray = z
  .array(safeText)
  .min(1)
  .refine(
    (values) => new Set(values).size === values.length,
    'array entries must be unique',
  );

const coverageTagSchema = z.enum(ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS);
const scenarioIdSchema = z
  .string()
  .refine(
    (value) => coreScenarioIds.has(value),
    'scenario ID must belong to the shared core advisory catalog',
  );
const criterionIdSchema = z
  .string()
  .refine(
    (value) => criterionIds.has(value),
    'criterion ID must belong to the shared core advisory catalog',
  );

const advisoryCalibrationExampleSchema = z
  .object({
    id: z.string().regex(/^adv-cal-(?:02|03|10|11)-0[1-6]$/),
    scenario_id: scenarioIdSchema,
    criterion_ids: z
      .array(criterionIdSchema)
      .min(1)
      .refine(
        (values) => new Set(values).size === values.length,
        'criterion ids must be unique',
      ),
    coverage_tags: z
      .array(coverageTagSchema)
      .min(1)
      .refine(
        (values) => new Set(values).size === values.length,
        'coverage tags must be unique',
      ),
    evidence: z
      .object({
        customer_messages: uniqueSafeTextArray,
        verified_facts: uniqueSafeTextArray,
        assistant_response: safeText,
        observed_actions: uniqueSafeTextArray,
        commerce_state_changed: z.boolean(),
      })
      .strict(),
    proposed_label: z.enum(['pass', 'fail']),
    proposal_rationale: safeText,
    review: z
      .object({
        status: z.literal('pending'),
        reviewer: z.null(),
        reviewed_at: z.null(),
      })
      .strict(),
  })
  .strict();

export const advisoryOutcomeCalibrationDraftSchema = z
  .object({
    schema_version: z.literal(1),
    artifact_kind: z.literal('kfc-advisory-outcome-calibration'),
    status: z.literal('draft'),
    review_status: z.literal('human_review_required'),
    redaction_status: z.literal('redacted'),
    judge: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        profile: z.string().min(1),
        prompt_version: z.string().min(1),
      })
      .strict(),
    examples_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    examples: z.array(advisoryCalibrationExampleSchema),
  })
  .strict();

export type AdvisoryOutcomeCalibrationDraft = z.infer<
  typeof advisoryOutcomeCalibrationDraftSchema
>;
export type AdvisoryOutcomeCalibrationExample =
  AdvisoryOutcomeCalibrationDraft['examples'][number];

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeAdvisoryCalibrationExamplesSha256(
  examples: readonly AdvisoryOutcomeCalibrationExample[],
): string {
  return createHash('sha256').update(stableJson(examples)).digest('hex');
}

function expectedExampleIds(): string[] {
  return ADVISORY_CALIBRATION_CORE_SCENARIOS.flatMap((scenario) => {
    const scenarioNumber = scenario.scenario_id.slice(0, 2);
    return Array.from(
      { length: 6 },
      (_, index) => `adv-cal-${scenarioNumber}-0${index + 1}`,
    );
  });
}

function assertJudgeIdentity(artifact: AdvisoryOutcomeCalibrationDraft): void {
  const expected = outcomeJudgeModelProfiles.openai;
  if (
    artifact.judge.provider !== expected.provider ||
    artifact.judge.model !== expected.model ||
    artifact.judge.profile !== expected.profile
  ) {
    throw new Error(
      'Advisory calibration judge provider, model, and profile must match the pinned OpenAI outcome-judge profile',
    );
  }
  if (artifact.judge.prompt_version !== outcomeJudgePromptVersion) {
    throw new Error(
      'Advisory calibration prompt version must match the current outcome-judge prompt version',
    );
  }
}

function assertExampleInventory(
  artifact: AdvisoryOutcomeCalibrationDraft,
): void {
  if (artifact.examples.length !== 24) {
    throw new Error('Advisory calibration must contain exactly 24 examples');
  }

  const ids = artifact.examples.map((example) => example.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Advisory calibration must contain unique example IDs');
  }
  if (ids.some((id, index) => id !== expectedExampleIds()[index])) {
    throw new Error(
      'Advisory calibration examples must retain canonical example order',
    );
  }

  for (const scenario of ADVISORY_CALIBRATION_CORE_SCENARIOS) {
    const examples = artifact.examples.filter(
      (example) => example.scenario_id === scenario.scenario_id,
    );
    if (examples.length !== 6) {
      throw new Error(
        'Advisory calibration must contain six examples per core scenario',
      );
    }
    const passCount = examples.filter(
      (example) => example.proposed_label === 'pass',
    ).length;
    if (passCount !== 3) {
      throw new Error(
        'Each core scenario must contain three proposed passes and three proposed failures',
      );
    }

    const allowedCriterionIds = new Set<string>(scenario.criterion_ids);
    if (
      examples.some((example) =>
        example.criterion_ids.some(
          (criterionId) => !allowedCriterionIds.has(criterionId),
        ),
      )
    ) {
      throw new Error(
        'Example criterion IDs must belong to their core scenario',
      );
    }
    const coveredCriterionIds = new Set<string>(
      examples.flatMap((example) => example.criterion_ids),
    );
    if (
      coveredCriterionIds.size !== allowedCriterionIds.size ||
      [...allowedCriterionIds].some(
        (criterionId) => !coveredCriterionIds.has(criterionId),
      )
    ) {
      throw new Error('Examples must cover all canonical criterion IDs');
    }
  }

  const coverageTags = new Set(
    artifact.examples.flatMap((example) => example.coverage_tags),
  );
  if (
    coverageTags.size !== ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS.length ||
    ADVISORY_CALIBRATION_REQUIRED_COVERAGE_TAGS.some(
      (tag) => !coverageTags.has(tag),
    )
  ) {
    throw new Error(
      'Advisory calibration must retain all required coverage tags',
    );
  }
}

function assertExamplesHash(artifact: AdvisoryOutcomeCalibrationDraft): void {
  const computedHash = computeAdvisoryCalibrationExamplesSha256(
    artifact.examples,
  );
  if (computedHash !== artifact.examples_sha256) {
    throw new Error(
      'Advisory calibration examples SHA-256 does not match the examples array',
    );
  }
  if (computedHash !== ADVISORY_CALIBRATION_EXAMPLES_SHA256) {
    throw new Error(
      'Advisory calibration examples do not match the canonical examples hash',
    );
  }
}

export function validateAdvisoryOutcomeCalibrationDraft(
  value: unknown,
): AdvisoryOutcomeCalibrationDraft {
  const artifact = advisoryOutcomeCalibrationDraftSchema.parse(value);
  assertJudgeIdentity(artifact);
  assertExampleInventory(artifact);
  assertExamplesHash(artifact);
  return artifact;
}

export function assertAdvisoryCalibrationQualificationEvidence(
  value: unknown,
): never {
  validateAdvisoryOutcomeCalibrationDraft(value);
  throw new Error(
    'Advisory calibration draft is not qualification or release evidence',
  );
}

const artifactKindProbeSchema = z
  .object({ artifact_kind: z.unknown() })
  .passthrough();

export function assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(
  value: unknown,
): void {
  const candidate = artifactKindProbeSchema.safeParse(value);
  if (
    candidate.success &&
    candidate.data.artifact_kind === 'kfc-advisory-outcome-calibration'
  ) {
    assertAdvisoryCalibrationQualificationEvidence(value);
  }
}
