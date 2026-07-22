import type { ProofRuntimeBinding } from '../proof/kfcGenUiDeployedProof.js';

export interface ProofRunSummary {
  runId: string;
  generatedAt: string;
  scenarioId: string;
  manifestPath: string;
  evaluationPath: string;
  runtime: ProofRuntimeBinding;
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
  const passingRuns = selected as ProofRunSummary[];
  assertSameRuntimeBinding(passingRuns);
  return passingRuns;
}

export function assertSameRuntimeBinding(runs: ProofRunSummary[]): void {
  const [first, ...rest] = runs;
  if (!first) return;
  const expected = canonicalRuntimeBinding(first.runtime);
  const mismatched = rest.find((run) => canonicalRuntimeBinding(run.runtime) !== expected);
  if (mismatched) {
    throw new Error(
      `Cannot consolidate mixed agent runtime identities: ${first.runId} and ${mismatched.runId}`,
    );
  }
}

function canonicalRuntimeBinding(runtime: ProofRuntimeBinding): string {
  return JSON.stringify(sortJsonValue({
    deployment: runtime.deployment,
    commerceEnvironment: runtime.commerceEnvironment,
    providerFingerprint: runtime.providerFingerprint,
    catalogObservation: {
      id: runtime.catalogObservation.id,
      sha256: runtime.catalogObservation.sha256,
      itemCount: runtime.catalogObservation.itemCount,
      modifierTreeCount: runtime.catalogObservation.modifierTreeCount,
    },
    lifecycle: runtime.lifecycle,
    graph: runtime.graph,
    versions: runtime.versions,
  }));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}
