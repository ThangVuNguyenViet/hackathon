import { describe, expect, it } from 'vitest';
import {
  evaluateProductionLatency,
  percentile,
  productionProbeMetadataFilter,
} from '../../src/evaluation/productionLatency.js';

describe('production latency acceptance', () => {
  it('uses the LangSmith metadata key/value filter grammar', () => {
    expect(productionProbeMetadataFilter('latency-demo')).toBe(
      'and(eq(metadata_key, "probeRunId"), eq(metadata_value, "latency-demo"))',
    );
  });

  it('uses nearest-rank p95 and enforces per-class and overall gates', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);

    const result = evaluateProductionLatency([
      ...Array.from({ length: 20 }, (_, index) => ({ kind: 'greeting' as const, ok: true, durationMs: 1000 + index })),
      ...Array.from({ length: 20 }, (_, index) => ({ kind: 'menu' as const, ok: true, durationMs: 2000 + index })),
    ], 8000);

    expect(result).toMatchObject({ ok: true, successRate: 1 });
    expect(result.byKind.greeting.count).toBe(20);
    expect(result.byKind.menu.p95Ms).toBeLessThan(8000);
    expect(result.overall.p95Ms).toBeLessThan(8000);
  });

  it('fails when any response fails or any class misses the p95 target', () => {
    const result = evaluateProductionLatency([
      { kind: 'greeting', ok: false, durationMs: 500 },
      { kind: 'menu', ok: true, durationMs: 9000 },
    ], 8000);

    expect(result.ok).toBe(false);
    expect(result.successRate).toBe(0.5);
    expect(result.failures).toEqual(expect.arrayContaining(['success_rate', 'menu_p95', 'overall_p95']));
  });
});
