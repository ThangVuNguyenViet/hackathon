export interface ProofRunSummary {
  runId: string;
  generatedAt: string;
  scenarioId: string;
  manifestPath: string;
  evaluationPath: string;
  screenshots: Array<{
    widgetKind: string;
    path: string;
    exists: boolean;
    turnIndex?: number;
    captureType?: string;
  }>;
}

export function selectLatestPassingRuns(
  runs: ProofRunSummary[],
  requiredScenarioIds: string[],
): ProofRunSummary[] {
  const selected = requiredScenarioIds.map((scenarioId) =>
    runs
      .filter((run) => run.scenarioId === scenarioId)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0],
  );
  const missing = requiredScenarioIds.filter((_, index) => !selected[index]);
  if (missing.length > 0) {
    throw new Error(`Missing passing evaluated GenUI proof for: ${missing.join(', ')}`);
  }
  return selected as ProofRunSummary[];
}
