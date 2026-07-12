import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadSupportedOutcomeJudgeEnvFile } from "../src/config/outcomeJudgeEnv.js";
import {
  judgeOutcome,
  OpenAIOutcomeJudgeClient,
  type OutcomeEvidenceBundle,
  type OutcomeJudgeClient,
} from "../src/evaluation/outcomeJudge.js";
import {
  EXPECTED_OUTCOME_SCENARIO_IDS,
  releaseMetadataSchema,
  type OutcomeJudgmentArtifact,
} from "../src/evaluation/outcomeJudgmentArtifact.js";

export { EXPECTED_OUTCOME_SCENARIO_IDS } from "../src/evaluation/outcomeJudgmentArtifact.js";
export type { OutcomeJudgmentArtifact } from "../src/evaluation/outcomeJudgmentArtifact.js";

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const evidenceSchema: z.ZodType<OutcomeEvidenceBundle> = z.object({
  scenarioId: nonEmptyString,
  finalState: nonEmptyString,
  useCases: z.array(nonEmptyString),
  expectations: z.array(nonEmptyString),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: nonEmptyString }).strict()),
  toolTrace: z.array(z.object({ toolName: nonEmptyString, status: nonEmptyString, resultSummary: optionalNonEmptyString }).strict()),
  genUiAttachments: z.array(z.object({ widgetKind: nonEmptyString, actionIds: z.array(nonEmptyString), values: z.unknown().optional() }).strict()),
  monitorEvents: z.array(z.object({ type: nonEmptyString, payloadSummary: optionalNonEmptyString }).strict()),
}).strict();
export interface RunOutcomeJudgmentsOptions {
  evidencePath: string;
  outputPath: string;
  releaseMetadataPath: string;
  model?: string | undefined;
  client?: OutcomeJudgeClient | undefined;
  judgedAt?: string | undefined;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadEvidence(path: string): Promise<OutcomeEvidenceBundle[]> {
  const decoded = parseJson(await readFile(path, "utf8"), "Outcome evidence");
  const scenarios = Array.isArray(decoded) ? decoded : (decoded as { scenarios?: unknown | undefined } | null)?.scenarios;
  if (!Array.isArray(scenarios)) throw new Error("Outcome evidence must contain a scenarios array");
  const parsed = z.array(evidenceSchema).parse(scenarios);
  const actualIds = parsed.map(({ scenarioId }) => scenarioId);
  const expectedIds: ReadonlySet<string> = new Set(EXPECTED_OUTCOME_SCENARIO_IDS);
  const actualIdSet = new Set(actualIds);
  if (
    actualIds.length !== EXPECTED_OUTCOME_SCENARIO_IDS.length ||
    actualIdSet.size !== actualIds.length ||
    actualIdSet.size !== expectedIds.size ||
    actualIds.some((scenarioId) => !expectedIds.has(scenarioId))
  ) {
    throw new Error("Outcome evidence scenario IDs must exactly match the canonical nine scenarios");
  }
  return EXPECTED_OUTCOME_SCENARIO_IDS.map((scenarioId) => parsed.find((bundle) => bundle.scenarioId === scenarioId)!);
}

async function writeArtifactAtomically(path: string, artifact: OutcomeJudgmentArtifact): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function runOutcomeJudgments(options: RunOutcomeJudgmentsOptions): Promise<OutcomeJudgmentArtifact> {
  const evidence = await loadEvidence(options.evidencePath);
  const release = releaseMetadataSchema.parse(parseJson(await readFile(options.releaseMetadataPath, "utf8"), "Release metadata"));
  const model = options.model?.trim() || process.env["OUTCOME_JUDGE_MODEL"]?.trim() || "gpt-4.1-mini";
  const client = options.client ?? new OpenAIOutcomeJudgeClient({ apiKey: requireApiKey(), baseUrl: process.env["OPENAI_BASE_URL"] });
  const scenarios: OutcomeJudgmentArtifact["scenarios"] = [];
  for (const bundle of evidence) {
    scenarios.push({ scenarioId: bundle.scenarioId, judgment: await judgeOutcome(bundle, { client, model }) });
  }
  const artifact: OutcomeJudgmentArtifact = {
    ...release,
    model,
    judgedAt: options.judgedAt ?? new Date().toISOString(),
    scenarios,
  };
  await writeArtifactAtomically(options.outputPath, artifact);
  return artifact;
}

function requireApiKey(): string {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  return apiKey;
}

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function printHelp(): void {
  console.log([
    "Usage: tsx scripts/run-outcome-judgments.ts --evidence <path> --output <path> --release-metadata <path> [--model <model>] [--env-file <path>]",
    "",
    "Judges exactly the nine canonical ai-talent-tracks/fnb/conversations scenarios.",
    "Default model: OUTCOME_JUDGE_MODEL, or gpt-4.1-mini when the environment variable is unset.",
    "Request timeout: OUTCOME_JUDGE_TIMEOUT_MS, or 60000ms when the environment variable is unset.",
  ].join("\n"));
}

if (process.argv[1]?.endsWith("run-outcome-judgments.ts")) {
  const cliArgs = process.argv.slice(2);
  const hasExecutionArgs = cliArgs.some((value, index) => value !== "--env-file" && cliArgs[index - 1] !== "--env-file");
  if (!hasExecutionArgs || cliArgs.includes("--help")) {
    printHelp();
    process.exit(0);
  }
  const runCli = async (): Promise<void> => {
    if (process.argv.includes("--env-file")) {
      await loadSupportedOutcomeJudgeEnvFile(arg("--env-file"));
    }
    await runOutcomeJudgments({
      evidencePath: arg("--evidence"),
      outputPath: arg("--output"),
      releaseMetadataPath: arg("--release-metadata"),
      model: process.argv.includes("--model") ? arg("--model") : undefined,
    });
  };
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
