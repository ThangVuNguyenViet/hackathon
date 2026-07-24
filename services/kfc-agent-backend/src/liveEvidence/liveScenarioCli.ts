import { resolve } from 'node:path';
import {
  resolveAgentModelProfile,
  type AgentModelCandidateId,
} from '../config/agentModelProfile.js';

export interface LiveScenarioCliArgs {
  scenarioPath: string;
  candidateId: AgentModelCandidateId;
  runId: string;
  attempt: number;
  artifactsRoot: string;
}

export function configuredSecretValues(
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  const secretName =
    /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)(?:$|_)/u;
  return [
    ...new Set(
      Object.entries(environment)
        .filter(([key]) => secretName.test(key))
        .flatMap(([, value]) => {
          const normalized = value?.trim();
          return normalized && normalized.length >= 8 ? [normalized] : [];
        }),
    ),
  ].sort();
}

export function parseLiveScenarioCliArgs(
  argv: readonly string[],
  repoRoot: string,
): LiveScenarioCliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !flag ||
      ![
        '--scenario',
        '--candidate',
        '--run-id',
        '--attempt',
        '--artifacts-root',
      ].includes(flag) ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(flag)
    ) {
      throw new Error('live_scenario_arguments_invalid');
    }
    values.set(flag, value);
  }
  const scenario = values.get('--scenario')?.trim();
  if (!scenario) throw new Error('live_scenario_path_required');
  const candidate = values.get('--candidate')?.trim();
  if (!candidate) throw new Error('live_scenario_candidate_required');
  const profile = resolveAgentModelProfile({ candidateId: candidate });
  const runId = values.get('--run-id')?.trim();
  if (!runId) throw new Error('live_scenario_run_id_required');
  const attemptValue = values.get('--attempt') ?? '1';
  const attempt = Number(attemptValue);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('live_scenario_attempt_invalid');
  }
  return {
    scenarioPath: resolve(repoRoot, scenario),
    candidateId: profile.candidateId,
    runId,
    attempt,
    artifactsRoot: resolve(
      repoRoot,
      values.get('--artifacts-root') ?? '.artifacts/kfc-live-scenarios',
    ),
  };
}
