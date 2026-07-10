export interface GenUiExpectedTurn {
  turnIndex: number;
  text: string;
  useCases: string[];
  expectedWidgetKind: string;
}

export interface GenUiScenarioExpectation {
  scenarioId: string;
  requiredWidgetKinds: string[];
  turns: GenUiExpectedTurn[];
}

export interface GenUiProofManifest {
  runId: string;
  generatedAt: string;
  liveAi: boolean;
  passed: boolean;
  artifactRoot: string;
  screenshots: Array<{
    scenario: string;
    turnIndex?: number;
    widgetKind: string;
    path: string;
    exists: boolean;
  }>;
  dashboardTelemetry: Array<{
    sessionId: string;
    turns: Array<{
      role: 'user' | 'assistant' | string;
      text: string;
      widgetKind: string | null;
    }>;
  }>;
}

export interface GenUiScenarioEvaluation {
  scenarioId: string;
  useCases: string[];
  expectedWidgetKinds: string[];
  observedWidgetKinds: string[];
  artifactPaths: string[];
  scores: {
    widgetCorrectness: 0 | 1;
    lifecycleCoverage: 0 | 1;
    screenshotCompleteness: 0 | 1;
    forbiddenHandoff: 0 | 1;
    conciseWidgetResponses: 0 | 1;
  };
  failures: string[];
}

export interface GenUiProofEvaluation {
  runId: string;
  generatedAt: string;
  passed: boolean;
  scenarioCount: number;
  passedScenarioCount: number;
  artifactRoot: string;
  scenarios: GenUiScenarioEvaluation[];
}

export function evaluateGenUiProof(
  manifest: GenUiProofManifest,
  expectations: GenUiScenarioExpectation[],
): GenUiProofEvaluation {
  const scenarios = expectations.map((expectation) => evaluateScenario(manifest, expectation));
  const passedScenarioCount = scenarios.filter((scenario) => scenario.failures.length === 0).length;

  return {
    runId: manifest.runId,
    generatedAt: new Date().toISOString(),
    passed: passedScenarioCount === scenarios.length,
    scenarioCount: scenarios.length,
    passedScenarioCount,
    artifactRoot: manifest.artifactRoot,
    scenarios,
  };
}

function evaluateScenario(
  manifest: GenUiProofManifest,
  expectation: GenUiScenarioExpectation,
): GenUiScenarioEvaluation {
  const telemetry = manifest.dashboardTelemetry.find((entry) => entry.sessionId.includes(expectation.scenarioId));
  const transcript = telemetry?.turns ?? [];
  const observedWidgetKinds = transcript
    .filter((turn) => turn.role === 'assistant' && turn.widgetKind)
    .map((turn) => turn.widgetKind as string);
  const observedWidgetSet = new Set(observedWidgetKinds);
  const failures: string[] = [];
  const alignedTurns: Array<{ expected: GenUiExpectedTurn; observedWidgetKind: string | null }> = [];
  let transcriptCursor = 0;

  for (const expected of expectation.turns) {
    const userIndex = transcript.findIndex(
      (turn, index) =>
        index >= transcriptCursor && turn.role === 'user' && normalizeText(turn.text) === normalizeText(expected.text),
    );
    if (userIndex < 0) {
      failures.push(`turn ${expected.turnIndex} was not found in the live transcript`);
      alignedTurns.push({ expected, observedWidgetKind: null });
      continue;
    }
    const assistantIndex = transcript.findIndex((turn, index) => index > userIndex && turn.role === 'assistant');
    const observedWidgetKind = assistantIndex >= 0 ? transcript[assistantIndex]?.widgetKind ?? null : null;
    transcriptCursor = assistantIndex >= 0 ? assistantIndex + 1 : userIndex + 1;
    alignedTurns.push({ expected, observedWidgetKind });

    const expectedWidgetKind = expected.expectedWidgetKind === 'chatTranscript' ? null : expected.expectedWidgetKind;
    if (observedWidgetKind !== expectedWidgetKind) {
      failures.push(
        `turn ${expected.turnIndex} expected ${expected.expectedWidgetKind} but observed ${observedWidgetKind ?? 'chatTranscript'}`,
      );
    }
    if (observedWidgetKind === 'supportHandoff' && expectedWidgetKind !== 'supportHandoff') {
      failures.push(`turn ${expected.turnIndex} emitted forbidden supportHandoff`);
    }
  }

  for (const requiredWidgetKind of expectation.requiredWidgetKinds) {
    if (!observedWidgetSet.has(requiredWidgetKind)) {
      failures.push(`missing required widget ${requiredWidgetKind}`);
    }
  }

  const screenshots = manifest.screenshots.filter(
    (screenshot) => screenshot.scenario === expectation.scenarioId && screenshot.turnIndex !== undefined,
  );
  for (const expected of expectation.turns) {
    const screenshot = screenshots.find((candidate) => candidate.turnIndex === expected.turnIndex);
    if (!screenshot?.exists) failures.push(`missing screenshot for turn ${expected.turnIndex}`);
  }

  const verboseWidgetTurn = transcript.find(
    (turn) => turn.role === 'assistant' && turn.widgetKind && turn.text.length > 420,
  );
  if (verboseWidgetTurn) failures.push('GenUI response exceeded 420 characters');

  const widgetCorrectness = alignedTurns.every(({ expected, observedWidgetKind }) => {
    const expectedWidgetKind = expected.expectedWidgetKind === 'chatTranscript' ? null : expected.expectedWidgetKind;
    return observedWidgetKind === expectedWidgetKind;
  });
  const lifecycleCoverage = expectation.requiredWidgetKinds.every((kind) => observedWidgetSet.has(kind));
  const screenshotCompleteness = expectation.turns.every((turn) =>
    screenshots.some((screenshot) => screenshot.turnIndex === turn.turnIndex && screenshot.exists),
  );
  const forbiddenHandoff = alignedTurns.every(
    ({ expected, observedWidgetKind }) =>
      observedWidgetKind !== 'supportHandoff' || expected.expectedWidgetKind === 'supportHandoff',
  );

  return {
    scenarioId: expectation.scenarioId,
    useCases: [...new Set(expectation.turns.flatMap((turn) => turn.useCases))],
    expectedWidgetKinds: expectation.turns.map((turn) => turn.expectedWidgetKind),
    observedWidgetKinds,
    artifactPaths: screenshots.filter((screenshot) => screenshot.exists).map((screenshot) => screenshot.path),
    scores: {
      widgetCorrectness: score(widgetCorrectness),
      lifecycleCoverage: score(lifecycleCoverage),
      screenshotCompleteness: score(screenshotCompleteness),
      forbiddenHandoff: score(forbiddenHandoff),
      conciseWidgetResponses: score(!verboseWidgetTurn),
    },
    failures,
  };
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function score(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
