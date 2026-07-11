import { z } from "zod";
import { outcomeJudgmentSchema, type OutcomeJudgment } from "./outcomeJudge.js";

export const EXPECTED_OUTCOME_SCENARIO_IDS = [
  "01-dat-mon-ro-rang-giao-hang",
  "02-tu-van-combo-va-upsell",
  "03-ton-kho-dia-chi-va-cua-hang",
  "04-sau-khi-dat-don",
  "05-khieu-nai-va-human-handoff",
  "06-ngon-ngu-tu-nhien-va-an-toan",
  "07-ca-nhan-hoa-va-loyalty",
  "08-thanh-toan-loi-va-don-bat-thuong",
  "09-phuong-thuc-thanh-toan",
] as const;

const nonEmptyString = z.string().trim().min(1);

export const releaseMetadataSchema = z.object({
  gitSha: nonEmptyString,
  releaseBuiltAt: nonEmptyString,
  dirty: z.boolean(),
}).strict();

const outcomeJudgmentArtifactSchema = z.object({
  gitSha: nonEmptyString,
  releaseBuiltAt: nonEmptyString,
  dirty: z.boolean(),
  model: nonEmptyString,
  judgedAt: nonEmptyString,
  scenarios: z.array(z.object({
    scenarioId: nonEmptyString,
    judgment: outcomeJudgmentSchema,
  }).strict()),
}).strict();

export interface OutcomeJudgmentArtifact {
  gitSha: string;
  releaseBuiltAt: string;
  dirty: boolean;
  model: string;
  judgedAt: string;
  scenarios: Array<{ scenarioId: string; judgment: OutcomeJudgment }>;
}

function assertCanonicalScenarioIds(scenarios: OutcomeJudgmentArtifact["scenarios"]): void {
  const actualIds = scenarios.map(({ scenarioId }) => scenarioId);
  const expectedIds: ReadonlySet<string> = new Set(EXPECTED_OUTCOME_SCENARIO_IDS);
  const actualIdSet = new Set(actualIds);
  if (
    actualIds.length !== EXPECTED_OUTCOME_SCENARIO_IDS.length ||
    actualIdSet.size !== actualIds.length ||
    actualIdSet.size !== expectedIds.size ||
    actualIds.some((scenarioId) => !expectedIds.has(scenarioId))
  ) {
    throw new Error("Outcome judgment scenario IDs must exactly match the canonical nine scenarios");
  }
}

export function validateOutcomeJudgmentArtifact(
  artifact: unknown,
  releaseMetadata: unknown,
): OutcomeJudgmentArtifact {
  const expectedRelease = releaseMetadataSchema.parse(releaseMetadata);
  const parsedArtifact = outcomeJudgmentArtifactSchema.parse(artifact);
  assertCanonicalScenarioIds(parsedArtifact.scenarios);
  for (const field of ["gitSha", "releaseBuiltAt", "dirty"] as const) {
    if (parsedArtifact[field] !== expectedRelease[field]) {
      throw new Error(`Outcome judgment release mismatch: ${field}`);
    }
  }
  if (parsedArtifact.scenarios.some(({ judgment }) => judgment.passed !== true)) {
    throw new Error("Outcome judgments must contain exactly nine passing judgments");
  }
  return parsedArtifact;
}
