import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  judgeOutcome,
  OpenAIOutcomeJudgeClient,
  type OutcomeEvidenceBundle,
  type OutcomeJudgeClient,
  type OutcomeJudgment,
} from "../src/evaluation/outcomeJudge.js";

const nonEmptyString = z.string().min(1);
const evidenceSchema: z.ZodType<OutcomeEvidenceBundle> = z.object({
  scenarioId: nonEmptyString,
  finalState: nonEmptyString,
  useCases: z.array(nonEmptyString),
  expectations: z.array(nonEmptyString),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }).strict()),
  toolTrace: z.array(z.object({ toolName: nonEmptyString, status: nonEmptyString, resultSummary: z.string().optional() }).strict()),
  genUiAttachments: z.array(z.object({ widgetKind: nonEmptyString, actionIds: z.array(nonEmptyString), values: z.unknown().optional() }).strict()),
  monitorEvents: z.array(z.object({ type: nonEmptyString, payloadSummary: z.string().optional() }).strict()),
}).strict();
const releaseMetadataSchema = z.object({ gitSha: nonEmptyString, releaseBuiltAt: nonEmptyString, dirty: z.boolean() }).strict();

export interface OutcomeJudgmentArtifact {
  gitSha: string;
  releaseBuiltAt: string;
  dirty: boolean;
  model: string;
  judgedAt: string;
  scenarios: Array<{ scenarioId: string; judgment: OutcomeJudgment }>;
}

export interface RunOutcomeJudgmentsOptions {
  evidencePath: string;
  outputPath: string;
  releaseMetadataPath: string;
  model?: string;
  client?: OutcomeJudgeClient;
  judgedAt?: string;
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
  const scenarios = Array.isArray(decoded) ? decoded : (decoded as { scenarios?: unknown } | null)?.scenarios;
  if (!Array.isArray(scenarios)) throw new Error("Outcome evidence must contain a scenarios array");
  return z.array(evidenceSchema).parse(scenarios);
}

export async function runOutcomeJudgments(options: RunOutcomeJudgmentsOptions): Promise<OutcomeJudgmentArtifact> {
  const evidence = await loadEvidence(options.evidencePath);
  const release = releaseMetadataSchema.parse(parseJson(await readFile(options.releaseMetadataPath, "utf8"), "Release metadata"));
  const model = options.model?.trim() || process.env.OUTCOME_JUDGE_MODEL?.trim() || "gpt-4.1-mini";
  const client = options.client ?? new OpenAIOutcomeJudgeClient({ apiKey: requireApiKey(), baseUrl: process.env.OPENAI_BASE_URL });
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
  await writeFile(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

function requireApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  return apiKey;
}

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

if (process.argv[1]?.endsWith("run-outcome-judgments.ts")) {
  runOutcomeJudgments({
    evidencePath: arg("--evidence"),
    outputPath: arg("--output"),
    releaseMetadataPath: arg("--release-metadata"),
    model: process.argv.includes("--model") ? arg("--model") : undefined,
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
