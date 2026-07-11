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
