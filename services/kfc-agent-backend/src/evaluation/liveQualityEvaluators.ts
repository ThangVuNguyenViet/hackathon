import type { EvaluationResult } from 'langsmith/evaluation';
import { z } from 'zod';
import { TOOL_NAMES } from '../ordering/types.js';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';
import type {
  LiveQualityDatasetCase,
  LiveQualityEvaluationExpectation,
  LiveQualityEvaluationScore,
  LiveQualityExperimentOutput,
  LiveQualityMode,
  LiveQualityV3DatasetCase,
  LiveQualityV3ExperimentOutput,
} from './liveQualityContracts.js';
import { valueAtPath } from './liveQualityArgumentConstraints.js';
import { presentationIssues } from './liveQualityPresentationContracts.js';
import {
  liveQualityDatasetCaseSchema,
  liveQualityV3TurnExpectationSchema,
} from './liveQualitySchemas.js';
import {
  durableCatalogEvidenceSatisfiesGroup,
  persistenceIssues,
  providerEvidenceIssues,
  stateTransitionIssues,
  toolContractIssues,
} from './liveQualityStructuralIssues.js';
import {
  liveQualityToolTraceEntrySchema,
  liveQualityV3ToolTraceEntrySchema,
} from './liveQualityToolTrace.js';
import {
  parseSemanticResponseJudgment,
  semanticResponseIssues,
  semanticResponseRequirementIds,
  verifiedSemanticToolOutcomeCode,
  type SemanticResponseJudge,
} from './semanticResponseJudge.js';

const toolNameSchema = z.enum(TOOL_NAMES);
const toolCallSchema = z.object({
  toolName: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});
const liveQualityExperimentOutputSchema = z.object({
  responseText: z.string(),
  plannerRecords: z
    .array(
      z.object({
        toolNames: z.array(toolNameSchema),
        calls: z.array(toolCallSchema),
        error: z.string().optional(),
        booleanEntities: z.record(z.string(), z.boolean()),
        catalogCandidateCodes: z.array(z.string()),
        catalogModifierOptionNames: z.array(z.string()),
        fulfillmentLocations: z.array(
          z.object({
            district: z.string(),
            city: z.string(),
          }),
        ),
      }),
    )
    .optional(),
  executedTools: z.array(liveQualityToolTraceEntrySchema),
  observations: z
    .array(
      z
        .object({
          kind: z.literal('payment_status_refreshed'),
          toolName: z.literal('checkPaymentStatus'),
          privateArgumentsDigest: z.string().regex(/^[0-9a-f]{64}$/u),
          status: z.enum(['pending', 'paid', 'failed']),
        })
        .strict(),
    )
    .optional(),
  stateBefore: z.record(z.string(), z.unknown()),
  stateAfter: z.record(z.string(), z.unknown()),
  genUi: z.unknown().optional(),
  durationMs: z.number().nonnegative(),
  persistence: z.object({
    transcriptRevisionBefore: z.number().int().nonnegative(),
    transcriptRevisionAfter: z.number().int().nonnegative(),
    eventRevisionBefore: z.number().int().nonnegative(),
    eventRevisionAfter: z.number().int().nonnegative(),
    eventIdsBefore: z.array(z.string()),
    eventIds: z.array(z.string()),
    eventIdsAfter: z.array(z.string()),
    checkpointId: z.string().optional(),
    checkpointNamespace: z.string().optional(),
    checkpointThreadId: z.string().optional(),
    checkpointVerified: z.boolean().optional(),
  }),
}) satisfies z.ZodType<LiveQualityExperimentOutput>;

const liveQualityV3ExperimentOutputSchema = liveQualityExperimentOutputSchema
  .omit({ plannerRecords: true })
  .extend({
    executedTools: z.array(liveQualityV3ToolTraceEntrySchema),
  })
  .strict() satisfies z.ZodType<LiveQualityV3ExperimentOutput>;

const v3StructuralOutcomeEvidence = Symbol('v3StructuralOutcomeEvidence');

function hasNonNullPath(value: unknown, path: string): boolean {
  const found = valueAtPath(value, path);
  return found !== undefined && found !== null;
}

export function scenarioSemanticClaimIssues(
  input: {
    expectation: LiveQualityEvaluationExpectation;
    text: string;
    entries: ToolTraceEntry[];
    state: Record<string, unknown>;
    genUi?: unknown;
  },
  outcomeEvidencePolicy?: typeof v3StructuralOutcomeEvidence,
): string[] {
  const { expectation, text, entries } = input;
  const issues: string[] = [];
  if (!text.trim()) {
    issues.push(`${expectation.id} has no customer-facing response`);
  }
  for (const predicate of expectation.claims.required) {
    if (predicate.kind !== 'grounded_tool_outcome') continue;
    const matchingEntries = entries.filter(({ toolName }) =>
      predicate.anyOf.includes(toolName),
    );
    const hasDurableCatalogOutcome =
      matchingEntries.length === 0 &&
      predicate.expectedOk !== false &&
      predicate.resultSummaryOneOf.length === 0 &&
      durableCatalogEvidenceSatisfiesGroup(
        expectation,
        input.state,
        predicate.anyOf,
      );
    if (matchingEntries.length === 0 && !hasDurableCatalogOutcome) {
      issues.push(
        `${expectation.id} has no executed ${predicate.anyOf.join('|')} result`,
      );
      continue;
    }
    if (!hasDurableCatalogOutcome) {
      const outcomeMatches = (entry: ToolTraceEntry) => {
        const verifiedOutcome =
          outcomeEvidencePolicy === v3StructuralOutcomeEvidence
            ? verifiedSemanticToolOutcomeCode(entry)
            : undefined;
        return (
          (predicate.expectedOk === 'either' ||
            entry.ok === predicate.expectedOk) &&
          (predicate.resultSummaryOneOf.length === 0 ||
            predicate.resultSummaryOneOf.includes(entry.resultSummary) ||
            (verifiedOutcome !== undefined &&
              predicate.resultSummaryOneOf.includes(verifiedOutcome)))
        );
      };
      const outcomeEntries = matchingEntries.filter(outcomeMatches);
      if (outcomeEntries.length === 0) {
        issues.push(
          `${expectation.id} ${predicate.requirementId} has the wrong ` +
            `${predicate.anyOf.join('|')} outcome`,
        );
        continue;
      }
      if (matchingEntries.some((entry) => !outcomeMatches(entry))) {
        issues.push(
          `${expectation.id} ${predicate.requirementId} has contradictory ` +
            `${predicate.anyOf.join('|')} outcomes`,
        );
        continue;
      }
    }
    if (
      predicate.statePaths.length > 0 &&
      !predicate.statePaths.some((path) => hasNonNullPath(input.state, path))
    ) {
      issues.push(
        `${expectation.id} ${predicate.requirementId} has no verified state evidence`,
      );
    }
    if (
      input.genUi !== undefined &&
      predicate.genUiPaths.length > 0 &&
      !predicate.genUiPaths.some((path) => hasNonNullPath(input.genUi, path))
    ) {
      issues.push(
        `${expectation.id} ${predicate.requirementId} has no GenUI evidence`,
      );
    }
  }
  return issues;
}

export function assertScenarioSemanticClaims(
  input: Parameters<typeof scenarioSemanticClaimIssues>[0],
): void {
  const [issue] = scenarioSemanticClaimIssues(input);
  if (issue) throw new Error(issue);
}

function score(
  key: LiveQualityEvaluationScore['key'],
  issues: string[],
): LiveQualityEvaluationScore {
  return {
    key,
    score: issues.length === 0,
    ...(issues.length > 0 ? { comment: issues.join('; ') } : {}),
  };
}

export function evaluateLiveQualityOutput(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
  outcomeEvidencePolicy?: typeof v3StructuralOutcomeEvidence,
): LiveQualityEvaluationScore[] {
  const componentScores = [
    score('tool_contract', toolContractIssues(expectation, output)),
    score('state_transition', stateTransitionIssues(expectation, output)),
    score(
      'grounded_response',
      scenarioSemanticClaimIssues(
        {
          expectation,
          text: output.responseText,
          entries: output.executedTools,
          state: output.stateAfter,
          genUi: output.genUi,
        },
        outcomeEvidencePolicy,
      ),
    ),
    score(
      'presentation_contract',
      presentationIssues(expectation, output, mode),
    ),
    score('provider_evidence', providerEvidenceIssues(expectation, output)),
    score('persistence', persistenceIssues(expectation, output)),
    score(
      'latency',
      output.durationMs <= expectation.latency.maxTurnMs
        ? []
        : [
            `${output.durationMs}ms exceeded ${expectation.latency.maxTurnMs}ms`,
          ],
    ),
  ];
  return [
    ...componentScores,
    score(
      'acceptance',
      componentScores
        .filter(({ score: passed }) => !passed)
        .map(({ key }) => `${key} failed`),
    ),
  ];
}

export function evaluateLiveQualityV3Output(
  expectation: unknown,
  output: unknown,
  mode: LiveQualityMode,
): LiveQualityEvaluationScore[] {
  return evaluateLiveQualityOutput(
    liveQualityV3TurnExpectationSchema.parse(expectation),
    liveQualityV3ExperimentOutputSchema.parse(output),
    mode,
    v3StructuralOutcomeEvidence,
  );
}

export function unexpectedScenarioTools(
  allowedTools: ToolName[],
  plannedTools: ToolName[],
  executedTools: ToolName[],
): ToolName[] {
  return [...new Set([...plannedTools, ...executedTools])].filter(
    (toolName) => !allowedTools.includes(toolName),
  );
}

export function requiresSemanticResponseJudge(
  expectation: LiveQualityEvaluationExpectation,
): boolean {
  return semanticResponseRequirementIds(expectation).length > 0;
}

async function evaluateWithSemanticJudge(input: {
  expectation: LiveQualityEvaluationExpectation;
  output: LiveQualityExperimentOutput | LiveQualityV3ExperimentOutput;
  mode: LiveQualityMode;
  semanticJudge?: SemanticResponseJudge;
  outcomeEvidencePolicy?: typeof v3StructuralOutcomeEvidence;
}): Promise<LiveQualityEvaluationScore[]> {
  const scores = evaluateLiveQualityOutput(
    input.expectation,
    input.output,
    input.mode,
    input.outcomeEvidencePolicy,
  );
  if (!requiresSemanticResponseJudge(input.expectation)) return scores;
  if (!input.semanticJudge) {
    throw new Error(
      'A semantic response judge is required for this live quality case',
    );
  }
  const judgment = parseSemanticResponseJudgment(
    await input.semanticJudge.judge({
      expectation: input.expectation,
      responseText: input.output.responseText,
      genUi: input.output.genUi,
      entries: input.output.executedTools,
      stateBefore: input.output.stateBefore,
      stateAfter: input.output.stateAfter,
    }),
    semanticResponseRequirementIds(input.expectation),
  );
  const issues = semanticResponseIssues(judgment);
  scores.splice(scores.length - 1, 0, score('semantic_response', issues));
  const acceptance = scores.at(-1);
  if (!acceptance) {
    throw new Error('live quality acceptance score is missing');
  }
  if (issues.length > 0) {
    acceptance.score = false;
    acceptance.comment = [acceptance.comment, 'semantic_response failed']
      .filter(Boolean)
      .join('; ');
  }
  return scores;
}

function asEvaluationResults(
  scores: LiveQualityEvaluationScore[],
): EvaluationResult[] {
  return scores.map(({ key, score: passed, comment }) => ({
    key,
    score: passed ? 1 : 0,
    value: passed,
    ...(comment ? { comment } : {}),
  }));
}

export function createLiveQualityExperimentEvaluator(
  datasetCases: LiveQualityDatasetCase[],
  options: { semanticJudge?: SemanticResponseJudge } = {},
) {
  const parsedCases = datasetCases.map((testCase, index) => {
    const parsed = liveQualityDatasetCaseSchema.parse(testCase);
    if (
      parsed.inputs.caseId !==
      `${parsed.outputs.expectation.id}:${parsed.inputs.mode}`
    ) {
      throw new Error(
        `Live quality dataset case ${index} is not bound to its expectation`,
      );
    }
    return parsed;
  });
  const localCaseByCaseId = new Map(
    parsedCases.map(({ inputs, outputs }) => [
      inputs.caseId,
      { expectation: outputs.expectation, mode: inputs.mode },
    ]),
  );
  return async (input: {
    inputs: { caseId?: unknown };
    outputs: Record<string, unknown>;
  }): Promise<EvaluationResult[]> => {
    const caseId = input.inputs.caseId;
    if (typeof caseId !== 'string') {
      throw new Error(
        'Live quality evaluation input must include a string caseId',
      );
    }
    const localCase = localCaseByCaseId.get(caseId);
    if (!localCase) {
      throw new Error(`Unknown live quality evaluation case: ${caseId}`);
    }
    const output = liveQualityExperimentOutputSchema.parse(input.outputs);
    const scores = await evaluateWithSemanticJudge({
      expectation: localCase.expectation,
      output,
      mode: localCase.mode,
      semanticJudge: options.semanticJudge,
    });
    return asEvaluationResults(scores);
  };
}

export function createLiveQualityV3ExperimentEvaluator(
  datasetCases: readonly LiveQualityV3DatasetCase[],
  options: { semanticJudge?: SemanticResponseJudge } = {},
) {
  const parsedCases = datasetCases.map((testCase, index) => {
    const expectation = liveQualityV3TurnExpectationSchema.parse(
      testCase.outputs.expectation,
    );
    if (testCase.inputs.mode !== 'text' && testCase.inputs.mode !== 'genui') {
      throw new Error(
        `Live quality v3 dataset case ${index} has an invalid mode`,
      );
    }
    if (
      testCase.inputs.caseId !== `${expectation.id}:${testCase.inputs.mode}`
    ) {
      throw new Error(
        `Live quality v3 dataset case ${index} is not bound to its expectation`,
      );
    }
    return {
      caseId: testCase.inputs.caseId,
      expectation,
      mode: testCase.inputs.mode,
    };
  });
  const localCaseByCaseId = new Map(
    parsedCases.map((testCase) => [testCase.caseId, testCase]),
  );
  return async (input: {
    inputs: { caseId?: unknown };
    outputs: Record<string, unknown>;
  }): Promise<EvaluationResult[]> => {
    const caseId = input.inputs.caseId;
    if (typeof caseId !== 'string') {
      throw new Error(
        'Live quality v3 evaluation input must include a string caseId',
      );
    }
    const localCase = localCaseByCaseId.get(caseId);
    if (!localCase) {
      throw new Error(`Unknown live quality v3 evaluation case: ${caseId}`);
    }
    const output = liveQualityV3ExperimentOutputSchema.parse(input.outputs);
    const scores = await evaluateWithSemanticJudge({
      expectation: localCase.expectation,
      output,
      mode: localCase.mode,
      semanticJudge: options.semanticJudge,
      outcomeEvidencePolicy: v3StructuralOutcomeEvidence,
    });
    return asEvaluationResults(scores);
  };
}
