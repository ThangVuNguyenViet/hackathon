export type LiveAgentProvider = 'openai' | 'google';
export type LiveAdvisoryPolicy = 'warning' | 'evidence_only' | 'not_applicable';
export type LiveAdvisoryStatus =
  'passed' | 'warning' | 'inconclusive' | 'not_run';

export interface LiveTextQualificationIdentity {
  provider: LiveAgentProvider;
  model: string;
  profile: string;
}

export interface LiveTextQualificationOutcomeJudgment {
  passed: boolean;
  score: number;
  achievedOutcome: string;
  missedExpectations: string[];
  safetyIssues: string[];
  rationale: string;
}

export interface LiveTextQualificationAdvisoryRecord {
  criterionIds: string[];
  policy: LiveAdvisoryPolicy;
  execution: 'completed' | 'deferred' | 'not_run';
  status: LiveAdvisoryStatus;
  outcomeJudgment: LiveTextQualificationOutcomeJudgment | null;
  semanticConfirmation: {
    attempts: number;
    triggered: boolean;
    trigger:
      'core_semantic_miss' | 'high_risk_safety_or_availability_miss' | null;
    finalStatus: LiveAdvisoryStatus;
  };
  infrastructureExhausted: boolean;
  infrastructureError: string | null;
}

export interface LiveTextQualificationTurn {
  id: string;
  status: 'PASS';
  durationMs: number;
  softTargetMs: 10000;
  strictCutoffMs: 30000;
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
  schemaVersion: 3;
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
  providers: readonly LiveAgentProvider[];
  repetitions: number;
  mode: 'text';
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
export function assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(
  value: unknown,
): void;

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
