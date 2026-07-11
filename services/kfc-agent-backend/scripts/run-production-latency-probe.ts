import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'langsmith';
import {
  classifyChildSpanTraceIds,
  evaluateProductionLatency,
  langSmithServerRunLimit,
  productionProbeMetadataFilter,
  type ProductionLatencySample,
  type ProductionTraceRun,
  type UncorrelatableChildSpan,
} from '../src/evaluation/productionLatency.js';

const chatBaseUrl = (process.env.PRODUCTION_CHAT_URL ?? 'https://kfc-ai-chatbot.pages.dev').replace(/\/$/, '');
const iterations = Number(process.env.PRODUCTION_LATENCY_ITERATIONS ?? '20');
const greetingTargetP95Ms = Number(process.env.PRODUCTION_GREETING_TARGET_MS ?? '6000');
const menuTargetP95Ms = Number(process.env.PRODUCTION_MENU_TARGET_MS ?? '8000');
const overallTargetP95Ms = Number(process.env.PRODUCTION_OVERALL_TARGET_MS ?? '8000');
const TRACE_READINESS_TIMEOUT_MS = 60_000;
const TRACE_SETTLE_INTERVAL_MS = 10_000;
const TRACE_POLL_INTERVAL_MS = 2_000;
// Four spans per expected root is deliberately generous for each named child query.
// The extra result makes a query cap an explicit acceptance failure, never a hidden truncation.
const MAX_CHILD_SPANS_PER_TRACE = 4;
const projectName = process.env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-local';
const apiKey = process.env.LANGSMITH_API_KEY;
const apiUrl = process.env.LANGSMITH_ENDPOINT;
if (!apiKey) throw new Error('LANGSMITH_API_KEY is required');
if (!apiUrl) throw new Error('LANGSMITH_ENDPOINT is required');
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('PRODUCTION_LATENCY_ITERATIONS must be a positive integer');
if (![greetingTargetP95Ms, menuTargetP95Ms, overallTargetP95Ms].every((target) => Number.isFinite(target) && target > 0)) {
  throw new Error('Production latency targets must be positive numbers');
}

const probeRunId = `latency-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const startedAt = new Date();
type ProbeKind = ProductionLatencySample['kind'];
type ProductionLatencyProbeSample = ProductionLatencySample & {
  clientMessageId: string;
  sessionId: string;
  status: number;
  responseText?: string;
};

const samples: ProductionLatencyProbeSample[] = [];

for (const kind of ['greeting', 'menu'] as const) {
  for (let index = 0; index < iterations; index += 1) {
    const identity = `${probeRunId}-${kind}-${index + 1}`;
    const body = {
      sessionId: `kfc:${identity}`,
      customerId: identity,
      clientMessageId: `message-${identity}`,
      text: kind === 'greeting' ? 'Xin chào KFC' : 'Hôm nay KFC có món gì ngon?',
      metadata: { probeRunId, probeKind: kind, probeIndex: index + 1 },
    };
    const started = performance.now();
    let status = 0;
    let responseText: string | undefined;
    try {
      const response = await fetch(`${chatBaseUrl}/chat/kfc/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = response.status;
      const payload = await response.json().catch(() => ({})) as { responseText?: string };
      responseText = payload.responseText;
    } catch {
      status = 0;
    }
    const durationMs = Math.round(performance.now() - started);
    samples.push({
      kind,
      ok: status === 200 && Boolean(responseText),
      durationMs,
      clientMessageId: body.clientMessageId,
      sessionId: body.sessionId,
      status,
      responseText,
    });
    console.info(JSON.stringify({ type: 'production_latency_sample', probeRunId, kind, index: index + 1, status, durationMs }));
  }
}

const targets = {
  greetingP95Ms: greetingTargetP95Ms,
  menuP95Ms: menuTargetP95Ms,
  overallP95Ms: overallTargetP95Ms,
};
const latency = evaluateProductionLatency(samples, targets);
const client = new Client({ apiKey, apiUrl });
let agentTurns = 0;
let monitorTurns = 0;
let agentTraceIdsByKind = new Map<string, ProbeKind>();
let routerTraceIds: string[] = [];
let plannerTraceIds: string[] = [];
let composerTraceIds: string[] = [];
let routerUncorrelatableSpans: UncorrelatableChildSpan[] = [];
let plannerUncorrelatableSpans: UncorrelatableChildSpan[] = [];
let composerUncorrelatableSpans: UncorrelatableChildSpan[] = [];
const expectedAgentTurns = iterations * 2;
const expectedRootTurns = expectedAgentTurns * 2;
const rootQueryLimit = expectedRootTurns + 1;
const childSpanQueryLimit = expectedAgentTurns * MAX_CHILD_SPANS_PER_TRACE + 1;
const probeKindByClientMessageId = new Map(samples.map((sample) => [sample.clientMessageId, sample.kind]));

function runMetadataString(run: { extra?: unknown }, key: string): string | undefined {
  if (!run.extra || typeof run.extra !== 'object') return undefined;
  const metadata = (run.extra as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function rootTraceId(run: { trace_id?: string; id?: string }): string | undefined {
  return run.trace_id ?? run.id;
}

interface ChildSpanQueryResult {
  runCount: number;
  runs: ProductionTraceRun[];
  overflowed: boolean;
}

function traceIdCounts(traceIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of traceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function routerTraceCoverage(expectedTraceIds: Iterable<string>, routerTraceIds: string[]): {
  missingTraceIds: string[];
  duplicateTraceIds: string[];
} {
  const counts = traceIdCounts(routerTraceIds);
  const missingTraceIds: string[] = [];
  const duplicateTraceIds: string[] = [];
  for (const traceId of expectedTraceIds) {
    const count = counts.get(traceId) ?? 0;
    if (count === 0) missingTraceIds.push(traceId);
    if (count > 1) duplicateTraceIds.push(traceId);
  }
  return { missingTraceIds, duplicateTraceIds };
}

async function collectChildSpans(
  runs: AsyncIterable<ProductionTraceRun>,
  limit: number,
): Promise<ChildSpanQueryResult> {
  let runCount = 0;
  const childSpans: ProductionTraceRun[] = [];
  for await (const run of runs) {
    runCount += 1;
    childSpans.push(run);
    if (runCount === limit) break;
  }
  return { runCount, runs: childSpans, overflowed: runCount === limit };
}

let routerQueryOverflowed = false;
let plannerQueryOverflowed = false;
let composerQueryOverflowed = false;
let rootQueryOverflowed = false;
let rootRunCount = 0;
let routerSpanRunCount = 0;
let plannerSpanRunCount = 0;
let composerSpanRunCount = 0;
let traceSettleDeadline: number | undefined;
let negativeGateSettleCompleted = false;
const traceReadinessDeadline = Date.now() + TRACE_READINESS_TIMEOUT_MS;
while (true) {
  agentTurns = 0;
  monitorTurns = 0;
  rootRunCount = 0;
  agentTraceIdsByKind = new Map();
  for await (const run of client.listRuns({
    projectName,
    isRoot: true,
    startTime: startedAt,
    filter: productionProbeMetadataFilter(probeRunId),
    limit: rootQueryLimit,
  })) {
    rootRunCount += 1;
    if (run.name === 'agent_turn') {
      agentTurns += 1;
      const clientMessageId = runMetadataString(run, 'clientMessageId');
      const kind = clientMessageId ? probeKindByClientMessageId.get(clientMessageId) : undefined;
      const id = rootTraceId(run);
      if (kind && id) agentTraceIdsByKind.set(id, kind);
    }
    if (run.name === 'post_turn_monitor') monitorTurns += 1;
  }
  rootQueryOverflowed = rootRunCount === rootQueryLimit;
  const routerRuns = client.listRuns({
    projectName,
    startTime: startedAt,
    filter: 'eq(name, "small_talk_router")',
    traceFilter: productionProbeMetadataFilter(probeRunId),
    limit: langSmithServerRunLimit(childSpanQueryLimit),
  });
  const plannerRuns = client.listRuns({
    projectName,
    startTime: startedAt,
    filter: 'eq(name, "planner_iteration")',
    traceFilter: productionProbeMetadataFilter(probeRunId),
    limit: langSmithServerRunLimit(childSpanQueryLimit),
  });
  const composerRuns = client.listRuns({
    projectName,
    startTime: startedAt,
    filter: 'eq(name, "response_compose")',
    traceFilter: productionProbeMetadataFilter(probeRunId),
    limit: langSmithServerRunLimit(childSpanQueryLimit),
  });
  const [routerQuery, plannerQuery, composerQuery] = await Promise.all([
    collectChildSpans(routerRuns, childSpanQueryLimit),
    collectChildSpans(plannerRuns, childSpanQueryLimit),
    collectChildSpans(composerRuns, childSpanQueryLimit),
  ]);
  const routerClassification = classifyChildSpanTraceIds(
    routerQuery.runs,
    agentTraceIdsByKind.keys(),
  );
  const plannerClassification = classifyChildSpanTraceIds(
    plannerQuery.runs,
    agentTraceIdsByKind.keys(),
  );
  const composerClassification = classifyChildSpanTraceIds(
    composerQuery.runs,
    agentTraceIdsByKind.keys(),
  );
  routerTraceIds = routerClassification.traceIds;
  plannerTraceIds = plannerClassification.traceIds;
  composerTraceIds = composerClassification.traceIds;
  routerUncorrelatableSpans = routerClassification.uncorrelatableSpans;
  plannerUncorrelatableSpans = plannerClassification.uncorrelatableSpans;
  composerUncorrelatableSpans = composerClassification.uncorrelatableSpans;
  routerQueryOverflowed = routerQuery.overflowed;
  plannerQueryOverflowed = plannerQuery.overflowed;
  composerQueryOverflowed = composerQuery.overflowed;
  routerSpanRunCount = routerQuery.runCount;
  plannerSpanRunCount = plannerQuery.runCount;
  composerSpanRunCount = composerQuery.runCount;
  const menuTraceIdsDuringPoll = new Set(
    [...agentTraceIdsByKind].filter(([, kind]) => kind === 'menu').map(([id]) => id),
  );
  const menuPlannerTraceIdsDuringPoll = new Set(
    plannerTraceIds.filter((id) => menuTraceIdsDuringPoll.has(id)),
  );
  const routerCoverageDuringPoll = routerTraceCoverage(agentTraceIdsByKind.keys(), routerTraceIds);
  const positiveTraceGatesReady =
    agentTurns === expectedAgentTurns &&
    monitorTurns === expectedAgentTurns &&
    agentTraceIdsByKind.size === expectedAgentTurns &&
    routerTraceIds.length === expectedAgentTurns &&
    routerUncorrelatableSpans.length === 0 &&
    plannerUncorrelatableSpans.length === 0 &&
    composerUncorrelatableSpans.length === 0 &&
    routerCoverageDuringPoll.missingTraceIds.length === 0 &&
    routerCoverageDuringPoll.duplicateTraceIds.length === 0 &&
    menuPlannerTraceIdsDuringPoll.size === iterations;
  const now = Date.now();
  if (rootQueryOverflowed || routerQueryOverflowed || plannerQueryOverflowed || composerQueryOverflowed) break;
  if (positiveTraceGatesReady) {
    traceSettleDeadline ??= now + TRACE_SETTLE_INTERVAL_MS;
    if (now >= traceSettleDeadline) {
      negativeGateSettleCompleted = true;
      break;
    }
  } else {
    traceSettleDeadline = undefined;
    if (now >= traceReadinessDeadline) break;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, TRACE_POLL_INTERVAL_MS));
}

const greetingTraceIds = new Set([...agentTraceIdsByKind].filter(([, kind]) => kind === 'greeting').map(([id]) => id));
const menuTraceIds = new Set([...agentTraceIdsByKind].filter(([, kind]) => kind === 'menu').map(([id]) => id));
const greetingPlannerSpans = plannerTraceIds.filter((id) => greetingTraceIds.has(id)).length;
const greetingComposerSpans = composerTraceIds.filter((id) => greetingTraceIds.has(id)).length;
const menuPlannerTraceIds = new Set(plannerTraceIds.filter((id) => menuTraceIds.has(id)));
const routerCoverage = routerTraceCoverage(agentTraceIdsByKind.keys(), routerTraceIds);
const traceFailures: string[] = [];
if (agentTurns !== expectedAgentTurns) traceFailures.push('agent_turn_roots');
if (monitorTurns !== expectedAgentTurns) traceFailures.push('post_turn_monitor_roots');
if (rootQueryOverflowed) traceFailures.push('root_query_overflow');
if (agentTraceIdsByKind.size !== expectedAgentTurns) traceFailures.push('agent_turn_client_message_ids');
if (routerTraceIds.length !== expectedAgentTurns) traceFailures.push('small_talk_router_spans');
if (routerQueryOverflowed) traceFailures.push('small_talk_router_query_overflow');
if (plannerQueryOverflowed) traceFailures.push('planner_iteration_query_overflow');
if (composerQueryOverflowed) traceFailures.push('response_compose_query_overflow');
if (routerUncorrelatableSpans.length > 0) traceFailures.push('small_talk_router_uncorrelatable_spans');
if (plannerUncorrelatableSpans.length > 0) traceFailures.push('planner_iteration_uncorrelatable_spans');
if (composerUncorrelatableSpans.length > 0) traceFailures.push('response_compose_uncorrelatable_spans');
if (routerCoverage.missingTraceIds.length > 0) traceFailures.push('small_talk_router_trace_coverage');
if (routerCoverage.duplicateTraceIds.length > 0) traceFailures.push('small_talk_router_duplicate_spans');
if (greetingPlannerSpans !== 0) traceFailures.push('greeting_planner_spans');
if (greetingComposerSpans !== 0) traceFailures.push('greeting_response_compose_spans');
if (menuPlannerTraceIds.size !== iterations) traceFailures.push('menu_planner_trace_coverage');
const traceGate = traceFailures.length === 0;
const report = {
  schemaVersion: 1,
  probeRunId,
  chatBaseUrl,
  projectName,
  targets,
  latency,
  traces: {
    agentTurns,
    monitorTurns,
    rootRuns: rootRunCount,
    rootQueryLimit,
    rootQueryOverflowed,
    agentTraceIdsByKind: { greeting: greetingTraceIds.size, menu: menuTraceIds.size },
    routerSpans: routerSpanRunCount,
    plannerSpans: plannerSpanRunCount,
    composerSpans: composerSpanRunCount,
    childSpanQueryLimit,
    childSpanQueryOverflowed: {
      smallTalkRouter: routerQueryOverflowed,
      plannerIteration: plannerQueryOverflowed,
      responseCompose: composerQueryOverflowed,
    },
    routerTraceCoverage: {
      missingTraceIds: routerCoverage.missingTraceIds,
      duplicateTraceIds: routerCoverage.duplicateTraceIds,
    },
    uncorrelatableChildSpans: {
      smallTalkRouter: routerUncorrelatableSpans,
      plannerIteration: plannerUncorrelatableSpans,
      responseCompose: composerUncorrelatableSpans,
    },
    greetingPlannerSpans,
    greetingComposerSpans,
    menuPlannerTraceCoverage: menuPlannerTraceIds.size,
    expected: { agentRoots: expectedAgentTurns, monitorRoots: expectedAgentTurns, routerSpans: expectedAgentTurns, menuPlannerTraces: iterations },
    settle: { intervalMs: TRACE_SETTLE_INTERVAL_MS, completed: negativeGateSettleCompleted },
    failures: traceFailures,
    ok: traceGate,
  },
  samples,
};
const reportDir = resolve(process.cwd(), '../../artifacts/production-latency');
await mkdir(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `${probeRunId}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(JSON.stringify({ type: 'production_latency_summary', reportPath, ...report }));
if (!latency.ok || !traceGate) process.exitCode = 1;
