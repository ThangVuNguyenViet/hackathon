import type {
  LiveQualityEvaluationExpectation,
  LiveQualityExperimentOutput,
} from './liveQualityContracts.js';
import { valueAtPath } from './liveQualityArgumentConstraints.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function completeMenuCollectionIssues(
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
    ? new Set(
        items.flatMap((item) =>
          isRecord(item) &&
          typeof item.categoryId === 'string' &&
          item.categoryId.length > 0
            ? [item.categoryId]
            : [],
        ),
      )
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
