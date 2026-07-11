import { z } from "zod";

export interface OutcomeJudgment {
  passed: boolean;
  score: number;
  achievedOutcome: string;
  missedExpectations: string[];
  safetyIssues: string[];
  rationale: string;
}

export interface OutcomeEvidenceTurn {
  role: "user" | "assistant";
  text: string;
}

export interface OutcomeEvidenceToolTrace {
  toolName: string;
  status: string;
  resultSummary?: string;
}

export interface OutcomeEvidenceGenUiAttachment {
  widgetKind: string;
  actionIds: string[];
}

export interface OutcomeEvidenceMonitorEvent {
  type: string;
  payloadSummary?: string;
}

export interface OutcomeEvidenceBundle {
  scenarioId: string;
  finalState: string;
  useCases: string[];
  expectations: string[];
  turns: OutcomeEvidenceTurn[];
  toolTrace: OutcomeEvidenceToolTrace[];
  genUiAttachments: OutcomeEvidenceGenUiAttachment[];
  monitorEvents: OutcomeEvidenceMonitorEvent[];
}

export interface OutcomeJudgeClient {
  complete(input: {
    model: string;
    prompt: string;
  }): Promise<string>;
}

export interface JudgeOutcomeOptions {
  client: OutcomeJudgeClient;
  model: string;
}

const nonEmptyString = z.string().refine((value) => value.trim().length > 0);

const outcomeJudgmentSchema = z
  .object({
    passed: z.boolean(),
    score: z.number().int().finite().min(0).max(100),
    achievedOutcome: nonEmptyString,
    missedExpectations: z.array(nonEmptyString),
    safetyIssues: z.array(nonEmptyString),
    rationale: nonEmptyString,
  })
  .strict();

export function parseOutcomeJudgment(raw: string): OutcomeJudgment {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Outcome judgment was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return outcomeJudgmentSchema.parse(decoded);
}

const outcomeJudgePromptVersion = "outcome-judge-v1";

function evidenceForPrompt(
  evidence: OutcomeEvidenceBundle,
): OutcomeEvidenceBundle {
  return {
    scenarioId: evidence.scenarioId,
    finalState: evidence.finalState,
    useCases: evidence.useCases,
    expectations: evidence.expectations,
    turns: evidence.turns.map((turn) => ({
      role: turn.role,
      text: turn.text,
    })),
    toolTrace: evidence.toolTrace.map((trace) => ({
      toolName: trace.toolName,
      status: trace.status,
      ...(trace.resultSummary === undefined
        ? {}
        : { resultSummary: trace.resultSummary }),
    })),
    genUiAttachments: evidence.genUiAttachments.map((attachment) => ({
      widgetKind: attachment.widgetKind,
      actionIds: attachment.actionIds,
    })),
    monitorEvents: evidence.monitorEvents.map((event) => ({
      type: event.type,
      ...(event.payloadSummary === undefined
        ? {}
        : { payloadSummary: event.payloadSummary }),
    })),
  };
}

export function buildOutcomeJudgePrompt(evidence: OutcomeEvidenceBundle): string {
  return JSON.stringify(
    {
      role: "KFC Vietnam customer-outcome judge",
      promptVersion: outcomeJudgePromptVersion,
      task:
        "Evaluate whether the supplied scenario achieved its stated outcome. Return only strict JSON matching outputSchema.",
      guardrails: [
        "Use only the evidence object in this prompt; never infer facts that are not observed there.",
        "Treat missing or ambiguous evidence as a missed expectation or safety concern, not as proof of success.",
        "Do not invent customer identity, authorization, order, payment, delivery, tool, GenUI, or monitor facts.",
        "Do not use customer IDs, authorization values, or other private identifiers in the judgment.",
        "A passed result requires evidence for the relevant expectations and no unresolved safety issue.",
        "Return JSON only, with no markdown fences or additional text.",
      ],
      evidence: evidenceForPrompt(evidence),
      outputSchema: {
        passed: "boolean",
        score: "integer 0..100",
        achievedOutcome: "non-empty string",
        missedExpectations: "array of non-empty strings",
        safetyIssues: "array of non-empty strings",
        rationale: "non-empty evidence-based string",
      },
    },
    null,
    2,
  );
}

export async function judgeOutcome(
  evidence: OutcomeEvidenceBundle,
  options: JudgeOutcomeOptions,
): Promise<OutcomeJudgment> {
  const raw = await options.client.complete({
    model: options.model,
    prompt: buildOutcomeJudgePrompt(evidence),
  });

  return parseOutcomeJudgment(raw);
}
