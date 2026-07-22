import { isDeepStrictEqual } from 'node:util';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';
import type {
  LiveQualityEvaluationExpectation,
  LiveQualityExperimentOutput,
} from './liveQualityContracts.js';
import { SCENARIO_MUTABLE_STATE_KEYS } from './liveQualityContracts.js';
import {
  callArgumentsMatch,
  valueAtPath,
  valuesEqual,
} from './liveQualityArgumentConstraints.js';
import { completeMenuCollectionIssues } from './liveQualityMenuCollectionIssues.js';
import { validatedV3PrivateTraceBinding } from './liveQualityToolTrace.js';

interface VerifiedModifierBinding {
  itemCode: string;
  groupId: string;
  modifierId: string;
}

const legacyTypedModifierBindingsByExpectation = {
  '01-dat-mon-ro-rang-giao-hang.json#1': [
    {
      itemCode: '20702',
      groupId: '60254',
      modifierId: '70012',
    },
  ],
  '07-ca-nhan-hoa-va-loyalty.json#7': [
    {
      itemCode: '20698',
      groupId: '3',
      modifierId: 'MOCK-PEACH-TEA-MODIFIER',
    },
  ],
} as const satisfies Readonly<
  Record<string, readonly VerifiedModifierBinding[]>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nestedRecords);
  if (!isUnknownRecord(value)) return [];
  return [value, ...Object.values(value).flatMap(nestedRecords)];
}

function catalogEvidenceRecordsFromState(
  state: Record<string, unknown>,
): Record<string, unknown>[] {
  return nestedRecords({
    menuSearchResults: state.menuSearchResults,
    activeMenuCollection: state.activeMenuCollection,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
  });
}

function catalogEvidenceRecords(
  output: LiveQualityExperimentOutput,
): Record<string, unknown>[] {
  return catalogEvidenceRecordsFromState(output.stateAfter);
}

function hasCatalogModifierBindingInState(
  state: Record<string, unknown>,
  required: NonNullable<
    LiveQualityEvaluationExpectation['requiredCatalogModifierEvidence']
  >[number],
): boolean {
  const visit = (
    value: unknown,
    itemCode?: string,
    group?: { groupId: string; min?: number },
  ): boolean => {
    if (Array.isArray(value)) {
      return value.some((candidate) => visit(candidate, itemCode, group));
    }
    if (!isRecord(value)) return false;
    const nextItemCode =
      typeof value.itemCode === 'string'
        ? value.itemCode
        : typeof value.code === 'string' && Array.isArray(value.modifierGroups)
          ? value.code
          : itemCode;
    const nextGroup =
      typeof value.groupId === 'string'
        ? {
            groupId: value.groupId,
            ...(typeof value.min === 'number' ? { min: value.min } : {}),
          }
        : group;
    if (
      value.modifierId === required.modifierId &&
      nextItemCode === required.itemCode &&
      nextGroup?.groupId === required.groupId &&
      (required.groupMin === undefined ||
        nextGroup.min === required.groupMin) &&
      (required.default === undefined || value.default === required.default) &&
      (required.quantity === undefined || value.quantity === required.quantity)
    ) {
      return true;
    }
    return Object.values(value).some((candidate) =>
      visit(candidate, nextItemCode, nextGroup),
    );
  };

  return visit({
    menuSearchResults: state.menuSearchResults,
    activeMenuCollection: state.activeMenuCollection,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
  });
}

function hasCatalogModifierBinding(
  output: LiveQualityExperimentOutput,
  required: NonNullable<
    LiveQualityEvaluationExpectation['requiredCatalogModifierEvidence']
  >[number],
): boolean {
  return hasCatalogModifierBindingInState(output.stateAfter, required);
}

function catalogIdentifiersFromState(
  state: Record<string, unknown>,
  keys: string[],
): Set<string> {
  const identifierKeys = new Set(keys);
  return new Set(
    catalogEvidenceRecordsFromState(state).flatMap((record) =>
      Object.entries(record).flatMap(([key, value]) =>
        identifierKeys.has(key) && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
}

function catalogIdentifiers(
  output: LiveQualityExperimentOutput,
  keys: string[],
): Set<string> {
  return catalogIdentifiersFromState(output.stateAfter, keys);
}

const durableCatalogReadTools = new Set<ToolName>([
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
]);

function hasCurrentActiveMenuSnapshot(state: Record<string, unknown>): boolean {
  const snapshot = state.activeMenuCollection;
  if (!isRecord(snapshot)) return false;
  const result = snapshot.result;
  return (
    typeof snapshot.key === 'string' &&
    snapshot.key.trim().length > 0 &&
    typeof snapshot.revision === 'string' &&
    snapshot.revision.trim().length > 0 &&
    typeof snapshot.providerRevision === 'string' &&
    snapshot.providerRevision.trim().length > 0 &&
    isRecord(result) &&
    Array.isArray(result.items) &&
    result.complete === true &&
    typeof result.total === 'number' &&
    typeof result.returned === 'number' &&
    result.returned === result.items.length &&
    result.total === result.returned
  );
}

function hasExactCatalogRequirements(
  expectation: LiveQualityEvaluationExpectation,
): boolean {
  return (
    (expectation.requiredCatalogCodes?.length ?? 0) > 0 ||
    (expectation.requiredCatalogItemEvidence?.length ?? 0) > 0 ||
    (expectation.requiredCatalogModifierEvidence?.length ?? 0) > 0 ||
    (expectation.requiredCatalogCategoryIds?.length ?? 0) > 0 ||
    (expectation.requiredCatalogModifierIds?.length ?? 0) > 0
  );
}

function durableCatalogEvidenceSatisfiesExpectation(
  expectation: LiveQualityEvaluationExpectation,
  state: Record<string, unknown>,
): boolean {
  if (
    !hasExactCatalogRequirements(expectation) ||
    !hasCurrentActiveMenuSnapshot(state)
  ) {
    return false;
  }
  const records = catalogEvidenceRecordsFromState(state);
  const codes = catalogIdentifiersFromState(state, [
    'code',
    'itemCode',
    'itemId',
  ]);
  const categoryIds = catalogIdentifiersFromState(state, ['categoryId']);
  const modifierIds = catalogIdentifiersFromState(state, ['modifierId']);
  return (
    (expectation.requiredCatalogCodes ?? []).every((code) => codes.has(code)) &&
    (expectation.requiredCatalogItemEvidence ?? []).every((required) =>
      records.some(
        (record) =>
          [record.code, record.itemCode, record.itemId].includes(
            required.code,
          ) &&
          (required.available === undefined ||
            record.available === required.available) &&
          (required.priceVnd === undefined ||
            record.priceVnd === required.priceVnd),
      ),
    ) &&
    (expectation.requiredCatalogModifierEvidence ?? []).every((required) =>
      hasCatalogModifierBindingInState(state, required),
    ) &&
    (expectation.requiredCatalogCategoryIds ?? []).every((categoryId) =>
      categoryIds.has(categoryId),
    ) &&
    (expectation.requiredCatalogModifierIds ?? []).every((modifierId) =>
      modifierIds.has(modifierId),
    )
  );
}

export function durableCatalogEvidenceSatisfiesGroup(
  expectation: LiveQualityEvaluationExpectation,
  state: Record<string, unknown>,
  group: readonly ToolName[],
): boolean {
  return (
    group.length > 0 &&
    group.every((toolName) => durableCatalogReadTools.has(toolName)) &&
    durableCatalogEvidenceSatisfiesExpectation(expectation, state)
  );
}

function argumentIdentifiers(value: unknown, keys: string[]): string[] {
  const identifierKeys = new Set(keys);
  return nestedRecords(value).flatMap((record) =>
    Object.entries(record).flatMap(([key, candidate]) =>
      identifierKeys.has(key) && typeof candidate === 'string'
        ? [candidate]
        : [],
    ),
  );
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
    return change.modifiers.some(
      (modifier) =>
        isRecord(modifier) &&
        modifier.groupId === binding.groupId &&
        modifier.modifierId === binding.modifierId,
    );
  });
}

function verifiedFulfillmentLocations(
  output: LiveQualityExperimentOutput,
): Array<{ district: string; city: string }> {
  return nestedRecords(output.stateAfter).flatMap((record) =>
    typeof record.district === 'string' && typeof record.city === 'string'
      ? [{ district: record.district, city: record.city }]
      : [],
  );
}

type ArgumentConstraint =
  LiveQualityEvaluationExpectation['argumentConstraints'][number]['constraints'][number];

type StatePathConstraint =
  LiveQualityEvaluationExpectation['stateTransition']['pathConstraints'][number];

function orderedByExpectedKey<T>(
  values: T[],
  expectedKeys: Map<string, number>,
  keyFor: (value: T) => string | undefined,
): T[] {
  if (expectedKeys.size === 0) return values;
  return values
    .map((value, originalIndex) => ({ value, originalIndex }))
    .sort((left, right) => {
      const leftKey = keyFor(left.value);
      const rightKey = keyFor(right.value);
      const leftIndex =
        leftKey === undefined
          ? Number.POSITIVE_INFINITY
          : (expectedKeys.get(leftKey) ?? Number.POSITIVE_INFINITY);
      const rightIndex =
        rightKey === undefined
          ? Number.POSITIVE_INFINITY
          : (expectedKeys.get(rightKey) ?? Number.POSITIVE_INFINITY);
      return leftIndex - rightIndex || left.originalIndex - right.originalIndex;
    })
    .map(({ value }) => value);
}

function expectedIndexedValues(
  constraints: readonly (ArgumentConstraint | StatePathConstraint)[],
  pattern: RegExp,
): Map<number, string> {
  const expected = new Map<number, string>();
  for (const constraint of constraints) {
    if (
      constraint.operator !== 'equals' ||
      typeof constraint.value !== 'string'
    ) {
      continue;
    }
    const match = pattern.exec(constraint.path);
    if (match?.[1]) expected.set(Number(match[1]), constraint.value);
  }
  return expected;
}

function expectedModifierKeys(
  constraints: readonly (ArgumentConstraint | StatePathConstraint)[],
  prefix: string,
  itemIndex: number,
): Map<string, number> {
  const components = new Map<
    number,
    { groupId?: string; modifierId?: string }
  >();
  const pattern = new RegExp(
    `^${prefix}\\.${itemIndex}\\.modifiers\\.(\\d+)\\.(groupId|modifierId)$`,
    'u',
  );
  for (const constraint of constraints) {
    if (
      constraint.operator !== 'equals' ||
      typeof constraint.value !== 'string'
    ) {
      continue;
    }
    const match = pattern.exec(constraint.path);
    if (!match?.[1] || !match[2]) continue;
    const modifierIndex = Number(match[1]);
    const component = components.get(modifierIndex) ?? {};
    if (match[2] === 'groupId') component.groupId = constraint.value;
    if (match[2] === 'modifierId') component.modifierId = constraint.value;
    components.set(modifierIndex, component);
  }
  return new Map(
    [...components.entries()].flatMap(([index, component]) =>
      component.groupId && component.modifierId
        ? [[`${component.groupId}::${component.modifierId}`, index] as const]
        : [],
    ),
  );
}

function canonicalUpdateCartCall(
  call: ToolTraceEntry,
  constraints: readonly ArgumentConstraint[],
): ToolTraceEntry {
  if (
    call.toolName !== 'updateCart' ||
    !Array.isArray(call.arguments.changes)
  ) {
    return call;
  }
  const expectedItems = expectedIndexedValues(
    constraints,
    /^changes\.(\d+)\.itemCode$/u,
  );
  const changes = orderedByExpectedKey(
    call.arguments.changes,
    new Map([...expectedItems.entries()].map(([index, code]) => [code, index])),
    (change) =>
      isRecord(change) && typeof change.itemCode === 'string'
        ? change.itemCode
        : undefined,
  ).map((change, itemIndex) => {
    if (!isRecord(change) || !Array.isArray(change.modifiers)) return change;
    const expectedModifiers = expectedModifierKeys(
      constraints,
      'changes',
      itemIndex,
    );
    return {
      ...change,
      modifiers: orderedByExpectedKey(
        change.modifiers,
        expectedModifiers,
        (modifier) =>
          isRecord(modifier) &&
          typeof modifier.groupId === 'string' &&
          typeof modifier.modifierId === 'string'
            ? `${modifier.groupId}::${modifier.modifierId}`
            : undefined,
      ),
    };
  });
  return {
    ...call,
    arguments: { ...call.arguments, changes },
  };
}

function canonicalStateAfter(
  expectation: LiveQualityEvaluationExpectation,
  stateAfter: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(stateAfter.cart) || !Array.isArray(stateAfter.cart.items)) {
    return stateAfter;
  }
  const constraints = expectation.stateTransition.pathConstraints;
  const expectedItems = expectedIndexedValues(
    constraints,
    /^cart\.items\.(\d+)\.itemCode$/u,
  );
  const items = orderedByExpectedKey(
    stateAfter.cart.items,
    new Map([...expectedItems.entries()].map(([index, code]) => [code, index])),
    (item) =>
      isRecord(item) && typeof item.itemCode === 'string'
        ? item.itemCode
        : undefined,
  ).map((item, itemIndex) => {
    if (!isRecord(item) || !Array.isArray(item.modifiers)) return item;
    const expectedModifiers = expectedModifierKeys(
      constraints,
      'cart\\.items',
      itemIndex,
    );
    return {
      ...item,
      modifiers: orderedByExpectedKey(
        item.modifiers,
        expectedModifiers,
        (modifier) =>
          isRecord(modifier) &&
          typeof modifier.groupId === 'string' &&
          typeof modifier.modifierId === 'string'
            ? `${modifier.groupId}::${modifier.modifierId}`
            : undefined,
      ),
    };
  });
  return {
    ...stateAfter,
    cart: { ...stateAfter.cart, items },
  };
}

function unexpectedScenarioTools(
  allowedTools: ToolName[],
  plannedTools: ToolName[],
  executedTools: ToolName[],
): ToolName[] {
  return [...new Set([...plannedTools, ...executedTools])].filter(
    (toolName) => !allowedTools.includes(toolName),
  );
}

export function toolContractIssues(
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
  if (unexpected.length > 0)
    issues.push(`unexpected tools: ${unexpected.join(', ')}`);
  const requiredGroups = expectation.requiredGroups ?? [];
  const groupIsSatisfied = (group: ToolName[]) =>
    group.some((toolName) => finalObservedTools.includes(toolName)) ||
    durableCatalogEvidenceSatisfiesGroup(expectation, output.stateAfter, group);
  for (const group of requiredGroups) {
    if (!groupIsSatisfied(group)) {
      issues.push(`missing required tool group: ${group.join('|')}`);
    }
  }
  for (const toolName of expectation.forbiddenTools ?? []) {
    if (finalObservedTools.includes(toolName))
      issues.push(`forbidden tool: ${toolName}`);
  }
  const catalogCodes = catalogIdentifiers(output, [
    'code',
    'itemCode',
    'itemId',
  ]);
  const catalogRecords = catalogEvidenceRecords(output);
  const catalogCategoryIds = catalogIdentifiers(output, ['categoryId']);
  const catalogModifierIds = catalogIdentifiers(output, ['modifierId']);
  const legacyRequiredModifierBindings =
    Object.entries(legacyTypedModifierBindingsByExpectation).find(
      ([expectationId]) => expectationId === expectation.id,
    )?.[1] ?? [];
  const requiredModifierIds = new Set([
    ...(expectation.requiredCatalogModifierIds ?? []),
    ...legacyRequiredModifierBindings.map(({ modifierId }) => modifierId),
  ]);
  for (const code of expectation.requiredCatalogCodes ?? []) {
    if (!catalogCodes.has(code))
      issues.push(`missing catalog candidate: ${code}`);
  }
  for (const required of expectation.requiredCatalogItemEvidence ?? []) {
    const matches = catalogRecords.some((record) => {
      const recordCodes = [record.code, record.itemCode, record.itemId];
      return (
        recordCodes.includes(required.code) &&
        (required.available === undefined ||
          record.available === required.available) &&
        (required.priceVnd === undefined ||
          record.priceVnd === required.priceVnd)
      );
    });
    if (!matches) {
      issues.push(
        `missing catalog item evidence: ${required.code}` +
          (required.available === undefined
            ? ''
            : ` available=${String(required.available)}`) +
          (required.priceVnd === undefined
            ? ''
            : ` priceVnd=${String(required.priceVnd)}`),
      );
    }
  }
  for (const required of expectation.requiredCatalogModifierEvidence ?? []) {
    if (!hasCatalogModifierBinding(output, required)) {
      issues.push(
        'missing catalog modifier binding: ' +
          `${required.itemCode}/${required.groupId}/${required.modifierId}`,
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
    const updateCartCalls = output.executedTools.filter(
      ({ toolName }) => toolName === 'updateCart',
    );
    for (const binding of legacyRequiredModifierBindings) {
      if (
        !updateCartCalls.some(({ arguments: argumentsValue }) =>
          updateCartHasModifierBinding(argumentsValue, binding),
        )
      ) {
        issues.push(
          'updateCart is missing required verified modifier binding: ' +
            `${binding.itemCode}/${binding.groupId}/${binding.modifierId}`,
        );
      }
    }
  }
  for (const toolName of expectation.verifiedCatalogArgumentTools ?? []) {
    const calls = output.executedTools.filter(
      (entry) => entry.toolName === toolName,
    );
    for (const call of calls) {
      const unverifiedItemIds = argumentIdentifiers(call.arguments, [
        'code',
        'itemCode',
        'itemId',
      ]).filter((identifier) => !catalogCodes.has(identifier));
      const unverifiedModifierIds = argumentIdentifiers(call.arguments, [
        'modifierId',
      ]).filter((identifier) => !catalogModifierIds.has(identifier));
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
    !verifiedFulfillmentLocations(output).some((location) =>
      isDeepStrictEqual(location, expectation.requiredFulfillmentLocation),
    )
  ) {
    issues.push('missing required fulfillment location');
  }
  for (const entity of expectation.requiredBooleanEntities ?? []) {
    if (
      !nestedRecords(output.stateAfter).some(
        (record) => record[entity] === true,
      )
    ) {
      issues.push(`missing required boolean entity: ${entity}`);
    }
  }
  if (
    !expectation.allowEmptyTools &&
    requiredGroups.length > 0 &&
    finalObservedTools.length === 0 &&
    requiredGroups.some((group) => !groupIsSatisfied(group))
  ) {
    issues.push('required grounded tool evidence is missing');
  }
  for (const constraint of expectation.toolCounts) {
    const count = observedSequence.filter(
      (toolName) => toolName === constraint.toolName,
    ).length;
    if (count < constraint.min)
      issues.push(
        `${constraint.toolName} observed ${count}, minimum ${constraint.min}`,
      );
    if (constraint.max !== undefined && count > constraint.max) {
      issues.push(
        `${constraint.toolName} observed ${count}, maximum ${constraint.max}`,
      );
    }
  }
  if ('toolOrder' in expectation) {
    let previousIndex = -1;
    for (const toolName of expectation.toolOrder) {
      const nextIndex = observedSequence.indexOf(toolName, previousIndex + 1);
      if (nextIndex <= previousIndex) {
        issues.push(`missing ordered tool: ${toolName}`);
      } else {
        previousIndex = nextIndex;
      }
    }
    previousIndex = -1;
    for (const group of expectation.toolOrderGroups) {
      const nextIndex = observedSequence.findIndex(
        (toolName, index) => index > previousIndex && group.includes(toolName),
      );
      if (nextIndex <= previousIndex) {
        issues.push(`missing ordered tool group: ${group.join('|')}`);
      } else {
        previousIndex = nextIndex;
      }
    }
  }
  for (const constraint of expectation.argumentConstraints) {
    const matchingCalls = output.executedTools.filter(
      ({ toolName }) => toolName === constraint.toolName,
    );
    const minimum = expectation.toolCounts.find(
      ({ toolName }) => toolName === constraint.toolName,
    )?.min;
    if (matchingCalls.length === 0 && minimum === 0) continue;
    if (
      matchingCalls.some(
        (call) =>
          !callArgumentsMatch(
            constraint.constraints,
            canonicalUpdateCartCall(call, constraint.constraints),
            output,
            constraint.argumentEncoding,
          ),
      )
    ) {
      issues.push(
        `${constraint.toolName} has an execution whose arguments did not ` +
          'satisfy the exact contract',
      );
    }
  }
  return issues;
}

export function stateTransitionIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const canonicalAfter = canonicalStateAfter(expectation, output.stateAfter);
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
    const after = valueAtPath(canonicalAfter, constraint.path);
    const failed =
      (constraint.operator === 'changed' && valuesEqual(before, after)) ||
      (constraint.operator === 'unchanged' && !valuesEqual(before, after)) ||
      (constraint.operator === 'equals' &&
        !valuesEqual(after, constraint.value)) ||
      (constraint.operator === 'present' &&
        (after === undefined || after === null)) ||
      (constraint.operator === 'absent' &&
        after !== undefined &&
        after !== null);
    if (failed) {
      issues.push(
        `${constraint.path} failed ${constraint.operator} state constraint`,
      );
    }
  }
  issues.push(...completeMenuCollectionIssues(expectation, output));
  return issues;
}

export function providerEvidenceIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  if (!expectation.providerEvidence.requireToolProvenance) return [];
  const providerEntries = output.executedTools.filter(
    ({ toolName, ok }) =>
      expectation.providerEvidence.providerTools.includes(toolName) &&
      (ok ||
        expectation.providerEvidence.acceptedFailedTools.includes(toolName)),
  );
  const providerGroups = (expectation.requiredGroups ?? [])
    .map((group) =>
      group.filter((toolName) =>
        expectation.providerEvidence.providerTools.includes(toolName),
      ),
    )
    .filter((group) => group.length > 0);
  const requiredGroups =
    providerGroups.length > 0
      ? providerGroups
      : [expectation.providerEvidence.providerTools];
  const missingGroups = requiredGroups.filter(
    (group) =>
      !providerEntries.some(({ toolName }) => group.includes(toolName)) &&
      !durableCatalogEvidenceSatisfiesGroup(
        expectation,
        output.stateAfter,
        group,
      ),
  );
  if (missingGroups.length > 0) {
    return missingGroups.map(
      (group) => `required provider work is missing: ${group.join('|')}`,
    );
  }
  if (providerEntries.some(({ provenance }) => provenance.length === 0)) {
    return ['provider work without provenance'];
  }
  if (
    expectation.providerEvidence.requireRevisionOrSource &&
    providerEntries.some((entry) =>
      entry.provenance.some(
        (source) =>
          !(source.sourceFile || source.sourceUrl || source.sourceApi) &&
          !source.serverPolicy?.revision &&
          !validatedV3PrivateTraceBinding(entry),
      ),
    )
  ) {
    return ['provider provenance has no source or revision'];
  }
  return [];
}

export function persistenceIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
): string[] {
  const issues: string[] = [];
  const persistence = output.persistence;
  if (
    persistence.transcriptRevisionAfter -
      persistence.transcriptRevisionBefore !==
    expectation.persistenceEvidence.transcriptDelta
  ) {
    issues.push('unexpected transcript revision delta');
  }
  const eventDelta =
    persistence.eventRevisionAfter - persistence.eventRevisionBefore;
  if (eventDelta <= 0) issues.push('event revision did not advance');
  if (persistence.eventIds.length !== eventDelta)
    issues.push('event delta does not match event IDs');
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
