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
  name?: string;
  trace_id?: string;
  extra?: unknown;
}

export const productionLatencyGraphNodeSpans = {
  model: 'call_model',
  tools: 'execute_tools',
  trustedActions: 'execute_trusted_action',
} as const;

export interface UncorrelatableChildSpan {
  runId: string | null;
  traceId: string | null;
  reason: 'missing_trace_id' | 'trace_id_not_agent_root';
}

export interface ChildSpanTraceClassification {
  traceIds: string[];
  uncorrelatableSpans: UncorrelatableChildSpan[];
}

export type ProductionRootRunName = 'agent_turn' | 'post_turn_monitor';

export interface UncorrelatableRootRun {
  runId: string | null;
  name: string | null;
  clientMessageId: string | null;
  reason:
    | 'unexpected_root_name'
    | 'missing_client_message_id'
    | 'unexpected_client_message_id'
    | 'missing_trace_id';
}

export interface RootRunKindCoverage {
  byClientMessageId: Record<string, string[]>;
  missingClientMessageIds: string[];
  duplicateClientMessageIds: string[];
}

export interface ProductionRootRunCoverage {
  expectedClientMessageIds: string[];
  agent: RootRunKindCoverage;
  monitor: RootRunKindCoverage;
  uncorrelatableRoots: UncorrelatableRootRun[];
}

const LANGSMITH_MAX_RUN_QUERY_LIMIT = 100;

export function langSmithServerRunLimit(logicalLimit: number): number | undefined {
  return logicalLimit <= LANGSMITH_MAX_RUN_QUERY_LIMIT ? logicalLimit : undefined;
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

function runMetadataString(
  run: ProductionTraceRun,
  key: string,
): string | undefined {
  if (!run.extra || typeof run.extra !== 'object') return undefined;
  const metadata = (run.extra as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function rootTraceId(run: ProductionTraceRun): string | undefined {
  return run.trace_id ?? run.id;
}

function rootKind(
  name: string | undefined,
): 'agent' | 'monitor' | undefined {
  if (name === 'agent_turn') return 'agent';
  if (name === 'post_turn_monitor') return 'monitor';
  return undefined;
}

export function classifyRootRunsByClientMessageId(
  runs: Iterable<ProductionTraceRun>,
  expectedClientMessageIds: Iterable<string>,
): ProductionRootRunCoverage {
  const expected = [...new Set(expectedClientMessageIds)].sort();
  const expectedSet = new Set(expected);
  const byKind = {
    agent: Object.fromEntries(
      expected.map((clientMessageId) => [clientMessageId, [] as string[]]),
    ),
    monitor: Object.fromEntries(
      expected.map((clientMessageId) => [clientMessageId, [] as string[]]),
    ),
  };
  const uncorrelatableRoots: UncorrelatableRootRun[] = [];

  for (const run of runs) {
    const kind = rootKind(run.name);
    const clientMessageId = runMetadataString(run, 'clientMessageId');
    const traceId = rootTraceId(run);
    if (!kind) {
      uncorrelatableRoots.push({
        runId: run.id ?? null,
        name: run.name ?? null,
        clientMessageId: clientMessageId ?? null,
        reason: 'unexpected_root_name',
      });
      continue;
    }
    if (!clientMessageId) {
      uncorrelatableRoots.push({
        runId: run.id ?? null,
        name: run.name ?? null,
        clientMessageId: null,
        reason: 'missing_client_message_id',
      });
      continue;
    }
    if (!expectedSet.has(clientMessageId)) {
      uncorrelatableRoots.push({
        runId: run.id ?? null,
        name: run.name ?? null,
        clientMessageId,
        reason: 'unexpected_client_message_id',
      });
      continue;
    }
    if (!traceId) {
      uncorrelatableRoots.push({
        runId: run.id ?? null,
        name: run.name ?? null,
        clientMessageId,
        reason: 'missing_trace_id',
      });
      continue;
    }
    byKind[kind][clientMessageId]!.push(traceId);
  }

  const coverage = (kind: 'agent' | 'monitor'): RootRunKindCoverage => ({
    byClientMessageId: byKind[kind],
    missingClientMessageIds: expected.filter(
      (clientMessageId) => byKind[kind][clientMessageId]!.length === 0,
    ),
    duplicateClientMessageIds: expected.filter(
      (clientMessageId) => byKind[kind][clientMessageId]!.length > 1,
    ),
  });

  return {
    expectedClientMessageIds: expected,
    agent: coverage('agent'),
    monitor: coverage('monitor'),
    uncorrelatableRoots,
  };
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
