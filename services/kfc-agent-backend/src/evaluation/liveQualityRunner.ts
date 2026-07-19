import { isDeepStrictEqual } from 'node:util';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_EXPECTED_EVALUATIONS_PER_PROVIDER,
  LIVE_QUALITY_EXPECTED_RUNS_PER_PROVIDER,
  LIVE_QUALITY_INVENTORY_VERSION,
  LIVE_QUALITY_REPETITIONS,
  type LiveQualityEvaluationScore,
  type LiveQualityExperimentOutput,
  type LiveQualityMode,
  type LiveQualityProvider,
  type LiveScenarioCase,
} from './liveQualityContracts.js';
import {
  buildLiveQualityDatasetCases,
  liveQualityInventoryDigest,
} from './liveQualityDataset.js';
import {
  evaluateLiveQualityModeParity,
  evaluateLiveQualityOutput,
  parseLiveQualityExperimentOutput,
} from './liveQualityEvaluators.js';

export interface LiveQualityScenarioRun {
  provider: LiveQualityProvider;
  repetition: number;
  scenarioFile: string;
  mode: LiveQualityMode;
  outputs: LiveQualityExperimentOutput[];
}

export interface LiveQualityTurnEvaluation {
  provider: LiveQualityProvider;
  repetition: number;
  scenarioFile: string;
  turnIndex: number;
  mode: LiveQualityMode;
  scores: LiveQualityEvaluationScore[];
}

export async function runLiveQualityMatrix(input: {
  scenarios: LiveScenarioCase[];
  run: (request: {
    provider: LiveQualityProvider;
    repetition: number;
    scenario: LiveScenarioCase;
    mode: LiveQualityMode;
  }) => Promise<LiveQualityExperimentOutput[]>;
}): Promise<{
  runs: LiveQualityScenarioRun[];
  evaluations: LiveQualityTurnEvaluation[];
  modeParity: Array<{
    provider: LiveQualityProvider;
    repetition: number;
    scenarioFile: string;
    turnIndex: number;
    score: LiveQualityEvaluationScore;
  }>;
  acceptanceIssues: string[];
  providerParityIssues: string[];
  passed: boolean;
}> {
  const inventoryDigest = liveQualityInventoryDigest(buildLiveQualityDatasetCases({
    inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
    scenarioCases: input.scenarios,
  }));
  if (inventoryDigest !== LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST) {
    throw new Error(`Refusing non-canonical live quality matrix ${inventoryDigest}`);
  }
  const requests = (['openai', 'gemini'] as const).flatMap((provider) =>
    Array.from({ length: LIVE_QUALITY_REPETITIONS }, (_, repetition) =>
      input.scenarios.flatMap((scenario) =>
        (['genui', 'text'] as const).map((mode) => ({
          provider,
          repetition: repetition + 1,
          scenario,
          mode,
        })),
      ),
    ).flat(),
  );
  const runs = await Promise.all(requests.map(async (request) => {
    const outputs = (await input.run(request)).map(parseLiveQualityExperimentOutput);
    if (outputs.length !== request.scenario.turnExpectations.length) {
      throw new Error(
        `${request.provider} repetition ${request.repetition} ${request.scenario.fileName} ` +
        `${request.mode} returned ${outputs.length} turns, expected ${request.scenario.turnExpectations.length}`,
      );
    }
    return {
      provider: request.provider,
      repetition: request.repetition,
      scenarioFile: request.scenario.fileName,
      mode: request.mode,
      outputs,
    };
  }));
  const evaluations = runs.flatMap((run) => {
    const scenario = input.scenarios.find(({ fileName }) => fileName === run.scenarioFile)!;
    return scenario.turnExpectations.map((expectation, index) => ({
      provider: run.provider,
      repetition: run.repetition,
      scenarioFile: run.scenarioFile,
      turnIndex: expectation.turnIndex,
      mode: run.mode,
      scores: evaluateLiveQualityOutput(expectation, run.outputs[index]!, run.mode),
    }));
  });
  for (const provider of ['openai', 'gemini'] as const) {
    const providerRuns = runs.filter((run) => run.provider === provider);
    const providerEvaluations = evaluations.filter((evaluation) => evaluation.provider === provider);
    if (providerRuns.length !== LIVE_QUALITY_EXPECTED_RUNS_PER_PROVIDER ||
      providerEvaluations.length !== LIVE_QUALITY_EXPECTED_EVALUATIONS_PER_PROVIDER) {
      throw new Error(`Invalid ${provider} qualification matrix`);
    }
  }
  const modeParity = input.scenarios.flatMap((scenario) =>
    (['openai', 'gemini'] as const).flatMap((provider) =>
      Array.from({ length: LIVE_QUALITY_REPETITIONS }, (_, repetitionIndex) => {
        const repetition = repetitionIndex + 1;
        const text = runs.find((run) =>
          run.provider === provider && run.repetition === repetition &&
          run.scenarioFile === scenario.fileName && run.mode === 'text')!;
        const genui = runs.find((run) =>
          run.provider === provider && run.repetition === repetition &&
          run.scenarioFile === scenario.fileName && run.mode === 'genui')!;
        return scenario.turnExpectations.map((expectation, index) => ({
          provider,
          repetition,
          scenarioFile: scenario.fileName,
          turnIndex: expectation.turnIndex,
          score: evaluateLiveQualityModeParity({
            expectation,
            text: text.outputs[index]!,
            genui: genui.outputs[index]!,
          }),
        }));
      }).flat(),
    ),
  );
  const providerParityIssues: string[] = [];
  for (const scenario of input.scenarios) {
    for (let repetition = 1; repetition <= LIVE_QUALITY_REPETITIONS; repetition += 1) {
      for (const mode of ['genui', 'text'] as const) {
        const openai = runs.find((run) =>
          run.provider === 'openai' && run.repetition === repetition &&
          run.scenarioFile === scenario.fileName && run.mode === mode)!;
        const gemini = runs.find((run) =>
          run.provider === 'gemini' && run.repetition === repetition &&
          run.scenarioFile === scenario.fileName && run.mode === mode)!;
        for (const [index, expectation] of scenario.turnExpectations.entries()) {
          const left = openai.outputs[index]!;
          const right = gemini.outputs[index]!;
          if (!isDeepStrictEqual(left.presentationFacts, right.presentationFacts) ||
            !isDeepStrictEqual(left.presentedCollections, right.presentedCollections)) {
            providerParityIssues.push(
              `${scenario.fileName}#${expectation.turnIndex}:${mode}:r${repetition} provider facts differ`,
            );
          }
        }
      }
    }
  }
  const acceptanceIssues = evaluations.flatMap((evaluation) => {
    const acceptance = evaluation.scores.find(({ key }) => key === 'acceptance');
    return acceptance?.score
      ? []
      : [
          `${evaluation.provider}:${evaluation.scenarioFile}#${evaluation.turnIndex}:` +
          `${evaluation.mode}:r${evaluation.repetition} ${acceptance?.comment ?? 'acceptance failed'}`,
        ];
  });
  const parityIssues = modeParity
    .filter(({ score: parity }) => !parity.score)
    .map(({ provider, scenarioFile, turnIndex, repetition, score: parity }) =>
      `${provider}:${scenarioFile}#${turnIndex}:r${repetition} ${parity.comment ?? 'mode parity failed'}`);
  return {
    runs,
    evaluations,
    modeParity,
    acceptanceIssues,
    providerParityIssues,
    passed:
      acceptanceIssues.length === 0 &&
      parityIssues.length === 0 &&
      providerParityIssues.length === 0,
  };
}
