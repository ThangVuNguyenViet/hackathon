import type {
  LiveQualityEvaluationExpectation,
  LiveQualityExperimentOutput,
  LiveQualityMode,
} from './liveQualityContracts.js';
import {
  valueAtPath,
  valuesEqual,
} from './liveQualityArgumentConstraints.js';

const internalMetadataKeys = new Set([
  'checkpoint',
  'checkpointid',
  'checkpointnamespace',
  'checkpointns',
  'executedtools',
  'fixturemode',
  'genui',
  'plannerrecords',
  'providerfingerprint',
  'provenance',
  'resultsummary',
  'tooltrace',
  'widgetkind',
]);

const internalMetadataMarkers = [
  'checkpoint_ns',
  'checkpointnamespace',
  'executedtools',
  'fixturemode',
  'plannerrecords',
  'providerfingerprint',
  'resultsummary',
  'tooltrace',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function normalizedMetadataKey(value: string): string {
  return value.toLocaleLowerCase('en-US').replaceAll(/[_-]/gu, '');
}

function internalMetadataPaths(
  value: unknown,
  path: string,
): string[] {
  if (typeof value === 'string') {
    const normalized = value.toLocaleLowerCase('en-US');
    return internalMetadataMarkers.some((marker) =>
      normalized.includes(marker))
      ? [path]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      internalMetadataPaths(entry, `${path}.${index}`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    return [
      ...(internalMetadataKeys.has(normalizedMetadataKey(key))
        ? [entryPath]
        : []),
      ...internalMetadataPaths(entry, entryPath),
    ];
  });
}

function customerVisibleGenUiInternalMetadataPaths(
  genUi: Record<string, unknown>,
): string[] {
  const paths = [
    ...internalMetadataPaths(genUi.title, 'title'),
    ...internalMetadataPaths(genUi.summary, 'summary'),
    ...internalMetadataPaths(genUi.data, 'data'),
  ];
  if (!Array.isArray(genUi.actions)) return paths;
  return [
    ...paths,
    ...genUi.actions.flatMap((action, index) => {
      if (!isRecord(action)) return [];
      return [
        ...internalMetadataPaths(
          action.label,
          `actions.${index}.label`,
        ),
        ...internalMetadataPaths(
          action.value,
          `actions.${index}.value`,
        ),
        ...internalMetadataPaths(
          action.payload,
          `actions.${index}.payload`,
        ),
      ];
    }),
  ];
}

function hasNonNullPath(value: unknown, path: string): boolean {
  const found = valueAtPath(value, path);
  return found !== undefined && found !== null;
}

function completeMenuGenUiIssues(
  genUi: Record<string, unknown>,
): string[] {
  const data = isRecord(genUi.data) ? genUi.data : {};
  const items = data.items;
  const categories = data.categories;
  const collection = isRecord(data.collection) ? data.collection : {};
  const scope = isRecord(collection.scope) ? collection.scope : {};
  const itemCategories = Array.isArray(items)
    ? items.flatMap((item) =>
        isRecord(item) &&
        typeof item.categoryId === 'string' &&
        item.categoryId.length > 0 &&
        typeof item.category === 'string' &&
        item.category.length > 0
          ? [{
              categoryId: item.categoryId,
              label: item.category,
            }]
          : [])
    : [];
  const projectedCategories = Array.isArray(categories)
    ? categories.flatMap((category) =>
        isRecord(category) &&
        typeof category.categoryId === 'string' &&
        category.categoryId.length > 0 &&
        typeof category.label === 'string' &&
        category.label.length > 0
          ? [{
              categoryId: category.categoryId,
              label: category.label,
            }]
          : [])
    : [];
  const expectedCategoryById = new Map(
    itemCategories.map((category) => [
      category.categoryId,
      category.label,
    ]),
  );
  const projectedCategoryById = new Map(
    projectedCategories.map((category) => [
      category.categoryId,
      category.label,
    ]),
  );
  const issues: string[] = [];
  if (
    !Array.isArray(items) ||
    data.complete !== true ||
    data.total !== items.length ||
    data.returned !== items.length ||
    collection.complete !== true ||
    collection.total !== items.length ||
    collection.returned !== items.length ||
    scope.scope !== 'all'
  ) {
    issues.push('GenUI does not project the complete all-menu collection');
  }
  if (
    expectedCategoryById.size < 2 ||
    projectedCategories.length !== projectedCategoryById.size ||
    !valuesEqual(
      [...projectedCategoryById.entries()].sort(),
      [...expectedCategoryById.entries()].sort(),
    )
  ) {
    issues.push('GenUI categories do not cover the complete menu');
  }
  return issues;
}

export function presentationIssues(
  expectation: LiveQualityEvaluationExpectation,
  output: LiveQualityExperimentOutput,
  mode: LiveQualityMode,
): string[] {
  const issues: string[] = [];
  const forbiddenInternalMarkers = [
    ...('forbidden' in expectation.claims
      ? expectation.claims.forbidden ?? []
      : []),
    ...('forbiddenText' in expectation.messenger
      ? expectation.messenger.forbiddenText ?? []
      : []),
  ];
  const normalizedText = output.responseText.toLocaleLowerCase('vi-VN');
  for (const marker of forbiddenInternalMarkers) {
    if (normalizedText.includes(marker.toLocaleLowerCase('vi-VN'))) {
      issues.push(`response exposes forbidden internal marker: ${marker}`);
    }
  }
  if (mode === 'text' && output.genUi !== undefined) {
    issues.push('text mode forbids GenUI');
    return issues;
  }
  const genUi = output.genUi as Record<string, unknown> | undefined;
  if (expectation.genUi.required && !genUi) {
    issues.push('missing required GenUI');
  }
  if (!genUi) return issues;
  const internalPaths = customerVisibleGenUiInternalMetadataPaths(genUi);
  if (internalPaths.length > 0) {
    issues.push(
      `GenUI exposes internal metadata: ${internalPaths.join(', ')}`,
    );
  }
  if (
    typeof genUi.widgetKind !== 'string' ||
    !expectation.genUi.allowedWidgetKinds.some(
      (kind) => kind === genUi.widgetKind,
    )
  ) {
    issues.push(`unexpected GenUI widget: ${String(genUi.widgetKind)}`);
  }
  for (const path of expectation.genUi.requiredDataPaths) {
    if (!hasNonNullPath(genUi, path)) {
      issues.push(`GenUI missing ${path}`);
    }
  }
  const actionIds = Array.isArray(genUi.actions)
    ? genUi.actions.map(
        (action) => (action as Record<string, unknown>).id,
      )
    : [];
  for (const action of expectation.genUi.requiredActions) {
    if (!actionIds.includes(action)) {
      issues.push(`GenUI missing action ${action}`);
    }
  }
  for (const action of expectation.genUi.forbiddenActions) {
    if (action.startsWith('widget:')) {
      if (genUi.widgetKind === action.slice('widget:'.length)) {
        issues.push(
          `forbidden GenUI widget ${String(genUi.widgetKind)}`,
        );
      }
    } else if (actionIds.includes(action)) {
      issues.push(`forbidden GenUI action ${action}`);
    }
  }
  if (expectation.genUi.requireCompleteMenuCollection) {
    issues.push(...completeMenuGenUiIssues(genUi));
  }
  return issues;
}
