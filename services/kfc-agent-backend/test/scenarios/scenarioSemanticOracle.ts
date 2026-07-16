import type { ToolTraceEntry } from '../../src/ordering/types.js';
import type { TurnExpectation } from './scenarioCoverageLedger.js';

export function normalizeScenarioEvidence(value: unknown): string {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) =>
    current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined, value);
}

function scalarValues(value: unknown): string[] {
  if (typeof value === 'string') return normalizeScenarioEvidence(value).length >= 3 ? [value] : [];
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  return value && typeof value === 'object'
    ? Object.values(value as Record<string, unknown>).flatMap(scalarValues)
    : [];
}

export function assertScenarioSemanticClaims(input: {
  expectation: TurnExpectation;
  text: string;
  entries: ToolTraceEntry[];
  state: Record<string, unknown>;
  genUi?: unknown;
}): void {
  const { expectation, text, entries, state, genUi } = input;
  if (!text.trim()) throw new Error(`${expectation.id} has no customer-facing response`);
  const normalizedText = normalizeScenarioEvidence(text);
  const normalizedPresentation = normalizeScenarioEvidence(`${text}\n${JSON.stringify(genUi ?? {})}`);
  for (const predicate of expectation.claims.required) {
    if (predicate.kind !== 'grounded_tool_outcome') continue;
    if (!entries.some(({ toolName }) => predicate.anyOf.includes(toolName))) {
      throw new Error(`${expectation.id} has no executed ${predicate.anyOf.join('|')} result`);
    }
    const stateValues = predicate.statePaths.flatMap((path) => scalarValues(valueAtPath(state, path)));
    const genUiValues = predicate.genUiPaths.flatMap((path) => scalarValues(valueAtPath(genUi, path)));
    const groundsExplicitValue = [...stateValues, ...genUiValues]
      .some((value) => normalizedPresentation.includes(normalizeScenarioEvidence(value)));
    const groundsDeclaredOutcome = predicate.textAnyOf
      .some((term) => normalizedText.includes(normalizeScenarioEvidence(term)));
    if (!groundsExplicitValue && !groundsDeclaredOutcome) {
      throw new Error(`${expectation.id} response is unrelated to declared ${predicate.anyOf.join('|')} evidence: ${text}`);
    }
  }
}
