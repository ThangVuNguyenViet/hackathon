import { isDeepStrictEqual } from 'node:util';
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
  LiveQualityV3ExperimentOutput,
  LiveQualityV3DatasetCase,
} from './liveQualityContracts.js';
import {
  SCENARIO_MUTABLE_STATE_KEYS,
} from './liveQualityContracts.js';
import {
  parseSemanticResponseJudgment,
  semanticResponseRequirementIds,
  semanticResponseIssues,
  type SemanticResponseJudge,
} from './semanticResponseJudge.js';
import {
  liveQualityDatasetCaseSchema,
  liveQualityV3TurnExpectationSchema,
} from './liveQualitySchemas.js';
import {
  callArgumentsMatch,
  valueAtPath,
  valuesEqual,
} from './liveQualityArgumentConstraints.js';
import {
  presentationIssues,
} from './liveQualityPresentationContracts.js';

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
    fulfillmentLocations: z.array(z.object({
      district: z.string(),
      city: z.string(),
    })),
  })).optional(),
  executedTools: z.array(toolTraceEntrySchema),
  observations: z.array(z.object({
    kind: z.literal('payment_status_refreshed'),
    toolName: z.literal('checkPaymentStatus'),
    orderId: z.string().min(1),
    status: z.enum(['pending', 'paid', 'failed']),
  }).strict()).optional(),
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

const liveQualityV3ExperimentOutputSchema =
  liveQualityExperimentOutputSchema
    .omit({ plannerRecords: true })
    .strict() satisfies z.ZodType<LiveQualityV3ExperimentOutput>;

interface VerifiedModifierBinding {
  itemCode: string;
  groupId: string;
  modifierId: string;
}

const legacyTypedModifierBindingsByExpectation = {
  '01-dat-mon-ro-rang-giao-hang.json#1': [{
    itemCode: '20702',
    groupId: '60254',
    modifierId: '70012',
  }],
  '07-ca-nhan-hoa-va-loyalty.json#7': [{
    itemCode: '20698',
    groupId: '3',
    modifierId: 'MOCK-PEACH-TEA-MODIFIER',
  }],
} as const satisfies Readonly<
  Record<string, readonly VerifiedModifierBinding[]>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonNullPath(value: unknown, path: string): boolean {
  const found = valueAtPath(value, path);
  return found !== undefined && found !== null;
}

function completeMenuCollectionIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  if (!expectation.genUi.requireCompleteMenuCollection) return [];
  const collection = valueAtPath(
    output.stateAfter,
    'activeMenuCollection.result',
  );
  if (!isRecord(collection)) {
    return ['complete menu collection state is missing'];
  }
  const items = collection.items;
  const total = collection.total;
  const returned = collection.returned;
  const complete = collection.complete;
  const scope = collection.scope;
  const categoryIds = Array.isArray(items)
    ? new Set(items.flatMap((item) =>
        isRecord(item) &&
        typeof item.categoryId === 'string' &&
        item.categoryId.length > 0
          ? [item.categoryId]
          : []))
    : new Set<string>();
  const issues: string[] = [];
  if (!isRecord(scope) || scope.scope !== 'all') {
    issues.push('menu collection scope is not all');
  }
  if (complete !== true) issues.push('menu collection is incomplete');
  if (
    !Array.isArray(items) ||
    typeof total !== 'number' ||
    typeof returned !== 'number' ||
    total !== returned ||
    returned !== items.length
  ) {
    issues.push('menu collection does not return every verified item');
  }
  if (categoryIds.size < 2) {
    issues.push('menu collection does not contain multiple categories');
  }
  return issues;
}

export function scenarioSemanticClaimIssues(input: {
  expectation: LiveQualityEvaluationExpectation;
  text: string;
  entries: ToolTraceEntry[];
  state: Record<string, unknown>;
  genUi?: unknown;
}): string[] {
  const { expectation, text, entries } = input;
  const issues: string[] = [];
  if (!text.trim()) issues.push(`${expectation.id} has no customer-facing response`);
  for (const predicate of expectation.claims.required) {
    if (predicate.kind !== 'grounded_tool_outcome') continue;
    const matchingEntries = entries.filter(({ toolName }) =>
      predicate.anyOf.includes(toolName));
    if (matchingEntries.length === 0) {
      issues.push(`${expectation.id} has no executed ${predicate.anyOf.join('|')} result`);
      continue;
    }
    const outcomeMatches = (entry: ToolTraceEntry) =>
      (
        predicate.expectedOk === 'either' ||
        entry.ok === predicate.expectedOk
      ) &&
      (
        predicate.resultSummaryOneOf.length === 0 ||
        predicate.resultSummaryOneOf.includes(entry.resultSummary)
      );
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
    if (
      predicate.statePaths.length > 0 &&
      !predicate.statePaths.some((path) =>
        hasNonNullPath(input.state, path))
    ) {
      issues.push(
        `${expectation.id} ${predicate.requirementId} has no verified state evidence`,
      );
    }
    if (
      input.genUi !== undefined &&
      predicate.genUiPaths.length > 0 &&
      !predicate.genUiPaths.some((path) =>
        hasNonNullPath(input.genUi, path))
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

function nestedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nestedRecords);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    record,
    ...Object.values(record).flatMap(nestedRecords),
  ];
}

function catalogEvidenceRecords(
  output: LiveQualityExperimentOutput,
): Record<string, unknown>[] {
  return nestedRecords({
    menuSearchResults: output.stateAfter.menuSearchResults,
    activeMenuCollection: output.stateAfter.activeMenuCollection,
    menuItemDetail: output.stateAfter.menuItemDetail,
    menuModifierOptions: output.stateAfter.menuModifierOptions,
  });
}

function catalogIdentifiers(
  output: LiveQualityExperimentOutput,
  keys: string[],
): Set<string> {
  const identifierKeys = new Set(keys);
  return new Set(
    catalogEvidenceRecords(output).flatMap((record) =>
      Object.entries(record).flatMap(([key, value]) =>
        identifierKeys.has(key) && typeof value === 'string'
          ? [value]
          : [])),
  );
}

function argumentIdentifiers(
  value: unknown,
  keys: string[],
): string[] {
  const identifierKeys = new Set(keys);
  return nestedRecords(value).flatMap((record) =>
    Object.entries(record).flatMap(([key, candidate]) =>
      identifierKeys.has(key) && typeof candidate === 'string'
        ? [candidate]
        : []));
}

function updateCartHasModifierBinding(
  argumentsValue: Record<string, unknown>,
  binding: VerifiedModifierBinding,
): boolean {
  if (!Array.isArray(argumentsValue.changes)) return false;
  return argumentsValue.changes.some((change) => {
    if (
      !isRecord(change) ||
      change.itemCode !== binding.itemCode ||
      !Array.isArray(change.modifiers)
    ) {
      return false;
    }
    return change.modifiers.some((modifier) =>
      isRecord(modifier) &&
      modifier.groupId === binding.groupId &&
      modifier.modifierId === binding.modifierId);
  });
}

function verifiedFulfillmentLocations(
  output: LiveQualityExperimentOutput,
): Array<{ district: string; city: string }> {
  return nestedRecords(output.stateAfter).flatMap((record) =>
    typeof record.district === 'string' && typeof record.city === 'string'
      ? [{ district: record.district, city: record.city }]
      : []);
}

function toolContractIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const executedTools = output.executedTools.map(({ toolName }) => toolName);
  const finalObservedTools = executedTools;
  const observedSequence = executedTools;
  const unexpected = unexpectedScenarioTools(
    expectation.allowedTools,
    [],
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
  const catalogCodes = catalogIdentifiers(
    output,
    ['code', 'itemCode', 'itemId'],
  );
  const catalogRecords = catalogEvidenceRecords(output);
  const catalogCategoryIds = catalogIdentifiers(output, ['categoryId']);
  const catalogModifierIds = catalogIdentifiers(output, ['modifierId']);
  const legacyRequiredModifierBindings =
    legacyTypedModifierBindingsByExpectation[
      expectation.id as keyof typeof legacyTypedModifierBindingsByExpectation
    ] ?? [];
  const requiredModifierIds = new Set([
    ...(expectation.requiredCatalogModifierIds ?? []),
    ...legacyRequiredModifierBindings.map(({ modifierId }) => modifierId),
  ]);
  for (const code of expectation.requiredCatalogCodes ?? []) {
    if (!catalogCodes.has(code)) issues.push(`missing catalog candidate: ${code}`);
  }
  for (const required of expectation.requiredCatalogItemEvidence ?? []) {
    const matches = catalogRecords.some((record) => {
      const recordCodes = [
        record.code,
        record.itemCode,
        record.itemId,
      ];
      return (
        recordCodes.includes(required.code) &&
        (
          required.available === undefined ||
          record.available === required.available
        )
      );
    });
    if (!matches) {
      issues.push(
        `missing catalog item evidence: ${required.code}` +
        (
          required.available === undefined
            ? ''
            : ` available=${String(required.available)}`
        ),
      );
    }
  }
  for (const categoryId of expectation.requiredCatalogCategoryIds ?? []) {
    if (!catalogCategoryIds.has(categoryId)) {
      issues.push(`missing catalog category evidence: ${categoryId}`);
    }
  }
  for (const modifierId of requiredModifierIds) {
    if (!catalogModifierIds.has(modifierId)) {
      issues.push(`missing catalog modifier evidence: ${modifierId}`);
    }
  }
  if (legacyRequiredModifierBindings.length > 0) {
    const updateCartCalls = output.executedTools
      .filter(({ toolName }) => toolName === 'updateCart');
    for (const binding of legacyRequiredModifierBindings) {
      if (!updateCartCalls.some(({ arguments: argumentsValue }) =>
        updateCartHasModifierBinding(argumentsValue, binding))) {
        issues.push(
          'updateCart is missing required verified modifier binding: ' +
          `${binding.itemCode}/${binding.groupId}/${binding.modifierId}`,
        );
      }
    }
  }
  for (const toolName of expectation.verifiedCatalogArgumentTools ?? []) {
    const calls = output.executedTools.filter((entry) =>
      entry.toolName === toolName);
    for (const call of calls) {
      const unverifiedItemIds = argumentIdentifiers(
        call.arguments,
        ['code', 'itemCode', 'itemId'],
      ).filter((identifier) => !catalogCodes.has(identifier));
      const unverifiedModifierIds = argumentIdentifiers(
        call.arguments,
        ['modifierId'],
      ).filter((identifier) => !catalogModifierIds.has(identifier));
      if (unverifiedItemIds.length > 0 || unverifiedModifierIds.length > 0) {
        issues.push(
          `${toolName} references unverified catalog identifiers: ` +
          [...unverifiedItemIds, ...unverifiedModifierIds].join(', '),
        );
      }
    }
  }
  if (
    expectation.requiredFulfillmentLocation &&
    !verifiedFulfillmentLocations(output)
      .some((location) => isDeepStrictEqual(location, expectation.requiredFulfillmentLocation))
  ) {
    issues.push('missing required fulfillment location');
  }
  for (const entity of expectation.requiredBooleanEntities ?? []) {
    if (!nestedRecords(output.stateAfter).some((record) => record[entity] === true)) {
      issues.push(`missing required boolean entity: ${entity}`);
    }
  }
  if (
    !expectation.allowEmptyTools &&
    (expectation.requiredGroups?.length ?? 0) > 0 &&
    finalObservedTools.length === 0
  ) {
    issues.push('required executed tool is missing');
  }
  for (const constraint of expectation.toolCounts) {
    const count = observedSequence.filter((toolName) => toolName === constraint.toolName).length;
    if (count < constraint.min) issues.push(`${constraint.toolName} observed ${count}, minimum ${constraint.min}`);
    if (constraint.max !== undefined && count > constraint.max) {
      issues.push(`${constraint.toolName} observed ${count}, maximum ${constraint.max}`);
    }
  }
  if ('toolOrder' in expectation) {
    let previousIndex = -1;
    for (const toolName of expectation.toolOrder) {
      const nextIndex = observedSequence.indexOf(
        toolName,
        previousIndex + 1,
      );
      if (nextIndex <= previousIndex) {
        issues.push(`missing ordered tool: ${toolName}`);
      } else {
        previousIndex = nextIndex;
      }
    }
    previousIndex = -1;
    for (const group of expectation.toolOrderGroups) {
      const nextIndex = observedSequence.findIndex(
        (toolName, index) =>
          index > previousIndex && group.includes(toolName),
      );
      if (nextIndex <= previousIndex) {
        issues.push(`missing ordered tool group: ${group.join('|')}`);
      } else {
        previousIndex = nextIndex;
      }
    }
  }
  for (const constraint of expectation.argumentConstraints) {
    const matchingCalls = output.executedTools
      .filter(({ toolName }) => toolName === constraint.toolName);
    const minimum = expectation.toolCounts
      .find(({ toolName }) => toolName === constraint.toolName)?.min;
    if (matchingCalls.length === 0 && minimum === 0) continue;
    if (matchingCalls.some((call) =>
      !callArgumentsMatch(
        constraint.constraints,
        call,
        output,
        constraint.argumentEncoding,
      ))) {
      issues.push(
        `${constraint.toolName} has an execution whose arguments did not ` +
        'satisfy the exact contract',
      );
    }
  }
  return issues;
}

function stateTransitionIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const mayChange = new Set(expectation.stateTransition.mayChange);
  for (const key of expectation.stateTransition.mustChange) {
    if (!mayChange.has(key)) {
      issues.push(`${key} is required to change but is absent from mayChange`);
    }
  }
  for (const key of SCENARIO_MUTABLE_STATE_KEYS) {
    if (
      !mayChange.has(key) &&
      !valuesEqual(output.stateBefore[key], output.stateAfter[key])
    ) {
      issues.push(`${key} changed outside the mayChange partition`);
    }
  }
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
  for (const constraint of expectation.stateTransition.pathConstraints) {
    const before = valueAtPath(output.stateBefore, constraint.path);
    const after = valueAtPath(output.stateAfter, constraint.path);
    const failed =
      (constraint.operator === 'changed' && valuesEqual(before, after)) ||
      (constraint.operator === 'unchanged' && !valuesEqual(before, after)) ||
      (
        constraint.operator === 'equals' &&
        !valuesEqual(after, constraint.value)
      ) ||
      (
        constraint.operator === 'present' &&
        (after === undefined || after === null)
      ) ||
      (
        constraint.operator === 'absent' &&
        after !== undefined &&
        after !== null
      );
    if (failed) {
      issues.push(
        `${constraint.path} failed ${constraint.operator} state constraint`,
      );
    }
  }
  issues.push(...completeMenuCollectionIssues(expectation, output));
  return issues;
}

function providerEvidenceIssues(
  expectation: LiveQualityEvaluationExpectation,
  entries: ToolTraceEntry[],
): string[] {
  if (!expectation.providerEvidence.requireToolProvenance) return [];
  const providerEntries = entries.filter(
    ({ toolName, ok }) =>
      expectation.providerEvidence.providerTools.includes(toolName) &&
      (
        ok ||
        expectation.providerEvidence.acceptedFailedTools.includes(toolName)
      ),
  );
  const providerGroups = (expectation.requiredGroups ?? [])
    .map((group) => group.filter((toolName) =>
      expectation.providerEvidence.providerTools.includes(toolName)))
    .filter((group) => group.length > 0);
  const requiredGroups = providerGroups.length > 0
    ? providerGroups
    : [expectation.providerEvidence.providerTools];
  const missingGroups = requiredGroups.filter((group) =>
    !providerEntries.some(({ toolName }) => group.includes(toolName)));
  if (missingGroups.length > 0) {
    return missingGroups.map((group) =>
      `required provider work is missing: ${group.join('|')}`);
  }
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
  expectation: LiveQualityEvaluationExpectation,
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
  if (expectation.persistenceEvidence.checkpointRequired) {
    if (!persistence.checkpointId?.trim()) {
      issues.push('checkpoint ID is missing');
    }
    if (typeof persistence.checkpointNamespace !== 'string') {
      issues.push('checkpoint namespace is missing');
    }
    if (!persistence.checkpointThreadId?.trim()) {
      issues.push('checkpoint thread ID is missing');
    }
  }
  if (
    expectation.persistenceEvidence.checkpointReadable &&
    persistence.checkpointVerified !== true
  ) {
    issues.push('checkpoint was not verified as readable');
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
  expectation: LiveQualityEvaluationExpectation,
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

export function evaluateLiveQualityV3Output(
  expectation: unknown,
  output: unknown,
  mode: LiveQualityMode,
): LiveQualityEvaluationScore[] {
  return evaluateLiveQualityOutput(
    liveQualityV3TurnExpectationSchema.parse(expectation),
    liveQualityV3ExperimentOutputSchema.parse(output),
    mode,
  );
}

export function unexpectedScenarioTools(
  allowedTools: ToolName[],
  plannedTools: ToolName[],
  executedTools: ToolName[],
): ToolName[] {
  return [...new Set([...plannedTools, ...executedTools])]
    .filter((toolName) => !allowedTools.includes(toolName));
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
}): Promise<LiveQualityEvaluationScore[]> {
  const scores = evaluateLiveQualityOutput(
    input.expectation,
    input.output,
    input.mode,
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
    acceptance.comment = [
      acceptance.comment,
      'semantic_response failed',
    ].filter(Boolean).join('; ');
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
      throw new Error('Live quality evaluation input must include a string caseId');
    }
    const localCase = localCaseByCaseId.get(caseId);
    if (!localCase) throw new Error(`Unknown live quality evaluation case: ${caseId}`);
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
    if (
      testCase.inputs.mode !== 'text' &&
      testCase.inputs.mode !== 'genui'
    ) {
      throw new Error(
        `Live quality v3 dataset case ${index} has an invalid mode`,
      );
    }
    if (
      testCase.inputs.caseId !==
      `${expectation.id}:${testCase.inputs.mode}`
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
    });
    return asEvaluationResults(scores);
  };
}
