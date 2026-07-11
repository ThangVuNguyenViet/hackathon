export interface ProductionLatencySample {
  kind: 'greeting' | 'menu';
  ok: boolean;
  durationMs: number;
}

export interface ProductionLatencyTargets {
  greetingP95Ms: number;
  menuP95Ms: number;
  overallP95Ms: number;
}

export interface ProductionTraceRun {
  id?: string;
  trace_id?: string;
}

export interface UncorrelatableChildSpan {
  runId: string | null;
  traceId: string | null;
  reason: 'missing_trace_id' | 'trace_id_not_agent_root';
}

export interface ChildSpanTraceClassification {
  traceIds: string[];
  uncorrelatableSpans: UncorrelatableChildSpan[];
}

export function classifyChildSpanTraceIds(
  runs: Iterable<ProductionTraceRun>,
  rootTraceIds: Iterable<string>,
): ChildSpanTraceClassification {
  const knownRootTraceIds = new Set(rootTraceIds);
  const traceIds: string[] = [];
  const uncorrelatableSpans: UncorrelatableChildSpan[] = [];

  for (const run of runs) {
    if (!run.trace_id) {
      uncorrelatableSpans.push({
        runId: run.id ?? null,
        traceId: null,
        reason: 'missing_trace_id',
      });
    } else if (!knownRootTraceIds.has(run.trace_id)) {
      uncorrelatableSpans.push({
        runId: run.id ?? null,
        traceId: run.trace_id,
        reason: 'trace_id_not_agent_root',
      });
    } else {
      traceIds.push(run.trace_id);
    }
  }

  return { traceIds, uncorrelatableSpans };
}

export function productionProbeMetadataFilter(probeRunId: string): string {
  const escaped = probeRunId.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `and(eq(metadata_key, "probeRunId"), eq(metadata_value, "${escaped}"))`;
}

interface LatencySummary {
  count: number;
  p95Ms: number;
}

export interface ProductionLatencyResult {
  ok: boolean;
  successRate: number;
  overall: LatencySummary;
  byKind: Record<ProductionLatencySample['kind'], LatencySummary>;
  failures: string[];
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index]!;
}

function summary(samples: ProductionLatencySample[]): LatencySummary {
  return {
    count: samples.length,
    p95Ms: percentile(samples.map((sample) => sample.durationMs), 0.95),
  };
}

export function evaluateProductionLatency(
  samples: ProductionLatencySample[],
  targets: ProductionLatencyTargets,
): ProductionLatencyResult {
  const greeting = samples.filter((sample) => sample.kind === 'greeting');
  const menu = samples.filter((sample) => sample.kind === 'menu');
  const successRate = samples.length === 0 ? 0 : samples.filter((sample) => sample.ok).length / samples.length;
  const overall = summary(samples);
  const byKind = { greeting: summary(greeting), menu: summary(menu) };
  const failures: string[] = [];
  if (successRate !== 1) failures.push('success_rate');
  if (!(byKind.greeting.p95Ms < targets.greetingP95Ms)) failures.push('greeting_p95');
  if (!(byKind.menu.p95Ms < targets.menuP95Ms)) failures.push('menu_p95');
  if (!(overall.p95Ms < targets.overallP95Ms)) failures.push('overall_p95');
  return { ok: failures.length === 0, successRate, overall, byKind, failures };
}
