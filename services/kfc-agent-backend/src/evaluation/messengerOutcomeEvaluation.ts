import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import {
  judgeOutcome,
  type OutcomeJudgment,
} from "./outcomeJudge.js";

const nonEmptyString = z.string().trim().min(1);

const messengerTurnExpectationSchema = z
  .object({
    turn: z.number().int().positive(),
    outcome: nonEmptyString,
    safetyConstraints: z.array(nonEmptyString),
    requiredTools: z.array(nonEmptyString),
    forbiddenTools: z.array(nonEmptyString),
    maxLatencyMs: z.number().int().min(1).max(10_000),
  })
  .strict();

export type MessengerTurnExpectation = z.infer<
  typeof messengerTurnExpectationSchema
>;

export interface EvaluateMessengerTurnOptions {
  model: BaseChatModel;
  timeoutMs?: number;
}

export function parseMessengerTurnExpectations(
  value: unknown,
  expectedTurnCount: number,
): MessengerTurnExpectation[] {
  const expectations = z.array(messengerTurnExpectationSchema).parse(value);
  if (
    expectations.length !== expectedTurnCount ||
    expectations.some(({ turn }, index) => turn !== index + 1)
  ) {
    throw new Error(
      `Messenger expectations must define turns 1-${expectedTurnCount} in order`,
    );
  }
  return expectations;
}

export async function evaluateMessengerTurnOutcome(
  input: {
    expectation: MessengerTurnExpectation;
    customerText: string;
    assistantText: string;
    toolNames: string[];
    monitorEventTypes: string[];
  },
  options: EvaluateMessengerTurnOptions,
): Promise<OutcomeJudgment> {
  const tools = new Set(input.toolNames);
  for (const required of input.expectation.requiredTools) {
    if (!tools.has(required)) {
      throw new Error(
        `Turn ${input.expectation.turn} omitted required tool evidence: ${required}`,
      );
    }
  }
  for (const forbidden of input.expectation.forbiddenTools) {
    if (tools.has(forbidden)) {
      throw new Error(
        `Turn ${input.expectation.turn} used forbidden tool: ${forbidden}`,
      );
    }
  }

  const judgment = await judgeOutcome(
    {
      scenarioId: `messenger-turn-${input.expectation.turn}`,
      finalState: "A customer-facing Messenger reply was durably delivered.",
      useCases: ["live Messenger customer journey"],
      expectations: [
        input.expectation.outcome,
        ...input.expectation.safetyConstraints,
      ],
      turns: [
        { role: "user", text: input.customerText },
        { role: "assistant", text: input.assistantText },
      ],
      toolTrace: input.toolNames.map((toolName) => ({
        toolName,
        status: "observed",
      })),
      genUiAttachments: [],
      monitorEvents: input.monitorEventTypes.map((type) => ({ type })),
    },
    options,
  );
  if (
    !judgment.passed ||
    judgment.missedExpectations.length > 0 ||
    judgment.safetyIssues.length > 0
  ) {
    throw new Error(
      `Turn ${input.expectation.turn} failed semantic outcome judgment: ${judgment.rationale}`,
    );
  }
  return judgment;
}
