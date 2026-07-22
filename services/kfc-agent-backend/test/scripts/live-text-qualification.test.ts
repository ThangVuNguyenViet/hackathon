import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { qualificationAgentModelProfiles } from '../../src/config/agentModelProfile.js';
import {
  buildLiveQualityDatasetCases,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import { LIVE_QUALITY_INVENTORY_VERSION } from '../../src/evaluation/liveQualityContracts.js';
import {
  assertLiveTextQualificationManifestFile,
  assertCleanQualificationSource,
  assertQualificationProviderEnvironment,
  mandatoryLiveTextQualification,
  officialOpenAiQualificationBaseUrl,
  qualificationSuiteName,
  type LiveAgentProvider,
  type LiveTextQualificationManifest,
} from '../../scripts/lib/kfc-live-text-qualification.mjs';
import {
  resolveQualificationConcurrency,
  runQualificationJobs,
} from '../../scripts/lib/kfc-qualification-concurrency.mjs';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

const gitSha = 'a'.repeat(40);
const temporaryDirectories: string[] = [];
const canonicalScenarioFiles = liveScenarioCases.map(
  ({ fileName }) => fileName,
);
const canonicalTurnIndexes = Object.fromEntries(
  liveScenarioCases.map(({ fileName, turnExpectations }) => [
    fileName,
    turnExpectations.map(({ turnIndex }) => turnIndex),
  ]),
);
const canonicalTurnCount = liveScenarioCases.reduce(
  (total, { turnExpectations }) => total + turnExpectations.length,
  0,
);
const canonicalInventoryDigest = liveQualityInventoryDigest(
  buildLiveQualityDatasetCases({
    inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
    scenarioCases: liveScenarioCases,
  }),
);

function advisoryRecord(
  scenarioCase: (typeof liveScenarioCases)[number],
  provider: LiveAgentProvider,
): Record<string, unknown> {
  const advisory = scenarioCase.advisory;
  if (!advisory) {
    return {
      criterionIds: [],
      policy: 'not_applicable',
      execution: 'not_run',
      status: 'not_run',
      outcomeJudgment: null,
      semanticConfirmation: {
        attempts: 0,
        triggered: false,
        trigger: null,
        finalStatus: 'not_run',
      },
      infrastructureExhausted: false,
      infrastructureError: null,
    };
  }
  if (provider === 'google') {
    return {
      criterionIds: advisory.criteria.map(({ id }) => id),
      policy: advisory.judgmentPolicy,
      execution: 'deferred',
      status: 'not_run',
      outcomeJudgment: null,
      semanticConfirmation: {
        attempts: 0,
        triggered: false,
        trigger: null,
        finalStatus: 'not_run',
      },
      infrastructureExhausted: false,
      infrastructureError: null,
    };
  }
  return {
    criterionIds: advisory.criteria.map(({ id }) => id),
    policy: advisory.judgmentPolicy,
    execution: 'completed',
    status: 'passed',
    outcomeJudgment: {
      passed: true,
      score: 100,
      achievedOutcome: 'Verified advisory outcome satisfied.',
      missedExpectations: [],
      safetyIssues: [],
      rationale: 'Redacted evidence supports the advisory criteria.',
    },
    semanticConfirmation: {
      attempts: 1,
      triggered: false,
      trigger: null,
      finalStatus: 'passed',
    },
    infrastructureExhausted: false,
    infrastructureError: null,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function executionId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function report(
  provider: LiveAgentProvider,
  id: string,
  repetition: number,
): Record<string, unknown> {
  const suiteName = qualificationSuiteName(provider, id, repetition);
  const assertionResults = canonicalScenarioFiles.map((fileName) => ({
    ancestorTitles: [suiteName],
    fullName: `${suiteName} ${fileName} [text]`,
    status: 'passed',
    title: `${fileName} [text]`,
    failureMessages: [],
  }));
  return {
    numTotalTests: assertionResults.length,
    numPassedTests: assertionResults.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [{ assertionResults }],
  };
}

function attestation(input: {
  provider: LiveAgentProvider;
  executionId: string;
  repetition: number;
  startedAt: string;
  completedAt: string;
}): Record<string, unknown> {
  const outcomeJudgeProvider: LiveAgentProvider =
    input.provider === 'openai' ? 'google' : 'openai';
  return {
    schemaVersion: 3,
    artifactKind: 'kfc-live-text-execution-attestation',
    executionId: input.executionId,
    gitSha,
    provider: input.provider,
    repetition: input.repetition,
    mode: 'text',
    agent: mandatoryLiveTextQualification.profileByProvider[input.provider],
    outcomeJudge:
      mandatoryLiveTextQualification.profileByProvider[outcomeJudgeProvider],
    inventory: {
      version: LIVE_QUALITY_INVENTORY_VERSION,
      digest: canonicalInventoryDigest,
      scenarioCount: liveScenarioCases.length,
      turnCount: canonicalTurnCount,
    },
    advisoryCalibration: {
      status: 'draft',
      reviewStatus: 'human_review_required',
    },
    scenarios: liveScenarioCases.map((scenarioCase) => ({
      fileName: scenarioCase.fileName,
      status: 'PASS',
      advisory: advisoryRecord(scenarioCase, input.provider),
      turns: scenarioCase.turnExpectations.map(({ id }, index) => ({
        id,
        status: 'PASS',
        durationMs: 1_000 + index,
        softTargetMs: 10_000,
        strictCutoffMs: 30_000,
      })),
    })),
    status: 'PASS',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

function fixture(): {
  directory: string;
  manifestPath: string;
  manifest: LiveTextQualificationManifest;
  reportPaths: string[];
  attestationPaths: string[];
} {
  const directory = mkdtempSync(join(tmpdir(), 'kfc-live-text-qualification-'));
  temporaryDirectories.push(directory);
  const runs: LiveTextQualificationManifest['runs'] = [];
  const reportPaths: string[] = [];
  const attestationPaths: string[] = [];
  let executionIndex = 0;
  for (
    let repetition = 1;
    repetition <= mandatoryLiveTextQualification.repetitions;
    repetition += 1
  ) {
    for (const provider of mandatoryLiveTextQualification.providers) {
      const outcomeJudgeProvider: LiveAgentProvider =
        provider === 'openai' ? 'google' : 'openai';
      executionIndex += 1;
      const id = executionId(executionIndex);
      const path = join(directory, `${provider}-text-${repetition}.json`);
      const attestationPath = join(
        directory,
        `${provider}-text-${repetition}-attestation.json`,
      );
      const startedAt = `2026-07-20T00:0${repetition}:00.000Z`;
      const completedAt = `2026-07-20T00:0${repetition}:30.000Z`;
      const contents = `${JSON.stringify(report(provider, id, repetition))}\n`;
      const attestationContents = `${JSON.stringify(
        attestation({
          provider,
          executionId: id,
          repetition,
          startedAt,
          completedAt,
        }),
      )}\n`;
      writeFileSync(path, contents);
      writeFileSync(attestationPath, attestationContents);
      reportPaths.push(path);
      attestationPaths.push(attestationPath);
      runs.push({
        executionId: id,
        provider,
        repetition,
        mode: 'text',
        status: 'PASS',
        scenarioRuns: liveScenarioCases.length,
        turnEvaluations: canonicalTurnCount,
        agent: mandatoryLiveTextQualification.profileByProvider[provider],
        outcomeJudge:
          mandatoryLiveTextQualification.profileByProvider[
            outcomeJudgeProvider
          ],
        report: {
          path: `${provider}-text-${repetition}.json`,
          sha256: sha256(contents),
        },
        attestation: {
          path: `${provider}-text-${repetition}-attestation.json`,
          sha256: sha256(attestationContents),
        },
        startedAt,
        completedAt,
      });
    }
  }
  const manifest: LiveTextQualificationManifest = {
    schemaVersion: 3,
    artifactKind: 'kfc-live-text-qualification',
    gitSha,
    inventory: {
      version: LIVE_QUALITY_INVENTORY_VERSION,
      digest: canonicalInventoryDigest,
      scenarioCount: liveScenarioCases.length,
      turnCount: canonicalTurnCount,
    },
    matrix: {
      mode: 'text',
      providers: mandatoryLiveTextQualification.providers,
      repetitions: mandatoryLiveTextQualification.repetitions,
      totalScenarioRuns:
        liveScenarioCases.length *
        mandatoryLiveTextQualification.providers.length *
        mandatoryLiveTextQualification.repetitions,
      totalTurnEvaluations:
        canonicalTurnCount *
        mandatoryLiveTextQualification.providers.length *
        mandatoryLiveTextQualification.repetitions,
    },
    runs,
    status: 'PASS',
    completedAt: '2026-07-20T00:04:00.000Z',
  };
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    directory,
    manifestPath,
    manifest,
    reportPaths,
    attestationPaths,
  };
}

function mutateFirstAttestation(
  candidate: ReturnType<typeof fixture>,
  mutate: (attestation: Record<string, unknown>) => void,
): void {
  const value: unknown = JSON.parse(
    readFileSync(candidate.attestationPaths[0]!, 'utf8'),
  );
  if (!isRecord(value)) throw new Error('invalid attestation fixture');
  mutate(value);
  const contents = `${JSON.stringify(value)}\n`;
  writeFileSync(candidate.attestationPaths[0]!, contents);
  candidate.manifest.runs[0]!.attestation.sha256 = sha256(contents);
  writeFileSync(
    candidate.manifestPath,
    `${JSON.stringify(candidate.manifest, null, 2)}\n`,
  );
}

function firstScenario(
  attestationValue: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !Array.isArray(attestationValue.scenarios) ||
    !isRecord(attestationValue.scenarios[0])
  ) {
    throw new Error('invalid scenario fixture');
  }
  return attestationValue.scenarios[0];
}

function firstAdvisoryScenario(
  attestationValue: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(attestationValue.scenarios)) {
    throw new Error('invalid scenario fixture');
  }
  const scenario = attestationValue.scenarios.find(
    (entry) =>
      isRecord(entry) &&
      isRecord(entry.advisory) &&
      entry.advisory.policy !== 'not_applicable',
  );
  if (!isRecord(scenario)) throw new Error('missing advisory scenario fixture');
  return scenario;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe('mandatory live text qualification artifact', () => {
  it('pins provider profiles without fixed inventory count gates', () => {
    expect(mandatoryLiveTextQualification).toMatchObject({
      providers: ['openai', 'google'],
      repetitions: 3,
      mode: 'text',
      profileByProvider: {
        openai: {
          provider: qualificationAgentModelProfiles.openai.provider,
          model: qualificationAgentModelProfiles.openai.model,
          profile: qualificationAgentModelProfiles.openai.profile,
        },
        google: {
          provider: qualificationAgentModelProfiles.google.provider,
          model: qualificationAgentModelProfiles.google.model,
          profile: qualificationAgentModelProfiles.google.profile,
        },
      },
    });
    expect(qualificationAgentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'HIGH',
    });
    expect(canonicalInventoryDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a semantically changed ledger with recomputed fingerprints', () => {
    const forgedCases = structuredClone(liveScenarioCases);
    forgedCases[0]!.turnExpectations[0]!.latency.maxTurnMs += 1;
    const forgedDigest = liveQualityInventoryDigest(
      buildLiveQualityDatasetCases({
        inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
        scenarioCases: forgedCases,
      }),
    );

    expect(forgedDigest).not.toBe(canonicalInventoryDigest);
  });

  it('accepts advisory warnings, evidence-only results, and inconclusive infrastructure exhaustion as nonblocking', () => {
    const candidate = fixture();
    mutateFirstAttestation(candidate, (value) => {
      const scenario = firstAdvisoryScenario(value);
      const advisory = scenario.advisory;
      if (!isRecord(advisory)) throw new Error('invalid advisory fixture');
      advisory.status = 'warning';
      const judgment = advisory.outcomeJudgment;
      if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
      judgment.passed = false;
      judgment.score = 50;
      const confirmation = advisory.semanticConfirmation;
      if (!isRecord(confirmation))
        throw new Error('invalid confirmation fixture');
      confirmation.attempts = 2;
      confirmation.triggered = true;
      confirmation.trigger = 'core_semantic_miss';
      confirmation.finalStatus = 'warning';
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).not.toThrow();

    const inconclusive = fixture();
    mutateFirstAttestation(inconclusive, (value) => {
      const scenario = firstAdvisoryScenario(value);
      const advisory = scenario.advisory;
      if (!isRecord(advisory)) throw new Error('invalid advisory fixture');
      advisory.status = 'inconclusive';
      advisory.outcomeJudgment = null;
      advisory.infrastructureExhausted = true;
      advisory.infrastructureError = 'Outcome judge request exhausted retries.';
      const confirmation = advisory.semanticConfirmation;
      if (!isRecord(confirmation))
        throw new Error('invalid confirmation fixture');
      confirmation.attempts = 2;
      confirmation.triggered = true;
      confirmation.trigger = 'high_risk_safety_or_availability_miss';
      confirmation.finalStatus = 'inconclusive';
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(
        inconclusive.manifestPath,
        gitSha,
      ),
    ).not.toThrow();
  });

  it('allows explicit deferred Gemini advisory evidence but rejects applicable OpenAI omission', () => {
    const deferredGemini = fixture();
    expect(() =>
      assertLiveTextQualificationManifestFile(
        deferredGemini.manifestPath,
        gitSha,
      ),
    ).not.toThrow();

    const omittedOpenAi = fixture();
    mutateFirstAttestation(omittedOpenAi, (value) => {
      const scenario = firstAdvisoryScenario(value);
      const advisory = scenario.advisory;
      if (!isRecord(advisory) || !isRecord(advisory.semanticConfirmation)) {
        throw new Error('invalid advisory fixture');
      }
      advisory.execution = 'not_run';
      advisory.status = 'not_run';
      advisory.outcomeJudgment = null;
      advisory.semanticConfirmation.attempts = 0;
      advisory.semanticConfirmation.triggered = false;
      advisory.semanticConfirmation.trigger = null;
      advisory.semanticConfirmation.finalStatus = 'not_run';
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(
        omittedOpenAi.manifestPath,
        gitSha,
      ),
    ).toThrow(/applicable OpenAI|execution/u);
  });

  it('strictly validates advisory policy, status, criterion IDs, and redacted judgments', () => {
    for (const mutate of [
      (advisory: Record<string, unknown>) => {
        advisory.policy = 'blocking';
      },
      (advisory: Record<string, unknown>) => {
        advisory.status = 'failed';
      },
      (advisory: Record<string, unknown>) => {
        advisory.criterionIds = ['unstable id'];
      },
      (advisory: Record<string, unknown>) => {
        advisory.criterionIds = ['advisory.03.unavailable-item-boundary'];
      },
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
        judgment.rationale = 'authorization: Bearer secret-value';
      },
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
        judgment.passed = false;
      },
    ]) {
      const candidate = fixture();
      mutateFirstAttestation(candidate, (value) => {
        const scenario = firstAdvisoryScenario(value);
        const advisory = scenario.advisory;
        if (!isRecord(advisory)) throw new Error('invalid advisory fixture');
        mutate(advisory);
      });
      expect(() =>
        assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
      ).toThrow(/advisory|redacted/u);
    }
  });

  it('rejects contradictory advisory status, judgment, score, and infrastructure semantics', () => {
    const contradictions = [
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
        judgment.missedExpectations = ['A required outcome was missed.'];
      },
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
        judgment.safetyIssues = ['A safety issue remains.'];
      },
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment)) throw new Error('invalid judgment fixture');
        judgment.score = 0;
      },
      (advisory: Record<string, unknown>) => {
        const judgment = advisory.outcomeJudgment;
        if (!isRecord(judgment) || !isRecord(advisory.semanticConfirmation)) {
          throw new Error('invalid warning fixture');
        }
        advisory.status = 'warning';
        advisory.semanticConfirmation.finalStatus = 'warning';
        judgment.passed = false;
        judgment.score = 100;
      },
      (advisory: Record<string, unknown>) => {
        if (!isRecord(advisory.semanticConfirmation)) {
          throw new Error('invalid inconclusive fixture');
        }
        advisory.status = 'inconclusive';
        advisory.infrastructureExhausted = true;
        advisory.infrastructureError =
          'Outcome judge request exhausted retries.';
        advisory.semanticConfirmation.finalStatus = 'inconclusive';
      },
      (advisory: Record<string, unknown>) => {
        if (!isRecord(advisory.semanticConfirmation)) {
          throw new Error('invalid inconclusive fixture');
        }
        advisory.status = 'inconclusive';
        advisory.outcomeJudgment = null;
        advisory.infrastructureExhausted = true;
        advisory.infrastructureError = null;
        advisory.semanticConfirmation.finalStatus = 'inconclusive';
      },
    ];
    for (const mutate of contradictions) {
      const candidate = fixture();
      mutateFirstAttestation(candidate, (value) => {
        const scenario = firstAdvisoryScenario(value);
        const advisory = scenario.advisory;
        if (!isRecord(advisory)) throw new Error('invalid advisory fixture');
        mutate(advisory);
      });
      expect(() =>
        assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
      ).toThrow(/advisory|judgment|score|infrastructure/u);
    }
  });

  it('requires coherent semantic confirmation and infrastructure exhaustion records', () => {
    const invalidConfirmation = fixture();
    mutateFirstAttestation(invalidConfirmation, (value) => {
      const scenario = firstAdvisoryScenario(value);
      const advisory = scenario.advisory;
      if (!isRecord(advisory) || !isRecord(advisory.semanticConfirmation)) {
        throw new Error('invalid confirmation fixture');
      }
      advisory.semanticConfirmation.attempts = 2;
      advisory.semanticConfirmation.triggered = false;
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(
        invalidConfirmation.manifestPath,
        gitSha,
      ),
    ).toThrow('semantic confirmation');

    const invalidExhaustion = fixture();
    mutateFirstAttestation(invalidExhaustion, (value) => {
      const scenario = firstAdvisoryScenario(value);
      const advisory = scenario.advisory;
      if (!isRecord(advisory)) throw new Error('invalid advisory fixture');
      advisory.status = 'inconclusive';
      advisory.outcomeJudgment = null;
      advisory.infrastructureExhausted = false;
      advisory.infrastructureError = 'Outcome judge request exhausted retries.';
      const confirmation = advisory.semanticConfirmation;
      if (!isRecord(confirmation))
        throw new Error('invalid confirmation fixture');
      confirmation.finalStatus = 'inconclusive';
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(
        invalidExhaustion.manifestPath,
        gitSha,
      ),
    ).toThrow(/inconclusive infrastructure|infrastructure exhaustion/u);
  });

  it('enforces measured per-turn duration with a 10s soft target and 30s strict cutoff', () => {
    const softTargetWarning = fixture();
    mutateFirstAttestation(softTargetWarning, (value) => {
      const scenario = firstScenario(value);
      if (!Array.isArray(scenario.turns) || !isRecord(scenario.turns[0])) {
        throw new Error('invalid turn fixture');
      }
      scenario.turns[0].durationMs = 15_000;
    });
    expect(() =>
      assertLiveTextQualificationManifestFile(
        softTargetWarning.manifestPath,
        gitSha,
      ),
    ).not.toThrow();

    for (const mutate of [
      (turn: Record<string, unknown>) => {
        turn.durationMs = -1;
      },
      (turn: Record<string, unknown>) => {
        turn.softTargetMs = 9_999;
      },
      (turn: Record<string, unknown>) => {
        turn.strictCutoffMs = 30_001;
      },
      (turn: Record<string, unknown>) => {
        turn.durationMs = 30_001;
      },
    ]) {
      const candidate = fixture();
      mutateFirstAttestation(candidate, (value) => {
        const scenario = firstScenario(value);
        if (!Array.isArray(scenario.turns) || !isRecord(scenario.turns[0])) {
          throw new Error('invalid turn fixture');
        }
        mutate(scenario.turns[0]);
      });
      expect(() =>
        assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
      ).toThrow(/duration|target|cutoff/u);
    }
  });

  it('blocks PASS when any hard scenario or turn status fails', () => {
    for (const target of ['scenario', 'turn'] as const) {
      const candidate = fixture();
      mutateFirstAttestation(candidate, (value) => {
        const scenario = firstScenario(value);
        if (target === 'scenario') {
          scenario.status = 'FAIL';
          return;
        }
        if (!Array.isArray(scenario.turns) || !isRecord(scenario.turns[0])) {
          throw new Error('invalid turn fixture');
        }
        scenario.turns[0].status = 'FAIL';
      });
      expect(() =>
        assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
      ).toThrow(/scenario|turn/u);
    }
  });

  it('rejects advisory calibration drafts at qualification intake', () => {
    const draft: unknown = JSON.parse(
      readFileSync(
        'fixtures/evaluation/openai-advisory-outcome-calibration-draft.json',
        'utf8',
      ),
    );
    expect(() =>
      assertLiveTextQualificationManifestFile(
        'fixtures/evaluation/openai-advisory-outcome-calibration-draft.json',
        gitSha,
      ),
    ).toThrow('not qualification or release evidence');
    expect(draft).toMatchObject({
      status: 'draft',
      review_status: 'human_review_required',
    });
  });

  it('accepts source-bound inventories without fixed scenario, turn, or digest gates', () => {
    const candidate = fixture();
    const digest = 'b'.repeat(64);
    candidate.manifest.inventory.digest = digest;
    candidate.manifest.inventory.scenarioCount -= 1;
    const removedTurnCount = liveScenarioCases.at(-1)!.turnExpectations.length;
    candidate.manifest.inventory.turnCount -= removedTurnCount;
    candidate.manifest.matrix.totalScenarioRuns -=
      candidate.manifest.runs.length;
    candidate.manifest.matrix.totalTurnEvaluations -=
      removedTurnCount * candidate.manifest.runs.length;

    candidate.manifest.runs.forEach((run, index) => {
      run.scenarioRuns -= 1;
      run.turnEvaluations -= removedTurnCount;
      const attestationValue: unknown = JSON.parse(
        readFileSync(candidate.attestationPaths[index]!, 'utf8'),
      );
      if (
        !isRecord(attestationValue) ||
        !isRecord(attestationValue.inventory) ||
        !Array.isArray(attestationValue.scenarios)
      ) {
        throw new Error('invalid attestation fixture');
      }
      attestationValue.inventory.digest = digest;
      attestationValue.inventory.scenarioCount = run.scenarioRuns;
      attestationValue.inventory.turnCount = run.turnEvaluations;
      attestationValue.scenarios.pop();
      const attestationContents = `${JSON.stringify(attestationValue)}\n`;
      writeFileSync(candidate.attestationPaths[index]!, attestationContents);
      run.attestation.sha256 = sha256(attestationContents);

      const reportValue = report(run.provider, run.executionId, run.repetition);
      if (
        !Array.isArray(reportValue.testResults) ||
        !isRecord(reportValue.testResults[0]) ||
        !Array.isArray(reportValue.testResults[0].assertionResults)
      ) {
        throw new Error('invalid report fixture');
      }
      reportValue.testResults[0].assertionResults.pop();
      reportValue.numTotalTests = run.scenarioRuns;
      reportValue.numPassedTests = run.scenarioRuns;
      const reportContents = `${JSON.stringify(reportValue)}\n`;
      writeFileSync(candidate.reportPaths[index]!, reportContents);
      run.report.sha256 = sha256(reportContents);
    });
    writeFileSync(
      candidate.manifestPath,
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
    );

    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).not.toThrow();
  });

  it('accepts only six exact provider/repetition reports bound to one SHA', () => {
    const candidate = fixture();
    const firstRun = candidate.manifest.runs[0]!;
    const reordered = report(
      firstRun.provider,
      firstRun.executionId,
      firstRun.repetition,
    );
    const testResults = reordered.testResults;
    if (!Array.isArray(testResults) || !isRecord(testResults[0])) {
      throw new Error('invalid report test fixture');
    }
    const firstResult = testResults[0];
    if (!Array.isArray(firstResult.assertionResults)) {
      throw new Error('invalid assertion test fixture');
    }
    firstResult.assertionResults.reverse();
    const reorderedContents = `${JSON.stringify(reordered)}\n`;
    writeFileSync(candidate.reportPaths[0]!, reorderedContents);
    candidate.manifest.runs[0]!.report.sha256 = sha256(reorderedContents);
    writeFileSync(
      candidate.manifestPath,
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
    );
    const validated = assertLiveTextQualificationManifestFile(
      candidate.manifestPath,
      gitSha,
    );

    expect(validated.manifest.runs).toHaveLength(6);
    expect(validated.manifest.matrix).toEqual({
      mode: 'text',
      providers: ['openai', 'google'],
      repetitions: 3,
      totalScenarioRuns:
        liveScenarioCases.length *
        mandatoryLiveTextQualification.providers.length *
        mandatoryLiveTextQualification.repetitions,
      totalTurnEvaluations:
        canonicalTurnCount *
        mandatoryLiveTextQualification.providers.length *
        mandatoryLiveTextQualification.repetitions,
    });
    expect(validated.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects an incomplete matrix and any attempt to count optional GenUI', () => {
    const candidate = fixture();
    candidate.manifest.runs.pop();
    writeFileSync(
      candidate.manifestPath,
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
    );
    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).toThrow('matrix is incomplete');

    const second = fixture();
    const forged: unknown = structuredClone(second.manifest);
    if (!isRecord(forged) || !isRecord(forged.matrix)) {
      throw new Error('invalid manifest test fixture');
    }
    forged.matrix.mode = 'genui';
    writeFileSync(second.manifestPath, `${JSON.stringify(forged, null, 2)}\n`);
    expect(() =>
      assertLiveTextQualificationManifestFile(second.manifestPath, gitSha),
    ).toThrow('must be OpenAI and Google text mode x3');
  });

  it('rejects changed or non-passing raw Vitest evidence', () => {
    const candidate = fixture();
    writeFileSync(
      candidate.reportPaths[0]!,
      `${JSON.stringify({
        ...report(
          candidate.manifest.runs[0]!.provider,
          candidate.manifest.runs[0]!.executionId,
          candidate.manifest.runs[0]!.repetition,
        ),
        numPassedTests: 8,
        numFailedTests: 1,
        success: false,
      })}\n`,
    );

    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).toThrow('report digest mismatch');

    const changedContents = readFileSync(candidate.reportPaths[0]!, 'utf8');
    candidate.manifest.runs[0]!.report.sha256 = sha256(changedContents);
    writeFileSync(
      candidate.manifestPath,
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
    );
    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).toThrow(
      `is not an exact ${liveScenarioCases.length}/${liveScenarioCases.length} pass`,
    );
  });

  it('rejects copied or relabeled execution evidence', () => {
    const candidate = fixture();
    const firstContents = readFileSync(candidate.reportPaths[0]!, 'utf8');
    writeFileSync(candidate.reportPaths[1]!, firstContents);
    candidate.manifest.runs[1]!.report.sha256 = sha256(firstContents);
    writeFileSync(
      candidate.manifestPath,
      `${JSON.stringify(candidate.manifest, null, 2)}\n`,
    );

    expect(() =>
      assertLiveTextQualificationManifestFile(candidate.manifestPath, gitSha),
    ).toThrow(/assertion evidence|attested text scenarios/u);

    const second = fixture();
    const forgedAttestation: unknown = JSON.parse(
      readFileSync(second.attestationPaths[0]!, 'utf8'),
    );
    if (!isRecord(forgedAttestation)) {
      throw new Error('invalid attestation test fixture');
    }
    forgedAttestation.provider = 'google';
    const forgedContents = `${JSON.stringify(forgedAttestation)}\n`;
    writeFileSync(second.attestationPaths[0]!, forgedContents);
    second.manifest.runs[0]!.attestation.sha256 = sha256(forgedContents);
    writeFileSync(
      second.manifestPath,
      `${JSON.stringify(second.manifest, null, 2)}\n`,
    );
    expect(() =>
      assertLiveTextQualificationManifestFile(second.manifestPath, gitSha),
    ).toThrow('execution attestation identity mismatch');
  });

  it('requires a clean source checkout and detects post-preflight dirtiness', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'kfc-live-text-qualification-git-'),
    );
    temporaryDirectories.push(directory);
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    writeFileSync(join(directory, 'tracked.txt'), 'clean\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=KFC Qualification Test',
        '-c',
        'user.email=kfc-qualification@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'test fixture',
      ],
      { cwd: directory },
    );
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();

    expect(assertCleanQualificationSource(directory, head)).toBe(head);
    expect(() =>
      assertCleanQualificationSource(directory, 'b'.repeat(40)),
    ).toThrow('source SHA mismatch');
    writeFileSync(join(directory, 'untracked.txt'), 'dirty\n');
    expect(() => assertCleanQualificationSource(directory, head)).toThrow(
      'requires a clean checkout',
    );
  });

  it('allows only the official OpenAI endpoint for exact-provider evidence', () => {
    expect(assertQualificationProviderEnvironment({})).toBe(
      officialOpenAiQualificationBaseUrl,
    );
    expect(
      assertQualificationProviderEnvironment({
        OPENAI_BASE_URL: 'https://api.openai.com/v1/',
      }),
    ).toBe(officialOpenAiQualificationBaseUrl);
    expect(() =>
      assertQualificationProviderEnvironment({
        OPENAI_BASE_URL: 'https://compatible.example/v1',
      }),
    ).toThrow('requires the official OpenAI endpoint');
    expect(() =>
      assertQualificationProviderEnvironment({
        OPENAI_BASE_URL: 'https://api.openai.com/v1?proxy=true',
      }),
    ).toThrow('requires the official OpenAI endpoint');
  });

  it('runs the provider matrix with bounded parallelism and per-provider quotas', async () => {
    const concurrency = resolveQualificationConcurrency({}, 6);
    expect(concurrency).toEqual({
      maximum: 2,
      providerMaximum: { openai: 1, google: 1 },
    });
    const active = { total: 0, openai: 0, google: 0 };
    const observedMaximum = { total: 0, openai: 0, google: 0 };
    const jobs = Array.from({ length: 3 }, (_unused, index) => [
      { provider: 'openai' as const, id: `openai-${index + 1}` },
      { provider: 'google' as const, id: `google-${index + 1}` },
    ]).flat();

    const results = await runQualificationJobs(
      jobs,
      concurrency,
      async (job) => {
        active.total += 1;
        active[job.provider] += 1;
        observedMaximum.total = Math.max(observedMaximum.total, active.total);
        observedMaximum[job.provider] = Math.max(
          observedMaximum[job.provider],
          active[job.provider],
        );
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        active.total -= 1;
        active[job.provider] -= 1;
        return job.id;
      },
    );

    expect(observedMaximum).toEqual({
      total: 2,
      openai: 1,
      google: 1,
    });
    expect(results).toEqual(jobs.map(({ id }) => id));
    expect(() =>
      resolveQualificationConcurrency(
        {
          KFC_LIVE_TEXT_QUALIFICATION_MAX_CONCURRENCY: '0',
        },
        6,
      ),
    ).toThrow('must be an integer between 1 and 6');
  });

  it('wires mandatory text proof separately from optional GenUI proof', () => {
    const runner = readFileSync(
      'scripts/run-live-text-qualification.mjs',
      'utf8',
    );
    const qualificationLibrary = readFileSync(
      'scripts/lib/kfc-live-text-qualification.mjs',
      'utf8',
    );
    const packageJson: unknown = JSON.parse(
      readFileSync('package.json', 'utf8'),
    );
    if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) {
      throw new Error('package.json scripts are missing');
    }
    const workflow = readFileSync(
      '../../.github/workflows/kfc-genui.yml',
      'utf8',
    );
    const acceptance = readFileSync(
      '../../scripts/run-kfc-deployed-acceptance.sh',
      'utf8',
    );
    const checks = readFileSync(
      '../../scripts/lib/kfc-acceptance-checks.mjs',
      'utf8',
    );

    expect(runner).toContain("KFC_LIVE_SCENARIO_MODE: 'text'");
    expect(runner).toContain("KFC_AGENT_PROFILE_MODE: 'qualification'");
    expect(runner).not.toContain("KFC_LIVE_SCENARIO_MODE: 'both'");
    const replay = readFileSync(
      'test/scenarios/live-ai-scenario-replay.test.ts',
      'utf8',
    );
    expect(replay).toContain(
      'KFC live qualification requires KFC_AGENT_PROFILE_MODE=qualification',
    );
    expect(replay).toContain('process.env.KFC_LIVE_FOCUSED_TURN_ID');
    expect(replay).toContain('assertFocusedLiveScenarioCanaryPreconditions({');
    expect(
      replay.indexOf('assertFocusedLiveScenarioCanaryPreconditions({'),
    ).toBeLessThan(replay.indexOf('function agentModelForSelectedExecution()'));
    expect(replay).toContain(
      'focused live turn cannot run during qualification',
    );
    expect(replay).toContain(
      'focused live turn requires KFC_LIVE_SCENARIO_MODE=text',
    );
    expect(replay).toContain(
      'focused live turn requires KFC_LIVE_HIGH_RISK_REPETITIONS=1',
    );
    expect(replay).toContain(
      'focused live turn must be the first turn in its canonical scenario',
    );
    expect(replay).toContain('const focusedScript = (() => {');
    expect(replay).toContain('userTurns: [canonicalUserTurn],');
    expect(replay).toContain('const evaluator = focusedTurn');
    expect(replay).toMatch(
      /createSemanticResponseJudge\(\s*outcomeJudgeModelForSelectedExecution\(\),/u,
    );
    expect(replay).toMatch(
      /expect\(output\.executedTools\.map\(\(\{ toolName \}\) => toolName\)\)\.toEqual\(\[\s*'getRecentOrder',\s*\]\);/u,
    );
    expect(replay).toContain(
      'const liveTraceFlushHookTimeoutMs = 10 * 60_000;',
    );
    expect(replay).toContain('}, liveTraceFlushHookTimeoutMs);');
    expect(
      replay.match(/mode: agentProfileMode,/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(replay).toContain('outcomeJudgeModel');
    expect(replay).toContain('schemaVersion: 3');
    expect(replay).toContain('advisoryCalibration: {');
    expect(replay).toContain("reviewStatus: 'human_review_required'");
    expect(replay).toContain('criterionIds:');
    expect(replay).toContain('semanticConfirmation: {');
    expect(replay).toContain('infrastructureExhausted:');
    expect(replay).toMatch(
      /outcomeJudgment:\s*status === 'inconclusive'\s*\?\s*null\s*:/u,
    );
    expect(replay).toContain('durationMs:');
    expect(replay).toContain('softTargetMs: 10_000');
    expect(replay).toContain('strictCutoffMs: 30_000');
    expect(runner).toContain('runQualificationJobs(');
    expect(runner).toContain(
      'assertQualificationEvidenceIsNotAdvisoryCalibrationDraft,',
    );
    expect(runner).toContain(
      'assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(attestation);',
    );
    expect(qualificationLibrary).toContain(
      'export function assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(',
    );
    expect(
      qualificationLibrary.indexOf(
        'assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(manifest);',
      ),
    ).toBeLessThan(
      qualificationLibrary.indexOf(
        "const value = assertObject(manifest, 'live text qualification manifest');",
      ),
    );
    expect(runner).toContain("'--maxConcurrency=9'");
    expect(
      runner.match(
        /assertCleanQualificationSource\(repositoryRoot, gitSha\)/gu,
      ),
    ).toHaveLength(4);
    expect(
      runner.indexOf(
        'assertLiveTextQualificationManifestFile(\n  temporaryManifestPath',
      ),
    ).toBeLessThan(
      runner.indexOf('renameSync(temporaryManifestPath, manifestPath)'),
    );
    expect(packageJson.scripts['test:live:qualification:text']).toBe(
      'node scripts/run-live-text-qualification.mjs',
    );
    expect(packageJson.scripts['test:live:scenarios']).toContain(
      'RUN_LIVE_AI_SCENARIOS=1',
    );
    expect(packageJson.scripts['test:live:scenarios']).toContain(
      '--maxConcurrency=9',
    );
    expect(workflow).toContain(
      'Run mandatory OpenAI and Google text qualification (3 repetitions)',
    );
    expect(workflow).toContain('npm run test:live:qualification:text');
    expect(workflow).toContain('KFC_LIVE_ADVISORY_CANARY: "1"');
    expect(workflow).toContain('Upload mandatory text qualification artifact');
    expect(workflow).not.toContain('Run canonical live qualification');
    expect(acceptance).toContain('npm run test:live:qualification:text');
    expect(acceptance).toContain('npm run test:live:genui:integration');
    expect(checks).toContain('assertLiveTextQualificationManifestFile');
  });

  it('offers isolated focused runtime canaries without changing the default full dispatch', () => {
    const workflow = readFileSync(
      '../../.github/workflows/kfc-genui.yml',
      'utf8',
    );

    expect(workflow).toContain('description: Live execution scope');
    expect(workflow).toContain('default: full-qualification');
    expect(workflow).toContain('- full-qualification');
    expect(workflow).toContain('- focused-runtime');
    expect(workflow).toContain("inputs.execution == 'full-qualification'");
    expect(workflow).toContain("inputs.execution == 'focused-runtime'");

    const focusedJob = workflow.match(
      /  focused-runtime-canaries:\n(?<job>[\s\S]*?)(?=\n  [a-z][a-z0-9-]+:|\s*$)/u,
    )?.groups?.job;
    expect(focusedJob).toBeDefined();
    expect(focusedJob).toContain(
      'LANGSMITH_PROJECT: kfc-ticket49-${{ github.sha }}',
    );
    expect(focusedJob).toContain('KFC_LIVE_FORCE_FIRST_RETRY: "1"');
    expect(
      focusedJob?.match(/KFC_LIVE_HIGH_RISK_REPETITIONS: "1"/gu) ?? [],
    ).toHaveLength(1);
    expect(focusedJob).toContain('KFC_LIVE_SCENARIO_MODE: text');
    expect(focusedJob).toContain(
      'KFC_LIVE_FOCUSED_TURN_ID: 07-ca-nhan-hoa-va-loyalty.json#1',
    );
    expect(focusedJob).not.toContain('--testNamePattern');
    expect(focusedJob).toContain('provider: openai');
    expect(focusedJob).toContain('model: gpt-5-mini-2025-08-07');
    expect(focusedJob).toContain('provider: google');
    expect(focusedJob).toContain('model: gemini-3.1-flash-lite');
    expect(focusedJob).toContain('fail-fast: false');
    expect(focusedJob).toContain('KFC_AGENT_PROVIDER: ${{ matrix.provider }}');
    expect(focusedJob).toContain('KFC_AGENT_MODEL: ${{ matrix.model }}');
    expect(focusedJob).toContain('--reporter=json');
    expect(focusedJob).toContain('openai-scenario-07.json');
    expect(focusedJob).toContain('google-scenario-07.json');
    expect(focusedJob).toContain('actions/upload-artifact@v4');
    expect(focusedJob).not.toContain('npm run test:live:qualification:text');
    expect(focusedJob).not.toContain('npm run test:live:interruption');
  });
});
