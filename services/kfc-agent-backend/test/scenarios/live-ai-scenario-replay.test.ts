import { describe, it } from 'vitest';

const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';

describe.runIf(liveRequested)('single-agent live quality matrix', () => {
  it('requires the provider-neutral runtime adapter from issue #49', () => {
    throw new Error(
      'live_quality_runtime_adapter_missing: integrate runLiveQualityMatrix with the single-agent runtime before qualification',
    );
  });
});
