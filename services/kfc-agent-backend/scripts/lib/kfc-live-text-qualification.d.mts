export type LiveAgentProvider = 'openai' | 'google';

export interface LiveTextQualificationIdentity {
  provider: LiveAgentProvider;
  model: string;
  profile: string;
}

export interface LiveTextQualificationRun {
  executionId: string;
  provider: LiveAgentProvider;
  repetition: number;
  mode: 'text';
  status: 'PASS';
  scenarioRuns: number;
  turnEvaluations: number;
  agent: LiveTextQualificationIdentity;
  outcomeJudge: LiveTextQualificationIdentity;
  report: { path: string; sha256: string };
  attestation: { path: string; sha256: string };
  startedAt: string;
  completedAt: string;
}

export interface LiveTextQualificationManifest {
  schemaVersion: 2;
  artifactKind: 'kfc-live-text-qualification';
  gitSha: string;
  inventory: {
    version: string;
    digest: string;
    scenarioCount: number;
    turnCount: number;
  };
  matrix: {
    mode: 'text';
    providers: readonly LiveAgentProvider[];
    repetitions: number;
    totalScenarioRuns: number;
    totalTurnEvaluations: number;
  };
  runs: LiveTextQualificationRun[];
  status: 'PASS';
  completedAt: string;
}

export const mandatoryLiveTextQualification: Readonly<{
  inventoryVersion: string;
  inventoryDigest: string;
  providers: readonly LiveAgentProvider[];
  repetitions: number;
  mode: 'text';
  scenariosPerExecution: number;
  turnEvaluationsPerExecution: number;
  totalScenarioRuns: number;
  totalTurnEvaluations: number;
  scenarioFiles: readonly string[];
  scenarioTurnIndexes: Readonly<Record<string, readonly number[]>>;
  profileByProvider: Readonly<
    Record<LiveAgentProvider, LiveTextQualificationIdentity>
  >;
}>;

export function qualificationSuiteName(
  provider: LiveAgentProvider,
  executionId: string,
  repetition: number,
): string;

export function assertCleanQualificationSource(
  repositoryRoot: string,
  expectedGitSha?: string,
): string;

export const officialOpenAiQualificationBaseUrl: string;
export function assertQualificationProviderEnvironment(
  environment: Record<string, string | undefined>,
): string;

export function assertLiveTextQualificationManifest(
  manifest: unknown,
  options: { expectedGitSha: string; manifestPath: string },
): LiveTextQualificationManifest;

export function assertLiveTextQualificationManifestFile(
  manifestPath: string,
  expectedGitSha: string,
): {
  manifest: LiveTextQualificationManifest;
  manifestSha256: string;
};
