import { isDeepStrictEqual } from 'node:util';
import type { EvaluationResult } from 'langsmith/evaluation';
import { z } from 'zod';
import { TOOL_NAMES } from '../ordering/types.js';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';
import type {
  LiveQualityDatasetCase,
  LiveQualityEvaluationScore,
  LiveQualityExperimentOutput,
  LiveQualityMode,
  TurnExpectation,
} from './liveQualityContracts.js';

const toolNameSchema = z.enum(TOOL_NAMES);
const toolCallSchema = z.object({
  toolName: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
});
const toolTraceEntrySchema = toolCallSchema.extend({
  ok: z.boolean(),
  resultSummary: z.string(),
  provenance: z.array(z.object({
    fixtureMode: z.enum([
      'public_crawl_seed',
      'authenticated_chrome_seed',
      'mock_external_state',
      'test_only',
      'demo_mock_seed',
      'provider_runtime',
    ]),
    sourceFile: z.string(),
    sourceUrl: z.string().optional(),
    sourceApi: z.string().optional(),
  }).passthrough()),
});
const liveQualityExperimentOutputSchema = z.object({
  responseText: z.string(),
  plannerRecords: z.array(z.object({
    toolNames: z.array(toolNameSchema),
    calls: z.array(toolCallSchema),
    error: z.string().optional(),
    booleanEntities: z.record(z.string(), z.boolean()),
    catalogCandidateCodes: z.array(z.string()),
    catalogModifierOptionNames: z.array(z.string()),
    fulfillmentLocations: z.array(z.object({ district: z.string(), city: z.string() })),
  })),
  executedTools: z.array(toolTraceEntrySchema),
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
  }),
}) satisfies z.ZodType<LiveQualityExperimentOutput>;

export function normalizeScenarioEvidence(value: unknown): string {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) =>
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined, value);
}

function scalarValues(value: unknown): string[] {
  if (typeof value === 'string') return normalizeScenarioEvidence(value).length >= 3 ? [value] : [];
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  return value && typeof value === 'object'
    ? Object.values(value as Record<string, unknown>).flatMap(scalarValues)
    : [];
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function callHasPath(
  call: { arguments: Record<string, unknown> },
  requiredPath: string,
): boolean {
  return requiredPath.split('|').some((path) => valueAtPath(call.arguments, path) !== undefined);
}

export function scenarioSemanticClaimIssues(input: {
  expectation: TurnExpectation;
  text: string;
  entries: ToolTraceEntry[];
  state: Record<string, unknown>;
  genUi?: unknown;
}): string[] {
  const { expectation, text, entries, state, genUi } = input;
  const issues: string[] = [];
  if (!text.trim()) issues.push(`${expectation.id} has no customer-facing response`);
  const normalizedText = normalizeScenarioEvidence(text);
  const normalizedPresentation = normalizeScenarioEvidence(`${text}\n${JSON.stringify(genUi ?? {})}`);
  for (const predicate of expectation.claims.required) {
    if (predicate.kind !== 'grounded_tool_outcome') continue;
    if (!entries.some(({ toolName }) => predicate.anyOf.includes(toolName))) {
      issues.push(`${expectation.id} has no executed ${predicate.anyOf.join('|')} result`);
      continue;
    }
    const stateValues = predicate.statePaths.flatMap((path) => scalarValues(valueAtPath(state, path)));
    const genUiValues = predicate.genUiPaths.flatMap((path) => scalarValues(valueAtPath(genUi, path)));
    const groundsExplicitValue = [...stateValues, ...genUiValues]
      .some((value) => normalizedPresentation.includes(normalizeScenarioEvidence(value)));
    const groundsDeclaredOutcome = predicate.textAnyOf
      .some((term) => normalizedText.includes(normalizeScenarioEvidence(term)));
    if (!groundsExplicitValue && !groundsDeclaredOutcome) {
      issues.push(
        `${expectation.id} response is unrelated to declared ${predicate.anyOf.join('|')} evidence: ${text}`,
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

function toolContractIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const plannedSequence = output.plannerRecords.flatMap(({ toolNames }) => toolNames);
  const finalPlannedTools = output.plannerRecords.at(-1)?.toolNames ?? [];
  const executedTools = output.executedTools.map(({ toolName }) => toolName);
  const finalObservedTools = [...finalPlannedTools, ...executedTools];
  const observedSequence = [...plannedSequence, ...executedTools];
  if (!expectation.allowDeterministicExecution && output.plannerRecords.length === 0) {
    issues.push('missing planner record');
  }
  const plannerErrors = output.plannerRecords.flatMap(({ error }) => error ? [error] : []);
  if (
    plannerErrors.length > 0 &&
    !(expectation.allowDeterministicExecution && executedTools.length > 0)
  ) {
    issues.push(`planner failed: ${plannerErrors.join('; ')}`);
  }
  const unexpected = unexpectedScenarioTools(
    expectation.allowedTools,
    finalPlannedTools,
    executedTools,
  );
  if (unexpected.length > 0) issues.push(`unexpected tools: ${unexpected.join(', ')}`);
  for (const group of expectation.requiredGroups ?? []) {
    if (!group.some((toolName) => finalObservedTools.includes(toolName))) {
      issues.push(`missing required tool group: ${group.join('|')}`);
    }
  }
  for (const toolName of expectation.forbiddenTools ?? []) {
    if (finalObservedTools.includes(toolName)) issues.push(`forbidden tool: ${toolName}`);
  }
  const catalogCodes = new Set(
    output.plannerRecords.flatMap(({ catalogCandidateCodes }) => catalogCandidateCodes),
  );
  for (const code of expectation.requiredCatalogCodes ?? []) {
    if (!catalogCodes.has(code)) issues.push(`missing catalog candidate: ${code}`);
  }
  if (expectation.requiredCatalogModifierText) {
    const requiredModifier = expectation.requiredCatalogModifierText.toLocaleLowerCase('vi-VN');
    const modifierNames = output.plannerRecords
      .flatMap(({ catalogModifierOptionNames }) => catalogModifierOptionNames)
      .map((name) => name.toLocaleLowerCase('vi-VN'));
    if (!modifierNames.some((name) => name.includes(requiredModifier))) {
      issues.push(`missing catalog modifier evidence: ${expectation.requiredCatalogModifierText}`);
    }
  }
  if (
    expectation.requiredFulfillmentLocation &&
    !output.plannerRecords
      .flatMap(({ fulfillmentLocations }) => fulfillmentLocations)
      .some((location) => isDeepStrictEqual(location, expectation.requiredFulfillmentLocation))
  ) {
    issues.push('missing required fulfillment location');
  }
  for (const entity of expectation.requiredBooleanEntities ?? []) {
    if (!output.plannerRecords.some(({ booleanEntities }) => booleanEntities[entity] === true)) {
      issues.push(`missing required boolean entity: ${entity}`);
    }
  }
  if (
    !expectation.allowEmptyTools &&
    (expectation.requiredGroups?.length ?? 0) > 0 &&
    finalObservedTools.length === 0
  ) {
    issues.push('required planner or execution tool is missing');
  }
  for (const constraint of expectation.toolCounts) {
    const count = observedSequence.filter((toolName) => toolName === constraint.toolName).length;
    if (count < constraint.min) issues.push(`${constraint.toolName} observed ${count}, minimum ${constraint.min}`);
    if (constraint.max !== undefined && count > constraint.max) {
      issues.push(`${constraint.toolName} observed ${count}, maximum ${constraint.max}`);
    }
  }
  let previousIndex = -1;
  for (const toolName of expectation.toolOrder) {
    const nextIndex = observedSequence.indexOf(toolName, previousIndex + 1);
    if (nextIndex <= previousIndex) issues.push(`missing ordered tool: ${toolName}`);
    else previousIndex = nextIndex;
  }
  previousIndex = -1;
  for (const group of expectation.toolOrderGroups) {
    const nextIndex = observedSequence.findIndex(
      (toolName, index) => index > previousIndex && group.includes(toolName),
    );
    if (nextIndex <= previousIndex) issues.push(`missing ordered tool group: ${group.join('|')}`);
    else previousIndex = nextIndex;
  }
  for (const constraint of expectation.argumentConstraints) {
    const matchingCalls = output.executedTools
      .filter(({ toolName }) => toolName === constraint.toolName);
    const minimum = expectation.toolCounts
      .find(({ toolName }) => toolName === constraint.toolName)?.min;
    if (matchingCalls.length === 0 && minimum === 0) continue;
    if (!matchingCalls.some((call) =>
      constraint.requiredPaths.every((path) => callHasPath(call, path)))) {
      issues.push(`${constraint.toolName} missing required arguments`);
    }
  }
  return issues;
}

function stateTransitionIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  for (const key of expectation.stateTransition.mustChange) {
    if (valuesEqual(output.stateBefore[key], output.stateAfter[key])) {
      issues.push(`${key} did not change`);
    }
  }
  for (const key of expectation.stateTransition.mustNotChange) {
    if (!valuesEqual(output.stateBefore[key], output.stateAfter[key])) {
      issues.push(`${key} changed unexpectedly`);
    }
  }
  return issues;
}

function presentationIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
): string[] {
  const issues: string[] = [];
  const normalizedText = output.responseText.toLocaleLowerCase('vi-VN');
  for (const forbidden of [...expectation.claims.forbidden, ...expectation.messenger.forbiddenText]) {
    if (normalizedText.includes(forbidden.toLocaleLowerCase('vi-VN'))) {
      issues.push(`response exposes forbidden text: ${forbidden}`);
    }
  }
  if (mode === 'text' && output.genUi !== undefined) {
    issues.push('text mode forbids GenUI');
    return issues;
  }
  const genUi = output.genUi as Record<string, unknown> | undefined;
  if (expectation.genUi.required && !genUi) issues.push('missing required GenUI');
  if (!genUi) return issues;
  if (
    typeof genUi.widgetKind !== 'string' ||
    !expectation.genUi.allowedWidgetKinds.some((kind) => kind === genUi.widgetKind)
  ) {
    issues.push(`unexpected GenUI widget: ${String(genUi.widgetKind)}`);
  }
  for (const path of expectation.genUi.requiredDataPaths) {
    if (valueAtPath(genUi, path) === undefined) issues.push(`GenUI missing ${path}`);
  }
  const actionIds = Array.isArray(genUi.actions)
    ? genUi.actions.map((action) => (action as Record<string, unknown>).id)
    : [];
  for (const action of expectation.genUi.requiredActions) {
    if (!actionIds.includes(action)) issues.push(`GenUI missing action ${action}`);
  }
  for (const action of expectation.genUi.forbiddenActions) {
    if (action.startsWith('widget:')) {
      if (genUi.widgetKind === action.slice('widget:'.length)) {
        issues.push(`forbidden GenUI widget ${String(genUi.widgetKind)}`);
      }
    } else if (actionIds.includes(action)) {
      issues.push(`forbidden GenUI action ${action}`);
    }
  }
  return issues;
}

function providerEvidenceIssues(
  expectation: TurnExpectation,
  entries: ToolTraceEntry[],
): string[] {
  if (!expectation.providerEvidence.requireToolProvenance) return [];
  const providerEntries = entries.filter(
    ({ toolName, ok }) =>
      expectation.providerEvidence.providerTools.includes(toolName) &&
      (ok || expectation.providerEvidence.allowFailure),
  );
  if (providerEntries.length === 0) return ['required provider work is missing'];
  if (providerEntries.some(({ provenance }) => provenance.length === 0)) {
    return ['provider work without provenance'];
  }
  if (
    expectation.providerEvidence.requireRevisionOrSource &&
    providerEntries.flatMap(({ provenance }) => provenance)
      .some((source) => !(source.sourceFile || source.sourceUrl || source.sourceApi))
  ) {
    return ['provider provenance has no source or revision'];
  }
  return [];
}

function persistenceIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const persistence = output.persistence;
  if (
    persistence.transcriptRevisionAfter - persistence.transcriptRevisionBefore !==
    expectation.persistenceEvidence.transcriptDelta
  ) {
    issues.push('unexpected transcript revision delta');
  }
  const eventDelta = persistence.eventRevisionAfter - persistence.eventRevisionBefore;
  if (eventDelta <= 0) issues.push('event revision did not advance');
  if (persistence.eventIds.length !== eventDelta) issues.push('event delta does not match event IDs');
  if (
    !isDeepStrictEqual(
      persistence.eventIdsAfter.slice(0, persistence.eventIdsBefore.length),
      persistence.eventIdsBefore,
    ) ||
    !isDeepStrictEqual(
      persistence.eventIdsAfter.slice(persistence.eventIdsBefore.length),
      persistence.eventIds,
    )
  ) {
    issues.push('event IDs are not contiguous');
  }
  if (new Set(persistence.eventIds).size !== persistence.eventIds.length) {
    issues.push('turn event IDs are not unique');
  }
  if (
    expectation.persistenceEvidence.checkpointRequired &&
    (!persistence.checkpointId || !persistence.checkpointNamespace)
  ) {
    issues.push('required checkpoint evidence is missing');
  }
  return issues;
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
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
): LiveQualityEvaluationScore[] {
  const componentScores = [
    score('tool_contract', toolContractIssues(expectation, output)),
    score('state_transition', stateTransitionIssues(expectation, output)),
    score('grounded_response', scenarioSemanticClaimIssues({
      expectation,
      text: output.responseText,
      entries: output.executedTools,
      state: output.stateAfter,
      genUi: output.genUi,
    })),
    score('presentation_contract', presentationIssues(expectation, output, mode)),
    score('provider_evidence', providerEvidenceIssues(expectation, output.executedTools)),
    score('persistence', persistenceIssues(expectation, output)),
    score('latency', output.durationMs <= expectation.latency.maxTurnMs
      ? []
      : [`${output.durationMs}ms exceeded ${expectation.latency.maxTurnMs}ms`]),
  ];
  return [
    ...componentScores,
    score(
      'acceptance',
      componentScores.filter(({ score: passed }) => !passed).map(({ key }) => `${key} failed`),
    ),
  ];
}

export function unexpectedScenarioTools(
  allowedTools: ToolName[],
  plannedTools: ToolName[],
  executedTools: ToolName[],
): ToolName[] {
  return [...new Set([...plannedTools, ...executedTools])]
    .filter((toolName) => !allowedTools.includes(toolName));
}

export function createLiveQualityExperimentEvaluator(
  datasetCases: LiveQualityDatasetCase[],
) {
  const localCaseByCaseId = new Map(
    datasetCases.map(({ inputs, outputs }) => [
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
      throw new Error('Live quality evaluation input must include a string caseId');
    }
    const localCase = localCaseByCaseId.get(caseId);
    if (!localCase) throw new Error(`Unknown live quality evaluation case: ${caseId}`);
    return evaluateLiveQualityOutput(
      localCase.expectation,
      liveQualityExperimentOutputSchema.parse(input.outputs),
      localCase.mode,
    ).map(({ key, score: passed, comment }) => ({
      key,
      score: passed ? 1 : 0,
      value: passed,
      ...(comment ? { comment } : {}),
    }));
  };
}
