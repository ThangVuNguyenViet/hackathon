export const maximumCanonicalScenarioTurnIndex = 15;

export function boundedCanonicalScenarioTurnIndex(
  value: unknown,
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maximumCanonicalScenarioTurnIndex
    ? value
    : undefined;
}
