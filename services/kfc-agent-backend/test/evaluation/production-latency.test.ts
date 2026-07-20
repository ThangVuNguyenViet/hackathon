import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyRootRunsByClientMessageId,
  evaluateProductionLatency,
  langSmithServerRunLimit,
  percentile,
  productionLatencyGraphNodeSpans,
  productionProbeMetadataFilter,
} from '../../src/evaluation/productionLatency.js';
import { KFC_AGENT_GRAPH_NODE_NAMES } from '../../src/agent/agentStateGraph.js';
import * as productionLatency from '../../src/evaluation/productionLatency.js';

const {
  assertCurrentProductionLatencyReport,
} = await import(
  new URL(
    '../../../../scripts/lib/kfc-production-latency-report.mjs',
    import.meta.url,
  ).href
) as {
  assertCurrentProductionLatencyReport: (input: unknown) => unknown;
};

const openAiIdentity = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  profile: 'openai-gpt-4.1-mini',
} as const;
function currentProductionLatencyReport() {
  const greetingIds = Array.from(
    { length: 20 },
    (_, index) => `message-latency-test-greeting-${index + 1}`,
  );
  const menuIds = Array.from(
    { length: 20 },
    (_, index) => `message-latency-test-menu-${index + 1}`,
  );
  const expectedClientMessageIds = [...greetingIds, ...menuIds].sort();
  const agentTraceId = (clientMessageId: string) =>
    `agent-${clientMessageId}`;
  const monitorTraceId = (clientMessageId: string) =>
    `monitor-${clientMessageId}`;
  const greetingAgentTraceIds = greetingIds.map(agentTraceId);
  const menuAgentTraceIds = menuIds.map(agentTraceId);
  const agentRoots = Object.fromEntries(
    expectedClientMessageIds.map((clientMessageId) => [
      clientMessageId,
      [agentTraceId(clientMessageId)],
    ]),
  );
  const monitorRoots = Object.fromEntries(
    expectedClientMessageIds.map((clientMessageId) => [
      clientMessageId,
      [monitorTraceId(clientMessageId)],
    ]),
  );
  const gitSha = 'release-sha';
  const releaseBuiltAt = '2026-07-20T00:00:00.000Z';
  const workerDeploymentId = 'worker-release';

  return {
    schemaVersion: 4,
    release: {
      gitSha,
      releaseBuiltAt,
      dirty: false,
      deploymentId: 'pages-release',
    },
    readiness: {
      ok: true,
      release: {
        gitSha,
        deploymentId: workerDeploymentId,
        releaseBuiltAt,
        dirty: false,
      },
      checks: {
        agent: {
          ok: true,
          configured: true,
          ...openAiIdentity,
        },
      },
      proof: {
        deployment: {
          gitSha,
          deploymentId: workerDeploymentId,
          builtAt: releaseBuiltAt,
          dirty: false,
        },
        versions: {
          agent: { ...openAiIdentity },
        },
      },
    },
    targets: {
      greetingP95Ms: 6000,
      menuP95Ms: 8000,
      overallP95Ms: 8000,
    },
    latency: {
      ok: true,
      successRate: 1,
      failures: [],
      overall: { count: 40, p95Ms: 2000 },
      byKind: {
        greeting: { count: 20, p95Ms: 1000 },
        menu: { count: 20, p95Ms: 2000 },
      },
    },
    samples: [
      ...greetingIds.map((clientMessageId) => ({
        kind: 'greeting',
        ok: true,
        status: 200,
        responseText: 'Xin chào',
        durationMs: 1000,
        clientMessageId,
        sessionId: `kfc:${clientMessageId}`,
      })),
      ...menuIds.map((clientMessageId) => ({
        kind: 'menu',
        ok: true,
        status: 200,
        responseText: 'Đây là thực đơn',
        durationMs: 2000,
        clientMessageId,
        sessionId: `kfc:${clientMessageId}`,
      })),
    ],
    traces: {
      runtime: 'langgraph-stategraph-v1',
      ok: true,
      failures: [],
      rootQueryOverflowed: false,
      settle: { completed: true },
      agentTurns: 40,
      monitorTurns: 40,
      rootRuns: 80,
      rootCoverage: {
        expectedClientMessageIds,
        agent: {
          byClientMessageId: agentRoots,
          missingClientMessageIds: [],
          duplicateClientMessageIds: [],
        },
        monitor: {
          byClientMessageId: monitorRoots,
          missingClientMessageIds: [],
          duplicateClientMessageIds: [],
        },
        uncorrelatableRoots: [],
      },
      agentTraceIdsByKind: { greeting: 20, menu: 20 },
      graphNodes: {
        callModel: {
          name: 'call_model',
          runCount: 60,
          traceIds: [
            ...greetingAgentTraceIds,
            ...menuAgentTraceIds.flatMap((traceId) => [traceId, traceId]),
          ],
          uncorrelatableSpans: [],
          overflowed: false,
        },
        executeTools: {
          name: 'execute_tools',
          runCount: 20,
          traceIds: menuAgentTraceIds,
          uncorrelatableSpans: [],
          overflowed: false,
        },
        executeTrustedAction: {
          name: 'execute_trusted_action',
          runCount: 0,
          traceIds: [],
          uncorrelatableSpans: [],
          overflowed: false,
        },
      },
      byKind: {
        greeting: {
          modelSpans: 20,
          toolExecutionSpans: 0,
          trustedActionSpans: 0,
        },
        menu: {
          modelSpans: 40,
          toolExecutionSpans: 20,
          trustedActionSpans: 0,
        },
      },
      expected: {
        agentRoots: 40,
        monitorRoots: 40,
        greetingModelNodesPerTrace: 1,
        menuModelNodesPerTrace: 2,
        lowRiskTrustedActionNodes: 0,
        greetingToolExecutionNodes: 0,
        menuToolExecutionTraceCoverage: 20,
      },
    },
  };
}

describe('production latency acceptance', () => {
  it('queries only nodes declared by the explicit agent StateGraph', () => {
    expect(Object.values(productionLatencyGraphNodeSpans)).toEqual([
      'call_model',
      'execute_tools',
      'execute_trusted_action',
    ]);
    expect(KFC_AGENT_GRAPH_NODE_NAMES).toEqual(expect.arrayContaining(
      Object.values(productionLatencyGraphNodeSpans),
    ));
  });

  it('waits for the exact author-model and tool spans before settling', () => {
    const source = readFileSync(
      'scripts/run-production-latency-probe.ts',
      'utf8',
    );
    expect(source).toMatch(
      /everyTraceHasExactCount\(menuTraceIds, menuModelTraceIds, 2\)/,
    );
    expect(source).toContain(
      "traceFailures.push('trace_settle_incomplete')",
    );
  });

  it('accepts exact one-call greetings and two-call menu turns', () => {
    const report = currentProductionLatencyReport();

    expect(assertCurrentProductionLatencyReport(report)).toBe(report);
  });

  it.each([
    {
      name: 'missing greeting author call',
      mutate: (report: ReturnType<typeof currentProductionLatencyReport>) => {
        report.traces.graphNodes.callModel.traceIds.shift();
        report.traces.graphNodes.callModel.runCount -= 1;
      },
      error: /callModel\.greeting coverage is not exact/,
    },
    {
      name: 'extra menu author call',
      mutate: (report: ReturnType<typeof currentProductionLatencyReport>) => {
        report.traces.graphNodes.callModel.traceIds.push(
          report.traces.graphNodes.callModel.traceIds.at(-1)!,
        );
        report.traces.graphNodes.callModel.runCount += 1;
      },
      error: /callModel\.menu coverage is not exact/,
    },
    {
      name: 'unexpected author root',
      mutate: (report: ReturnType<typeof currentProductionLatencyReport>) => {
        report.traces.graphNodes.callModel.traceIds.push(
          'agent-unexpected-request',
        );
        report.traces.graphNodes.callModel.runCount += 1;
      },
      error: /call_model has an unexpected root trace/,
    },
  ])('rejects $name', ({ mutate, error }) => {
    const report = currentProductionLatencyReport();
    mutate(report);

    expect(() => assertCurrentProductionLatencyReport(report)).toThrow(error);
  });

  it('rejects an incomplete trace settle even when final counts look green', () => {
    const report = currentProductionLatencyReport();
    report.traces.settle.completed = false;

    expect(() => assertCurrentProductionLatencyReport(report)).toThrow(
      /trace settle did not complete/,
    );
  });

  it('rejects secret-bearing author readiness', () => {
    const report = currentProductionLatencyReport();
    const agent = report.readiness.checks.agent as Record<string, unknown>;
    agent.apiKey = 'must-not-enter-a-release-report';
    expect(() => assertCurrentProductionLatencyReport(report)).toThrow(
      /keys are not current/,
    );
  });

  it('binds the author identity to the deep readiness release', () => {
    const report = currentProductionLatencyReport();
    report.readiness.release.gitSha = 'different-release';

    expect(() => assertCurrentProductionLatencyReport(report)).toThrow(
      /readiness release does not match its proof deployment/,
    );
  });

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
      { id: 'model-node-without-trace' },
      { id: 'tool-node-wrong-trace', trace_id: 'unrelated-root' },
      { id: 'verification-node-correlated', trace_id: 'agent-root' },
    ], ['agent-root'])).toEqual({
      traceIds: ['agent-root'],
      uncorrelatableSpans: [
        {
          runId: 'model-node-without-trace',
          traceId: null,
          reason: 'missing_trace_id',
        },
        {
          runId: 'tool-node-wrong-trace',
          traceId: 'unrelated-root',
          reason: 'trace_id_not_agent_root',
        },
      ],
    });
  });

  it('requires exactly one agent and monitor root for every probe request', () => {
    const metadata = (clientMessageId: string) => ({
      metadata: { clientMessageId },
    });
    const coverage = classifyRootRunsByClientMessageId([
      {
        id: 'agent-a',
        name: 'agent_turn',
        trace_id: 'agent-trace-a',
        extra: metadata('message-a'),
      },
      {
        id: 'monitor-a',
        name: 'post_turn_monitor',
        trace_id: 'monitor-trace-a',
        extra: metadata('message-a'),
      },
      {
        id: 'agent-b',
        name: 'agent_turn',
        trace_id: 'agent-trace-b',
        extra: metadata('message-b'),
      },
      {
        id: 'monitor-b',
        name: 'post_turn_monitor',
        trace_id: 'monitor-trace-b',
        extra: metadata('message-b'),
      },
    ], ['message-a', 'message-b']);

    expect(coverage).toEqual({
      expectedClientMessageIds: ['message-a', 'message-b'],
      agent: {
        byClientMessageId: {
          'message-a': ['agent-trace-a'],
          'message-b': ['agent-trace-b'],
        },
        missingClientMessageIds: [],
        duplicateClientMessageIds: [],
      },
      monitor: {
        byClientMessageId: {
          'message-a': ['monitor-trace-a'],
          'message-b': ['monitor-trace-b'],
        },
        missingClientMessageIds: [],
        duplicateClientMessageIds: [],
      },
      uncorrelatableRoots: [],
    });
  });

  it('does not let duplicate roots for one request replace another request', () => {
    const metadata = (clientMessageId: string) => ({
      metadata: { clientMessageId },
    });
    const coverage = classifyRootRunsByClientMessageId([
      {
        id: 'agent-a-1',
        name: 'agent_turn',
        trace_id: 'agent-trace-a-1',
        extra: metadata('message-a'),
      },
      {
        id: 'agent-a-2',
        name: 'agent_turn',
        trace_id: 'agent-trace-a-2',
        extra: metadata('message-a'),
      },
      {
        id: 'monitor-a',
        name: 'post_turn_monitor',
        trace_id: 'monitor-trace-a',
        extra: metadata('message-a'),
      },
      {
        id: 'monitor-wrong',
        name: 'post_turn_monitor',
        trace_id: 'monitor-trace-wrong',
        extra: metadata('message-unexpected'),
      },
    ], ['message-a', 'message-b']);

    expect(coverage.agent.missingClientMessageIds).toEqual(['message-b']);
    expect(coverage.agent.duplicateClientMessageIds).toEqual(['message-a']);
    expect(coverage.monitor.missingClientMessageIds).toEqual(['message-b']);
    expect(coverage.monitor.duplicateClientMessageIds).toEqual([]);
    expect(coverage.uncorrelatableRoots).toContainEqual({
      runId: 'monitor-wrong',
      name: 'post_turn_monitor',
      clientMessageId: 'message-unexpected',
      reason: 'unexpected_client_message_id',
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
