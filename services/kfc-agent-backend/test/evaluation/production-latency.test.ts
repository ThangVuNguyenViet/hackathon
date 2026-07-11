import { describe, expect, it } from 'vitest';
import {
  evaluateProductionLatency,
  langSmithServerRunLimit,
  percentile,
  productionProbeMetadataFilter,
} from '../../src/evaluation/productionLatency.js';
import * as productionLatency from '../../src/evaluation/productionLatency.js';

describe('production latency acceptance', () => {
  it('lets the LangSmith SDK paginate logical query limits above the API page cap', () => {
    expect(langSmithServerRunLimit(81)).toBe(81);
    expect(langSmithServerRunLimit(100)).toBe(100);
    expect(langSmithServerRunLimit(101)).toBeUndefined();
    expect(langSmithServerRunLimit(161)).toBeUndefined();
  });

  it('uses the LangSmith metadata key/value filter grammar', () => {
    expect(productionProbeMetadataFilter('latency-demo')).toBe(
      'and(eq(metadata_key, "probeRunId"), eq(metadata_value, "latency-demo"))',
    );
  });

  it('fails closed when a child span cannot be correlated to an agent root trace', () => {
    const classifyChildSpanTraceIds = (
      productionLatency as typeof productionLatency & {
        classifyChildSpanTraceIds?: (
          runs: Array<{ id?: string; trace_id?: string }>,
          rootTraceIds: Iterable<string>,
        ) => unknown;
      }
    ).classifyChildSpanTraceIds;

    expect(classifyChildSpanTraceIds).toBeTypeOf('function');
    expect(classifyChildSpanTraceIds?.([
      { id: 'router-child-without-trace' },
      { id: 'planner-child-wrong-trace', trace_id: 'unrelated-root' },
      { id: 'composer-child-correlated', trace_id: 'agent-root' },
    ], ['agent-root'])).toEqual({
      traceIds: ['agent-root'],
      uncorrelatableSpans: [
        {
          runId: 'router-child-without-trace',
          traceId: null,
          reason: 'missing_trace_id',
        },
        {
          runId: 'planner-child-wrong-trace',
          traceId: 'unrelated-root',
          reason: 'trace_id_not_agent_root',
        },
      ],
    });
  });

  it('uses nearest-rank p95 and enforces per-class and overall gates', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);

    const result = evaluateProductionLatency([
      ...Array.from({ length: 20 }, (_, index) => ({ kind: 'greeting' as const, ok: true, durationMs: 1000 + index })),
      ...Array.from({ length: 20 }, (_, index) => ({ kind: 'menu' as const, ok: true, durationMs: 2000 + index })),
    ], {
      greetingP95Ms: 6000,
      menuP95Ms: 8000,
      overallP95Ms: 8000,
    });

    expect(result).toMatchObject({ ok: true, successRate: 1 });
    expect(result.byKind.greeting.count).toBe(20);
    expect(result.byKind.menu.p95Ms).toBeLessThan(8000);
    expect(result.overall.p95Ms).toBeLessThan(8000);
  });

  it('fails a 6100 ms greeting p95 while allowing a 7900 ms menu p95', () => {
    const result = evaluateProductionLatency([
      ...Array.from({ length: 20 }, () => ({ kind: 'greeting' as const, ok: true, durationMs: 6100 })),
      ...Array.from({ length: 20 }, () => ({ kind: 'menu' as const, ok: true, durationMs: 7900 })),
    ], {
      greetingP95Ms: 6000,
      menuP95Ms: 8000,
      overallP95Ms: 8000,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['greeting_p95']);
    expect(result.byKind.greeting.p95Ms).toBe(6100);
    expect(result.byKind.menu.p95Ms).toBe(7900);
  });

  it('requires an exact HTTP success rate of 1', () => {
    const result = evaluateProductionLatency([
      { kind: 'greeting', ok: false, durationMs: 500 },
      { kind: 'menu', ok: true, durationMs: 9000 },
    ], {
      greetingP95Ms: 6000,
      menuP95Ms: 8000,
      overallP95Ms: 8000,
    });

    expect(result.ok).toBe(false);
    expect(result.successRate).toBe(0.5);
    expect(result.failures).toEqual(expect.arrayContaining(['success_rate', 'menu_p95', 'overall_p95']));
  });
});
