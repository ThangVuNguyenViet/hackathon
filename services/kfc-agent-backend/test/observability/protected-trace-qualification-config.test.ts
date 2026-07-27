import { describe, expect, it } from 'vitest';
import { resolveProtectedTraceQualificationConfig } from '../../src/observability/protectedTraceQualificationConfig.js';

const runtime = {
  runtimeId: 'langgraph-stategraph-v1',
  provider: 'openai' as const,
  model: 'gpt-4.1-mini',
  profile: 'openai-v2-live-qualification',
};

function environment(): NodeJS.ProcessEnv {
  return {
    KFC_PROTECTED_TRACE_RECEIPT_OUTPUT: '/tmp/receipt.json',
    KFC_PROTECTED_TRACE_EXECUTION_ID: '00000000-0000-4000-8000-000000000001',
    KFC_PROTECTED_TRACE_GIT_SHA: 'a'.repeat(40),
    KFC_PROTECTED_TRACE_REMOTE_DATASET_ID:
      '00000000-0000-4000-8000-000000000002',
    KFC_PROTECTED_TRACE_REPETITION: '2',
    KFC_LIVE_SCENARIO_MODE: 'text',
  };
}

describe('protected trace qualification config', () => {
  it('is inactive unless an immutable receipt output is requested', () => {
    expect(resolveProtectedTraceQualificationConfig({}, runtime)).toBeUndefined();
  });

  it('binds the reviewed V2 policy and normalized runtime identity', () => {
    expect(resolveProtectedTraceQualificationConfig(environment(), runtime)).toMatchObject({
      outputPath: '/tmp/receipt.json',
      context: {
        gitSha: 'a'.repeat(40),
        runtime: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          profile: 'openai-v2-live-qualification',
        },
        policy: {
          policyId: 'kfc-live-quality-v2-protected-trace-v1',
          dataset: { scenarioCount: 9, turnCount: 46, caseCount: 92 },
        },
        mode: 'text',
        repetition: 2,
      },
    });
  });

  it.each([
    ['KFC_PROTECTED_TRACE_GIT_SHA', 'bad-sha'],
    ['KFC_PROTECTED_TRACE_REPETITION', '4'],
    ['KFC_LIVE_SCENARIO_MODE', 'both'],
  ])('fails closed for invalid %s', (key, value) => {
    const env = environment();
    env[key] = value;
    expect(() => resolveProtectedTraceQualificationConfig(env, runtime)).toThrow(
      'protected_trace_qualification_config_invalid',
    );
  });
});
