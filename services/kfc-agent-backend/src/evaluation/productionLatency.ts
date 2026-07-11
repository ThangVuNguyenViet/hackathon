export interface ProductionLatencySample {
  kind: 'greeting' | 'menu';
  ok: boolean;
  durationMs: number;
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
  targetP95Ms: number,
): ProductionLatencyResult {
  const greeting = samples.filter((sample) => sample.kind === 'greeting');
  const menu = samples.filter((sample) => sample.kind === 'menu');
  const successRate = samples.length === 0 ? 0 : samples.filter((sample) => sample.ok).length / samples.length;
  const overall = summary(samples);
  const byKind = { greeting: summary(greeting), menu: summary(menu) };
  const failures: string[] = [];
  if (successRate !== 1) failures.push('success_rate');
  if (byKind.greeting.p95Ms >= targetP95Ms) failures.push('greeting_p95');
  if (byKind.menu.p95Ms >= targetP95Ms) failures.push('menu_p95');
  if (overall.p95Ms >= targetP95Ms) failures.push('overall_p95');
  return { ok: failures.length === 0, successRate, overall, byKind, failures };
}
