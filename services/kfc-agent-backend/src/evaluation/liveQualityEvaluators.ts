import { isDeepStrictEqual } from 'node:util';
import type { EvaluationResult } from 'langsmith/evaluation';
import { z } from 'zod';
import type {
  LiveQualityDatasetCase,
  LiveQualityEvaluationScore,
  LiveQualityExperimentOutput,
  LiveQualityMode,
  OutcomeFact,
  TurnExpectation,
} from './liveQualityContracts.js';

const effectSchema = z.enum([
  'cart_mutated',
  'fulfillment_changed',
  'order_created',
  'payment_changed',
  'handoff_created',
  'approval_requested',
  'voucher_acquired',
  'reward_redeemed',
  'private_contact_disclosed',
]);
const collectionSchema = z.object({
  scope: z.enum(['all', 'filtered']),
  itemIds: z.array(z.string().min(1)).refine((values) => new Set(values).size === values.length),
  categories: z.array(z.string().min(1)).refine((values) => new Set(values).size === values.length),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  complete: z.boolean(),
  categoryTabs: z.array(z.string().min(1))
    .refine((values) => new Set(values).size === values.length)
    .optional(),
  selectionLimit: z.number().int().positive().optional(),
}).strict().superRefine((collection, context) => {
  if (collection.returned !== collection.itemIds.length) {
    context.addIssue({ code: 'custom', message: 'returned must equal itemIds length' });
  }
  if (collection.returned > collection.total) {
    context.addIssue({ code: 'custom', message: 'returned cannot exceed total' });
  }
  if (collection.complete && collection.returned !== collection.total) {
    context.addIssue({ code: 'custom', message: 'complete collection must return total items' });
  }
});
export const liveQualityExperimentOutputSchema = z.object({
  responseText: z.string(),
  effects: z.array(z.object({
    kind: effectSchema,
    ok: z.boolean(),
    receiptId: z.string().min(1).optional(),
  }).strict()),
  evidence: z.array(z.object({
    kind: z.string().min(1),
    ref: z.string().min(1),
    official: z.boolean(),
    sourceFile: z.string().min(1).optional(),
    sourceUrl: z.string().min(1).optional(),
    sourceApi: z.string().min(1).optional(),
  }).strict()),
  stateBefore: z.record(z.string(), z.unknown()),
  stateAfter: z.record(z.string(), z.unknown()),
  presentationFacts: z.record(z.string(), z.unknown()),
  verifiedCollections: z.record(z.string(), collectionSchema),
  presentedCollections: z.record(z.string(), collectionSchema),
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
    checkpointId: z.string().min(1).optional(),
    checkpointNamespace: z.string().min(1).optional(),
  }).strict(),
}).strict() satisfies z.ZodType<LiveQualityExperimentOutput>;

export function parseLiveQualityExperimentOutput(value: unknown): LiveQualityExperimentOutput {
  return liveQualityExperimentOutputSchema.parse(value);
}

function valuesAtPath(value: unknown, path: string): unknown {
  const segments = path.split('.');
  let values = [value];
  let expanded = false;
  for (const segment of segments) {
    if (segment === '*') {
      expanded = true;
      values = values.flatMap((entry) => Array.isArray(entry) ? entry : []);
      continue;
    }
    values = values.flatMap((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? [(entry as Record<string, unknown>)[segment]]
        : []);
  }
  return expanded ? values.filter((entry) => entry !== undefined) : values[0];
}

function deepContains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((expectedEntry) =>
      actual.some((actualEntry) => deepContains(actualEntry, expectedEntry)));
  }
  if (expected && typeof expected === 'object') {
    return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual)) &&
      Object.entries(expected as Record<string, unknown>).every(([key, expectedEntry]) =>
        deepContains((actual as Record<string, unknown>)[key], expectedEntry));
  }
  return isDeepStrictEqual(actual, expected);
}

function setEqual(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  const unmatched = [...actual];
  for (const expectedEntry of expected) {
    const index = unmatched.findIndex((actualEntry) =>
      isDeepStrictEqual(actualEntry, expectedEntry));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

function factIssues(
  facts: OutcomeFact[],
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const sources = {
    state: output.stateAfter,
    genui: output.genUi,
    presentation: output.presentationFacts,
  };
  for (const fact of facts) {
    const actual = valuesAtPath(sources[fact.source], fact.path);
    const passed = fact.operator === 'present'
      ? actual !== undefined && actual !== null && (!Array.isArray(actual) || actual.length > 0)
      : fact.operator === 'absent'
        ? actual === undefined || actual === null
        : fact.operator === 'equals'
          ? isDeepStrictEqual(actual, fact.value)
          : fact.operator === 'contains'
            ? deepContains(actual, fact.value)
            : fact.operator === 'set_equals'
              ? setEqual(actual, fact.value)
              : fact.operator === 'lte'
                ? typeof actual === 'number' && typeof fact.value === 'number' &&
                  actual <= fact.value
                : typeof actual === 'number' && typeof fact.value === 'number' &&
                  actual >= fact.value;
    if (!passed) issues.push(`${fact.source}.${fact.path} failed ${fact.operator}`);
  }
  return issues;
}

function stateIssues(expectation: TurnExpectation, output: LiveQualityExperimentOutput): string[] {
  const issues = factIssues(expectation.outcome.state.facts, output);
  for (const key of expectation.outcome.state.mustChange) {
    if (isDeepStrictEqual(output.stateBefore[key], output.stateAfter[key])) {
      issues.push(`${key} did not change`);
    }
  }
  for (const key of expectation.outcome.state.mustNotChange) {
    if (!isDeepStrictEqual(output.stateBefore[key], output.stateAfter[key])) {
      issues.push(`${key} changed unexpectedly`);
    }
  }
  return issues;
}

const receiptBoundEffects = new Set([
  'order_created',
  'payment_changed',
  'handoff_created',
  'voucher_acquired',
  'reward_redeemed',
]);

function effectIssues(expectation: TurnExpectation, output: LiveQualityExperimentOutput): string[] {
  const issues: string[] = [];
  const successful = output.effects.filter(({ ok }) => ok);
  for (const effect of expectation.outcome.effects.required) {
    const evidence = successful.find(({ kind }) => kind === effect);
    if (!evidence) issues.push(`missing required effect ${effect}`);
    else if (receiptBoundEffects.has(effect) && !evidence.receiptId) {
      issues.push(`${effect} has no bound receipt`);
    } else if (
      receiptBoundEffects.has(effect) &&
      !output.evidence.some((entry) =>
        entry.ref === evidence.receiptId &&
        entry.official &&
        Boolean(entry.sourceFile || entry.sourceUrl || entry.sourceApi))
    ) {
      issues.push(`${effect} receipt is not bound to official evidence`);
    }
  }
  for (const effect of expectation.outcome.effects.forbidden) {
    if (successful.some(({ kind }) => kind === effect)) issues.push(`forbidden effect ${effect}`);
  }
  return issues;
}

function collectionIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
): string[] {
  const issues: string[] = [];
  for (const expected of expectation.outcome.presentation.collections) {
    const verified = output.verifiedCollections[expected.key];
    const presented = output.presentedCollections[expected.key];
    if (!verified) {
      issues.push(`${expected.key} has no verified collection`);
      continue;
    }
    if (!presented) {
      issues.push(`${expected.key} was not presented`);
      continue;
    }
    if (verified.scope !== expected.scope || presented.scope !== expected.scope) {
      issues.push(`${expected.key} scope mismatch`);
    }
    if (presented.itemIds.length < expected.minItems) {
      issues.push(`${expected.key} presented ${presented.itemIds.length}, minimum ${expected.minItems}`);
    }
    if (expected.maxItems !== undefined && presented.itemIds.length > expected.maxItems) {
      issues.push(`${expected.key} presented ${presented.itemIds.length}, maximum ${expected.maxItems}`);
    }
    const verifiedIds = new Set(verified.itemIds);
    if (presented.itemIds.some((itemId) => !verifiedIds.has(itemId))) {
      issues.push(`${expected.key} contains an unverified item`);
    }
    if (expected.exactVerifiedItems && !setEqual(presented.itemIds, verified.itemIds)) {
      issues.push(`${expected.key} does not present the exact verified item set`);
    }
    if (presented.categories.some((category) => !verified.categories.includes(category))) {
      issues.push(`${expected.key} contains an unverified category`);
    }
    if (expected.exactVerifiedItems && !setEqual(presented.categories, verified.categories)) {
      issues.push(`${expected.key} does not present the exact verified category set`);
    }
    if (expected.requireComplete) {
      for (const [label, collection] of [['verified', verified], ['presented', presented]] as const) {
        if (!collection.complete || collection.returned !== collection.total ||
          collection.itemIds.length !== collection.total) {
          issues.push(`${expected.key} ${label} collection is incomplete`);
        }
      }
    }
    for (const category of expected.requiredCategories) {
      if (!presented.categories.includes(category)) issues.push(`${expected.key} missing category ${category}`);
    }
    if (mode === 'genui' && expected.requireCategoryTabs &&
      !setEqual(presented.categoryTabs, verified.categories)) {
      issues.push(`${expected.key} category tabs do not match verified categories`);
    }
    if (mode === 'genui' && expected.selectionLimit !== undefined &&
      presented.selectionLimit !== expected.selectionLimit) {
      issues.push(`${expected.key} selection limit is not ${expected.selectionLimit}`);
    }
    if (mode === 'genui') {
      issues.push(...genUiCollectionIssues(expected.key, expected, output, presented));
    }
  }
  return issues;
}

function genUiCollectionIssues(
  key: string,
  expected: TurnExpectation['outcome']['presentation']['collections'][number],
  output: LiveQualityExperimentOutput,
  presented: LiveQualityExperimentOutput['presentedCollections'][string],
): string[] {
  const issues: string[] = [];
  const genUiItems = valuesAtPath(output.genUi, 'data.items');
  if (!Array.isArray(genUiItems)) {
    issues.push(`${key} GenUI has no item collection`);
    return issues;
  }
  const itemIds = genUiItems.map((item) => {
    if (typeof item === 'string' && item.length > 0) return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    return [record.itemId, record.code, record.id]
      .find((candidate): candidate is string =>
        typeof candidate === 'string' && candidate.length > 0);
  });
  if (itemIds.some((itemId) => itemId === undefined)) {
    issues.push(`${key} GenUI contains an item without a stable ID`);
  } else if (!setEqual(itemIds, presented.itemIds)) {
    issues.push(`${key} GenUI items differ from the presented collection`);
  }

  if (expected.requireCategoryTabs || expected.requiredCategories.length > 0 ||
    expected.exactVerifiedItems) {
    const categories = valuesAtPath(output.genUi, 'data.categories');
    if (!setEqual(categories, presented.categories)) {
      issues.push(`${key} GenUI categories differ from the presented collection`);
    }
  }
  if (expected.requireComplete) {
    for (const [path, value] of [
      ['data.total', presented.total],
      ['data.returned', presented.returned],
      ['data.complete', presented.complete],
    ] as const) {
      if (!isDeepStrictEqual(valuesAtPath(output.genUi, path), value)) {
        issues.push(`${key} GenUI ${path} differs from the presented collection`);
      }
    }
  }
  if (expected.selectionLimit !== undefined &&
    valuesAtPath(output.genUi, 'data.selectionLimit') !== expected.selectionLimit) {
    issues.push(`${key} GenUI selection limit is not ${expected.selectionLimit}`);
  }
  return issues;
}

function presentationIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
): string[] {
  const issues = collectionIssues(expectation, output, mode);
  if (!output.responseText.trim()) issues.push('missing customer-facing response');
  if (mode === 'text') {
    if (output.genUi !== undefined) issues.push('text mode forbids GenUI');
    return issues;
  }
  const expected = expectation.outcome.presentation.genUi;
  const genUi = output.genUi as Record<string, unknown> | undefined;
  if (expected.required && !genUi) issues.push('missing required GenUI');
  if (!genUi) return issues;
  if (typeof genUi.widgetKind !== 'string' ||
    !expected.allowedWidgetKinds.includes(genUi.widgetKind as never)) {
    issues.push(`unexpected GenUI widget ${String(genUi.widgetKind)}`);
  }
  for (const path of expected.requiredDataPaths) {
    const value = valuesAtPath(genUi, path);
    if (value === undefined || value === null) issues.push(`GenUI missing ${path}`);
  }
  const actionIds = Array.isArray(genUi.actions)
    ? genUi.actions.map((action) =>
        action && typeof action === 'object' && !Array.isArray(action)
          ? (action as Record<string, unknown>).id
          : undefined)
    : [];
  for (const forbidden of expected.forbiddenActions) {
    if (forbidden.startsWith('widget:')) {
      if (genUi.widgetKind === forbidden.slice('widget:'.length)) {
        issues.push(`forbidden GenUI widget ${String(genUi.widgetKind)}`);
      }
    } else if (actionIds.includes(forbidden)) {
      issues.push(`forbidden GenUI action ${forbidden}`);
    }
  }
  return issues;
}

function provenanceIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const required = expectation.outcome.provenance.requiredEvidenceKinds;
  for (const kind of required) {
    const evidence = output.evidence.filter((entry) => entry.kind === kind);
    if (evidence.length === 0) {
      issues.push(`missing ${kind} evidence`);
    } else if (evidence.some((entry) => !(entry.sourceFile || entry.sourceUrl || entry.sourceApi))) {
      issues.push(`${kind} evidence has no source`);
    }
  }
  if (expectation.outcome.provenance.requireOfficialSameReference) {
    const claimRefs = valuesAtPath(output.presentationFacts, 'evidenceRefs');
    if (!Array.isArray(claimRefs)) {
      issues.push('governed claim has no evidence references');
    } else {
      for (const kind of required) {
        const bound = output.evidence.some((entry) =>
          entry.kind === kind && entry.official && claimRefs.includes(entry.ref));
        if (!bound) {
          issues.push(`${kind} claim is not bound to the same official reference`);
        }
      }
    }
  }
  return issues;
}

function persistenceIssues(
  expectation: TurnExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const persistence = output.persistence;
  if (persistence.eventRevisionBefore !== persistence.eventIdsBefore.length) {
    issues.push('before event revision does not match event IDs');
  }
  if (persistence.eventRevisionAfter !== persistence.eventIdsAfter.length) {
    issues.push('after event revision does not match event IDs');
  }
  if (persistence.transcriptRevisionAfter - persistence.transcriptRevisionBefore !==
    expectation.outcome.persistence.transcriptDelta) {
    issues.push('unexpected transcript revision delta');
  }
  const eventDelta = persistence.eventRevisionAfter - persistence.eventRevisionBefore;
  if (eventDelta <= 0 || persistence.eventIds.length !== eventDelta) {
    issues.push('event revision does not match event IDs');
  }
  if (!isDeepStrictEqual(
    persistence.eventIdsAfter,
    [...persistence.eventIdsBefore, ...persistence.eventIds],
  )) {
    issues.push('event IDs are not contiguous');
  }
  if (new Set(persistence.eventIds).size !== persistence.eventIds.length) {
    issues.push('turn event IDs are not unique');
  }
  if (new Set(persistence.eventIdsBefore).size !== persistence.eventIdsBefore.length) {
    issues.push('before event IDs are not unique');
  }
  if (new Set(persistence.eventIdsAfter).size !== persistence.eventIdsAfter.length) {
    issues.push('after event IDs are not unique');
  }
  if (expectation.outcome.persistence.checkpointRequired &&
    (!persistence.checkpointId || !persistence.checkpointNamespace)) {
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
  candidate: unknown,
  mode: LiveQualityMode,
): LiveQualityEvaluationScore[] {
  const output = parseLiveQualityExperimentOutput(candidate);
  const components = [
    score('state', stateIssues(expectation, output)),
    score('effects', effectIssues(expectation, output)),
    score('grounding', output.responseText.trim() ? [] : ['missing customer-facing response']),
    score('presentation', presentationIssues(expectation, output, mode)),
    score('provenance', provenanceIssues(expectation, output)),
    score('persistence', persistenceIssues(expectation, output)),
    score('latency', output.durationMs <= expectation.outcome.latency.maxTurnMs
      ? []
      : [`${output.durationMs}ms exceeded ${expectation.outcome.latency.maxTurnMs}ms`]),
  ];
  return [
    ...components,
    score('acceptance', components.filter(({ score: passed }) => !passed).map(({ key }) => `${key} failed`)),
  ];
}

export function evaluateLiveQualityModeParity(input: {
  expectation: TurnExpectation;
  text: unknown;
  genui: unknown;
}): LiveQualityEvaluationScore {
  const text = parseLiveQualityExperimentOutput(input.text);
  const genui = parseLiveQualityExperimentOutput(input.genui);
  const issues: string[] = [];
  if (!isDeepStrictEqual(text.presentationFacts, genui.presentationFacts)) {
    issues.push('Text and GenUI structured facts differ');
  }
  const semanticCollections = (
    collections: LiveQualityExperimentOutput['presentedCollections'],
  ) => Object.fromEntries(Object.entries(collections).map(([key, collection]) => [
    key,
    {
      scope: collection.scope,
      itemIds: collection.itemIds,
      categories: collection.categories,
      total: collection.total,
      returned: collection.returned,
      complete: collection.complete,
    },
  ]));
  if (!isDeepStrictEqual(
    semanticCollections(text.presentedCollections),
    semanticCollections(genui.presentedCollections),
  )) {
    issues.push('Text and GenUI presented collections differ');
  }
  if (!isDeepStrictEqual(
    text.effects.map(({ kind, ok }) => ({ kind, ok })),
    genui.effects.map(({ kind, ok }) => ({ kind, ok })),
  )) {
    issues.push('Text and GenUI effects differ');
  }
  const textFactValues = input.expectation.outcome.state.facts.map(({ source, path }) =>
    valuesAtPath(
      source === 'state'
        ? text.stateAfter
        : source === 'genui'
          ? text.genUi
          : text.presentationFacts,
      path,
    ));
  const genuiFactValues = input.expectation.outcome.state.facts.map(({ source, path }) =>
    valuesAtPath(
      source === 'state'
        ? genui.stateAfter
        : source === 'genui'
          ? genui.genUi
          : genui.presentationFacts,
      path,
    ));
  if (!isDeepStrictEqual(textFactValues, genuiFactValues)) {
    issues.push('Text and GenUI expected fact values differ');
  }
  return score('mode_parity', issues);
}

export function createLiveQualityExperimentEvaluator(datasetCases: LiveQualityDatasetCase[]) {
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
      input.outputs,
      localCase.mode,
    ).map(({ key, score: passed, comment }) => ({
      key,
      score: passed ? 1 : 0,
      value: passed,
      ...(comment ? { comment } : {}),
    }));
  };
}
