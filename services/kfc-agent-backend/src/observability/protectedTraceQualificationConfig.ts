import {
  currentLiveQualityProtectedTracePolicy,
  type ProtectedTraceRuntimeIdentity,
} from '../evaluation/protectedTraceQualificationPolicy.js';
import type { RequiredAgentTraceContext } from './requiredAgentTracePublication.js';

export interface ProtectedTraceQualificationConfig {
  outputPath: string;
  context: RequiredAgentTraceContext;
}

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error('protected_trace_qualification_config_invalid');
  return value;
}

export function resolveProtectedTraceQualificationConfig(
  env: NodeJS.ProcessEnv,
  runtime: ProtectedTraceRuntimeIdentity,
): ProtectedTraceQualificationConfig | undefined {
  const outputPath = env.KFC_PROTECTED_TRACE_RECEIPT_OUTPUT?.trim();
  if (!outputPath) return undefined;
  const executionId = required(env, 'KFC_PROTECTED_TRACE_EXECUTION_ID');
  const gitSha = required(env, 'KFC_PROTECTED_TRACE_GIT_SHA');
  const remoteDatasetId = required(env, 'KFC_PROTECTED_TRACE_REMOTE_DATASET_ID');
  const mode = required(env, 'KFC_LIVE_SCENARIO_MODE');
  const repetitionText = required(env, 'KFC_PROTECTED_TRACE_REPETITION');
  const repetition = Number(repetitionText);
  if (
    !UUID_PATTERN.test(executionId) ||
    !UUID_PATTERN.test(remoteDatasetId) ||
    !GIT_SHA_PATTERN.test(gitSha) ||
    (mode !== 'text' && mode !== 'genui') ||
    !Number.isSafeInteger(repetition) ||
    repetition < 1 ||
    repetition > currentLiveQualityProtectedTracePolicy.repetitionsPerMode
  ) {
    throw new Error('protected_trace_qualification_config_invalid');
  }
  return {
    outputPath,
    context: {
      executionId,
      gitSha,
      runtime,
      policy: currentLiveQualityProtectedTracePolicy,
      remoteDatasetId,
      mode,
      repetition,
    },
  };
}
