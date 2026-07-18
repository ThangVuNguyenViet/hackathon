import type { EvaluationResult } from 'langsmith/evaluation';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import {
  contextEvalCases,
  contextEvalDatasetName,
  evaluateContextRun,
  type ContextEvalCase,
  type ContextEvalRunOutput,
  type ContextEvalScores,
} from './contextEvalCases.js';
import { evaluateContextCase } from './contextEvalRunner.js';

export const contextExperimentScoreKeys = [
  'context_relevance_pass',
  'forbidden_context_absent',
  'required_behavior_present',
  'forbidden_tools_absent',
  'required_tools_present',
  'state_mutation_allowed',
] as const satisfies readonly (keyof ContextEvalScores)[];

export interface ContextExperimentOptions {
  fixtures: GeneratedFixtures;
  mode: 'deterministic' | 'live';
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiPlannerModel?: string;
  openAiComposerModel?: string;
  fetchImpl?: typeof fetch;
  responseComposer?: ResponseComposer;
}

export interface ContextExperimentTargetOutput extends ContextEvalRunOutput {
  caseId: string;
  caseCategory: string;
}

export interface ContextExperimentEvaluatorInput {
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}

export interface ContextExperimentCliOptions {
  mode: 'deterministic' | 'live';
  experimentPrefix: string;
}

export function parseContextExperimentArgs(argv: string[]): ContextExperimentCliOptions {
  const options: ContextExperimentCliOptions = {
    mode: 'deterministic',
    experimentPrefix: 'kfc-context-eval',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const mode = argv[++index];
      if (mode !== 'deterministic' && mode !== 'live') throw new Error(`Unsupported mode: ${mode}`);
      options.mode = mode;
    } else if (arg === '--experiment-prefix') {
      options.experimentPrefix = argv[++index] ?? options.experimentPrefix;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function validateContextExperimentPrerequisites(input: {
  apiKey?: string;
  datasetExists: boolean;
}): void {
  if (!input.apiKey?.trim()) {
    throw new Error('LANGSMITH_API_KEY is required for the context experiment');
  }
  if (!input.datasetExists) {
    throw new Error(`LangSmith dataset not found: ${contextEvalDatasetName}`);
  }
}

function localContextCaseForInput(input: Record<string, any>): ContextEvalCase {
  const caseId = input.caseId;
  if (typeof caseId !== 'string') throw new Error('Context evaluation input must include a string caseId');

  const localCase = contextEvalCases.find((testCase) => testCase.inputs.caseId === caseId);
  if (!localCase) throw new Error(`Unknown context evaluation case: ${caseId}`);
  return localCase;
}

export function createContextExperimentTarget(options: ContextExperimentOptions) {
  return async (input: Record<string, any>): Promise<ContextExperimentTargetOutput> => {
    const testCase = localContextCaseForInput(input);
    const result = await evaluateContextCase({
      testCase,
      fixtures: options.fixtures,
      mode: options.mode,
      openAiApiKey: options.openAiApiKey,
      openAiBaseUrl: options.openAiBaseUrl,
      openAiPlannerModel: options.openAiPlannerModel,
      openAiComposerModel: options.openAiComposerModel,
      fetchImpl: options.fetchImpl,
      responseComposer: options.responseComposer,
    });

    return {
      caseId: result.caseId,
      caseCategory: result.caseCategory,
      ...result.output,
    };
  };
}

export function scoresToEvaluationResults(scores: ContextEvalScores): EvaluationResult[] {
  return contextExperimentScoreKeys.map((key) => ({
    key,
    score: scores[key] ? 1 : 0,
    value: scores[key],
  }));
}

export function createContextExperimentEvaluator() {
  return async (input: ContextExperimentEvaluatorInput): Promise<EvaluationResult[]> => {
    const testCase = localContextCaseForInput(input.inputs);
    const scores = evaluateContextRun(testCase, input.outputs as unknown as ContextEvalRunOutput);
    return scoresToEvaluationResults(scores);
  };
}
