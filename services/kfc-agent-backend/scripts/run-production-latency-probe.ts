import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'langsmith';
import {
  KFC_AGENT_GRAPH_NODE_NAMES,
  KFC_AGENT_RUNTIME_ID,
} from '../src/agent/agentStateGraph.js';
import {
  agentModelProfiles,
  type AgentModelIdentity,
} from '../src/config/agentModelProfile.js';
import {
  classifyChildSpanTraceIds,
  classifyRootRunsByClientMessageId,
  evaluateProductionLatency,
  langSmithServerRunLimit,
  productionLatencyGraphNodeSpans,
  productionProbeMetadataFilter,
  type ProductionLatencySample,
  type ProductionRootRunCoverage,
  type ProductionTraceRun,
  type UncorrelatableChildSpan,
} from '../src/evaluation/productionLatency.js';

const chatBaseUrl = (
  process.env.PRODUCTION_CHAT_URL ?? 'https://kfc-ai-chatbot.pages.dev'
).replace(/\/$/, '');
const iterations = Number(process.env.PRODUCTION_LATENCY_ITERATIONS ?? '20');
const greetingTargetP95Ms = Number(
  process.env.PRODUCTION_GREETING_TARGET_MS ?? '6000',
);
const menuTargetP95Ms = Number(
  process.env.PRODUCTION_MENU_TARGET_MS ?? '8000',
);
const overallTargetP95Ms = Number(
  process.env.PRODUCTION_OVERALL_TARGET_MS ?? '8000',
);
const TRACE_READINESS_TIMEOUT_MS = 60_000;
const TRACE_SETTLE_INTERVAL_MS = 10_000;
const TRACE_POLL_INTERVAL_MS = 2_000;
// A successful turn can invoke call_model up to the graph's bounded provider
// call limit. The extra result turns cap exhaustion into an explicit failure.
const MAX_GRAPH_NODE_SPANS_PER_TRACE = 6;
const projectName =
  process.env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-local';
const apiKey = process.env.LANGSMITH_API_KEY;
const apiUrl = process.env.LANGSMITH_ENDPOINT;

interface SanitizedProductionReadiness {
  ok: true;
  release: {
    gitSha: string;
    deploymentId: string;
    releaseBuiltAt: string;
    dirty: false;
  };
  checks: {
    agent: {
      ok: true;
      configured: true;
      provider: AgentModelIdentity['provider'];
      model: string;
      profile: string;
    };
    responseVerifier: {
      ok: true;
      required: true;
      configured: true;
      provider: AgentModelIdentity['provider'];
      model: string;
      profile: string;
    };
  };
  proof: {
    deployment: {
      gitSha: string;
      deploymentId: string;
      builtAt: string;
      dirty: false;
    };
    versions: {
      agent: AgentModelIdentity;
      responseVerifier: AgentModelIdentity;
    };
  };
}

function readinessRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Production deep readiness ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readinessString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Production deep readiness ${label} must be a non-empty string`,
    );
  }
  return value;
}

function readinessIdentity(
  value: unknown,
  label: string,
): AgentModelIdentity {
  const identity = readinessRecord(value, label);
  const provider = readinessString(identity.provider, `${label}.provider`);
  if (provider !== 'openai' && provider !== 'google') {
    throw new Error(
      `Production deep readiness ${label}.provider is unsupported`,
    );
  }
  const expected = agentModelProfiles[provider];
  const model = readinessString(identity.model, `${label}.model`);
  const profile = readinessString(identity.profile, `${label}.profile`);
  if (model !== expected.model || profile !== expected.profile) {
    throw new Error(
      `Production deep readiness ${label} is not a reviewed model profile`,
    );
  }
  return { provider, model, profile };
}

function sameIdentity(
  left: AgentModelIdentity,
  right: AgentModelIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.profile === right.profile
  );
}

function sanitizeProductionReadiness(
  value: unknown,
  publicReleaseValue: unknown,
): SanitizedProductionReadiness {
  const readiness = readinessRecord(value, 'root');
  if (readiness.ok !== true) {
    throw new Error('Production deep readiness is not accepted');
  }
  const checks = readinessRecord(readiness.checks, 'checks');
  const agentCheck = readinessRecord(checks.agent, 'checks.agent');
  const verifierCheck = readinessRecord(
    checks.responseVerifier,
    'checks.responseVerifier',
  );
  if (agentCheck.ok !== true || agentCheck.configured !== true) {
    throw new Error('Production agent readiness is not configured and healthy');
  }
  if (
    verifierCheck.ok !== true ||
    verifierCheck.required !== true ||
    verifierCheck.configured !== true
  ) {
    throw new Error(
      'Production response verifier readiness is not configured and healthy',
    );
  }
  const agent = readinessIdentity(agentCheck, 'checks.agent');
  const responseVerifier = readinessIdentity(
    verifierCheck,
    'checks.responseVerifier',
  );
  if (agent.provider === responseVerifier.provider) {
    throw new Error(
      'Production response verifier provider must differ from the agent provider',
    );
  }

  const proof = readinessRecord(readiness.proof, 'proof');
  const versions = readinessRecord(proof.versions, 'proof.versions');
  const proofAgent = readinessIdentity(
    versions.agent,
    'proof.versions.agent',
  );
  const proofResponseVerifier = readinessIdentity(
    versions.responseVerifier,
    'proof.versions.responseVerifier',
  );
  if (
    !sameIdentity(agent, proofAgent) ||
    !sameIdentity(responseVerifier, proofResponseVerifier)
  ) {
    throw new Error(
      'Production deep readiness check identities do not match proof identities',
    );
  }

  const publicRelease = readinessRecord(publicReleaseValue, 'public release');
  const readinessRelease = readinessRecord(readiness.release, 'release');
  const deployment = readinessRecord(proof.deployment, 'proof.deployment');
  const gitSha = readinessString(readinessRelease.gitSha, 'release.gitSha');
  const deploymentId = readinessString(
    readinessRelease.deploymentId,
    'release.deploymentId',
  );
  const releaseBuiltAt = readinessString(
    readinessRelease.releaseBuiltAt,
    'release.releaseBuiltAt',
  );
  if (
    readinessRelease.dirty !== false ||
    publicRelease.gitSha !== gitSha ||
    publicRelease.releaseBuiltAt !== releaseBuiltAt ||
    publicRelease.dirty !== false ||
    deployment.gitSha !== gitSha ||
    deployment.deploymentId !== deploymentId ||
    deployment.builtAt !== releaseBuiltAt ||
    deployment.dirty !== false
  ) {
    throw new Error(
      'Production deep readiness is not bound to the public release',
    );
  }

  return {
    ok: true,
    release: {
      gitSha,
      deploymentId,
      releaseBuiltAt,
      dirty: false,
    },
    checks: {
      agent: {
        ok: true,
        configured: true,
        ...agent,
      },
      responseVerifier: {
        ok: true,
        required: true,
        configured: true,
        ...responseVerifier,
      },
    },
    proof: {
      deployment: {
        gitSha,
        deploymentId,
        builtAt: releaseBuiltAt,
        dirty: false,
      },
      versions: {
        agent: proofAgent,
        responseVerifier: proofResponseVerifier,
      },
    },
  };
}

if (!apiKey) throw new Error('LANGSMITH_API_KEY is required');
if (!apiUrl) throw new Error('LANGSMITH_ENDPOINT is required');
for (const nodeName of Object.values(productionLatencyGraphNodeSpans)) {
  if (!(KFC_AGENT_GRAPH_NODE_NAMES as readonly string[]).includes(nodeName)) {
    throw new Error(`Production latency graph node is not declared: ${nodeName}`);
  }
}
if (!Number.isInteger(iterations) || iterations < 1) {
  throw new Error(
    'PRODUCTION_LATENCY_ITERATIONS must be a positive integer',
  );
}
if (
  ![greetingTargetP95Ms, menuTargetP95Ms, overallTargetP95Ms].every(
    (target) => Number.isFinite(target) && target > 0,
  )
) {
  throw new Error('Production latency targets must be positive numbers');
}

const probeRunId = `latency-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const startedAt = new Date();
const releaseResponse = await fetch(`${chatBaseUrl}/release.json`, {
  headers: { 'cache-control': 'no-cache' },
});
if (!releaseResponse.ok) {
  throw new Error(
    `Production release probe returned ${releaseResponse.status}`,
  );
}
const release = await releaseResponse.json() as Record<string, unknown>;
const readinessResponse = await fetch(`${chatBaseUrl}/ready?deep=1`, {
  headers: { 'cache-control': 'no-cache' },
});
if (!readinessResponse.ok) {
  throw new Error(
    `Production deep readiness probe returned ${readinessResponse.status}`,
  );
}
const readiness = sanitizeProductionReadiness(
  await readinessResponse.json() as unknown,
  release,
);

type ProbeKind = ProductionLatencySample['kind'];
type ProductionLatencyProbeSample = ProductionLatencySample & {
  clientMessageId: string;
  sessionId: string;
  status: number;
  responseText?: string;
};
type GraphNodeSpanKey = keyof typeof productionLatencyGraphNodeSpans;

interface GraphNodeSpanSnapshot {
  runCount: number;
  traceIds: string[];
  uncorrelatableSpans: UncorrelatableChildSpan[];
  overflowed: boolean;
}

interface ChildSpanQueryResult {
  runCount: number;
  runs: ProductionTraceRun[];
  overflowed: boolean;
}

const samples: ProductionLatencyProbeSample[] = [];

for (const kind of ['greeting', 'menu'] as const) {
  for (let index = 0; index < iterations; index += 1) {
    const identity = `${probeRunId}-${kind}-${index + 1}`;
    const body = {
      sessionId: `kfc:${identity}`,
      customerId: identity,
      clientMessageId: `message-${identity}`,
      text: kind === 'greeting'
        ? 'Xin chào KFC'
        : 'Hôm nay KFC có món gì ngon?',
      metadata: {
        probeRunId,
        probeKind: kind,
        probeIndex: index + 1,
      },
    };
    const sampleStartedAt = performance.now();
    let status = 0;
    let responseText: string | undefined;
    try {
      const response = await fetch(`${chatBaseUrl}/chat/kfc/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = response.status;
      const payload = await response.json().catch(() => ({})) as {
        responseText?: string;
      };
      responseText = payload.responseText;
    } catch {
      status = 0;
    }
    const durationMs = Math.round(performance.now() - sampleStartedAt);
    samples.push({
      kind,
      ok: status === 200 && Boolean(responseText),
      durationMs,
      clientMessageId: body.clientMessageId,
      sessionId: body.sessionId,
      status,
      responseText,
    });
    console.info(JSON.stringify({
      type: 'production_latency_sample',
      probeRunId,
      kind,
      index: index + 1,
      status,
      durationMs,
    }));
  }
}

const targets = {
  greetingP95Ms: greetingTargetP95Ms,
  menuP95Ms: menuTargetP95Ms,
  overallP95Ms: overallTargetP95Ms,
};
const latency = evaluateProductionLatency(samples, targets);
const client = new Client({ apiKey, apiUrl });
const expectedAgentTurns = iterations * 2;
const expectedRootTurns = expectedAgentTurns * 2;
const rootQueryLimit = expectedRootTurns + 1;
const graphNodeSpanQueryLimit =
  expectedAgentTurns * MAX_GRAPH_NODE_SPANS_PER_TRACE + 1;
const probeKindByClientMessageId = new Map(
  samples.map((sample) => [sample.clientMessageId, sample.kind]),
);
const expectedClientMessageIds = [...probeKindByClientMessageId.keys()];

function traceIdCounts(traceIds: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of traceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function everyTraceHasExactCount(
  expectedTraceIds: Iterable<string>,
  actualTraceIds: Iterable<string>,
  expectedCount: number,
): boolean {
  const counts = traceIdCounts(actualTraceIds);
  return [...expectedTraceIds].every(
    (traceId) => (counts.get(traceId) ?? 0) === expectedCount,
  );
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
  return {
    runCount,
    runs: childSpans,
    overflowed: runCount === limit,
  };
}

async function collectGraphNodeSpanSnapshots(
  agentRootTraceIds: Iterable<string>,
): Promise<Record<GraphNodeSpanKey, GraphNodeSpanSnapshot>> {
  const rootTraceIds = [...agentRootTraceIds];
  const entries = await Promise.all(
    (
      Object.entries(productionLatencyGraphNodeSpans) as Array<
        [GraphNodeSpanKey, string]
      >
    ).map(async ([key, nodeName]) => {
      const query = await collectChildSpans(
        client.listRuns({
          projectName,
          startTime: startedAt,
          filter: `eq(name, "${nodeName}")`,
          traceFilter: productionProbeMetadataFilter(probeRunId),
          limit: langSmithServerRunLimit(graphNodeSpanQueryLimit),
        }),
        graphNodeSpanQueryLimit,
      );
      const classification = classifyChildSpanTraceIds(
        query.runs,
        rootTraceIds,
      );
      return [key, {
        runCount: query.runCount,
        traceIds: classification.traceIds,
        uncorrelatableSpans: classification.uncorrelatableSpans,
        overflowed: query.overflowed,
      }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    GraphNodeSpanKey,
    GraphNodeSpanSnapshot
  >;
}

let agentTurns = 0;
let monitorTurns = 0;
let rootRunCount = 0;
let rootQueryOverflowed = false;
let agentTraceIdsByKind = new Map<string, ProbeKind>();
let rootCoverage: ProductionRootRunCoverage =
  classifyRootRunsByClientMessageId([], expectedClientMessageIds);
let nodeSpans: Record<GraphNodeSpanKey, GraphNodeSpanSnapshot> = {
  model: {
    runCount: 0,
    traceIds: [],
    uncorrelatableSpans: [],
    overflowed: false,
  },
  responseModel: {
    runCount: 0,
    traceIds: [],
    uncorrelatableSpans: [],
    overflowed: false,
  },
  tools: {
    runCount: 0,
    traceIds: [],
    uncorrelatableSpans: [],
    overflowed: false,
  },
  trustedActions: {
    runCount: 0,
    traceIds: [],
    uncorrelatableSpans: [],
    overflowed: false,
  },
  responseVerification: {
    runCount: 0,
    traceIds: [],
    uncorrelatableSpans: [],
    overflowed: false,
  },
};
let traceSettleDeadline: number | undefined;
let traceSettleCompleted = false;
const traceReadinessDeadline = Date.now() + TRACE_READINESS_TIMEOUT_MS;

while (true) {
  agentTurns = 0;
  monitorTurns = 0;
  rootRunCount = 0;
  agentTraceIdsByKind = new Map();
  const rootRuns: ProductionTraceRun[] = [];
  for await (const run of client.listRuns({
    projectName,
    isRoot: true,
    startTime: startedAt,
    filter: productionProbeMetadataFilter(probeRunId),
    limit: rootQueryLimit,
  })) {
    rootRunCount += 1;
    rootRuns.push(run);
    if (run.name === 'agent_turn') agentTurns += 1;
    if (run.name === 'post_turn_monitor') monitorTurns += 1;
  }
  rootQueryOverflowed = rootRunCount === rootQueryLimit;
  rootCoverage = classifyRootRunsByClientMessageId(
    rootRuns,
    expectedClientMessageIds,
  );
  for (const [
    clientMessageId,
    traceIds,
  ] of Object.entries(rootCoverage.agent.byClientMessageId)) {
    const kind = probeKindByClientMessageId.get(clientMessageId);
    if (!kind) continue;
    for (const traceId of traceIds) {
      agentTraceIdsByKind.set(traceId, kind);
    }
  }
  nodeSpans = await collectGraphNodeSpanSnapshots(
    agentTraceIdsByKind.keys(),
  );

  const greetingTraceIds = new Set(
    [...agentTraceIdsByKind]
      .filter(([, kind]) => kind === 'greeting')
      .map(([id]) => id),
  );
  const menuTraceIds = new Set(
    [...agentTraceIdsByKind]
      .filter(([, kind]) => kind === 'menu')
      .map(([id]) => id),
  );
  const menuToolTraceIds = new Set(
    nodeSpans.tools.traceIds.filter((id) => menuTraceIds.has(id)),
  );
  const greetingModelTraceIds = nodeSpans.model.traceIds.filter(
    (id) => greetingTraceIds.has(id),
  );
  const menuModelTraceIds = nodeSpans.model.traceIds.filter(
    (id) => menuTraceIds.has(id),
  );
  const nodeQueryOverflowed = Object.values(nodeSpans).some(
    (snapshot) => snapshot.overflowed,
  );
  const nodeSpansCorrelatable = Object.values(nodeSpans).every(
    (snapshot) => snapshot.uncorrelatableSpans.length === 0,
  );
  const rootIdentityCoverageReady =
    rootCoverage.uncorrelatableRoots.length === 0 &&
    rootCoverage.agent.missingClientMessageIds.length === 0 &&
    rootCoverage.agent.duplicateClientMessageIds.length === 0 &&
    rootCoverage.monitor.missingClientMessageIds.length === 0 &&
    rootCoverage.monitor.duplicateClientMessageIds.length === 0;
  const positiveTraceGatesReady =
    agentTurns === expectedAgentTurns &&
    monitorTurns === expectedAgentTurns &&
    agentTraceIdsByKind.size === expectedAgentTurns &&
    rootIdentityCoverageReady &&
    everyTraceHasExactCount(
      greetingTraceIds,
      greetingModelTraceIds,
      1,
    ) &&
    everyTraceHasExactCount(menuTraceIds, menuModelTraceIds, 2) &&
    nodeSpans.responseModel.traceIds.length === 0 &&
    nodeSpans.trustedActions.traceIds.length === 0 &&
    everyTraceHasExactCount(
      agentTraceIdsByKind.keys(),
      nodeSpans.responseVerification.traceIds,
      1,
    ) &&
    nodeSpans.tools.traceIds.every((id) => menuTraceIds.has(id)) &&
    menuToolTraceIds.size === iterations &&
    nodeSpansCorrelatable;
  const now = Date.now();

  if (rootQueryOverflowed || nodeQueryOverflowed) break;
  if (positiveTraceGatesReady) {
    traceSettleDeadline ??= now + TRACE_SETTLE_INTERVAL_MS;
    if (now >= traceSettleDeadline) {
      traceSettleCompleted = true;
      break;
    }
  } else {
    traceSettleDeadline = undefined;
    if (now >= traceReadinessDeadline) break;
  }
  await new Promise((resolveDelay) => {
    setTimeout(resolveDelay, TRACE_POLL_INTERVAL_MS);
  });
}

const greetingTraceIds = new Set(
  [...agentTraceIdsByKind]
    .filter(([, kind]) => kind === 'greeting')
    .map(([id]) => id),
);
const menuTraceIds = new Set(
  [...agentTraceIdsByKind]
    .filter(([, kind]) => kind === 'menu')
    .map(([id]) => id),
);
const greetingModelSpans = nodeSpans.model.traceIds.filter(
  (id) => greetingTraceIds.has(id),
).length;
const menuModelSpans = nodeSpans.model.traceIds.filter(
  (id) => menuTraceIds.has(id),
).length;
const greetingResponseModelSpans = nodeSpans.responseModel.traceIds.filter(
  (id) => greetingTraceIds.has(id),
).length;
const menuResponseModelSpans = nodeSpans.responseModel.traceIds.filter(
  (id) => menuTraceIds.has(id),
).length;
const greetingToolExecutionSpans = nodeSpans.tools.traceIds.filter(
  (id) => greetingTraceIds.has(id),
).length;
const menuToolExecutionTraceIds = new Set(
  nodeSpans.tools.traceIds.filter((id) => menuTraceIds.has(id)),
);
const greetingTrustedActionSpans = nodeSpans.trustedActions.traceIds.filter(
  (id) => greetingTraceIds.has(id),
).length;
const menuTrustedActionSpans = nodeSpans.trustedActions.traceIds.filter(
  (id) => menuTraceIds.has(id),
).length;
const greetingResponseVerificationSpans =
  nodeSpans.responseVerification.traceIds.filter(
    (id) => greetingTraceIds.has(id),
  ).length;
const menuResponseVerificationSpans =
  nodeSpans.responseVerification.traceIds.filter(
    (id) => menuTraceIds.has(id),
  ).length;
const traceFailures: string[] = [];

if (agentTurns !== expectedAgentTurns) {
  traceFailures.push('agent_turn_roots');
}
if (monitorTurns !== expectedAgentTurns) {
  traceFailures.push('post_turn_monitor_roots');
}
if (rootQueryOverflowed) traceFailures.push('root_query_overflow');
if (agentTraceIdsByKind.size !== expectedAgentTurns) {
  traceFailures.push('agent_turn_client_message_ids');
}
if (rootCoverage.uncorrelatableRoots.length > 0) {
  traceFailures.push('root_identity_uncorrelatable');
}
if (rootCoverage.agent.missingClientMessageIds.length > 0) {
  traceFailures.push('agent_root_request_coverage');
}
if (rootCoverage.agent.duplicateClientMessageIds.length > 0) {
  traceFailures.push('agent_root_request_duplicates');
}
if (rootCoverage.monitor.missingClientMessageIds.length > 0) {
  traceFailures.push('monitor_root_request_coverage');
}
if (rootCoverage.monitor.duplicateClientMessageIds.length > 0) {
  traceFailures.push('monitor_root_request_duplicates');
}
for (const [key, snapshot] of Object.entries(nodeSpans) as Array<
  [GraphNodeSpanKey, GraphNodeSpanSnapshot]
>) {
  if (snapshot.overflowed) {
    traceFailures.push(`${key}_node_query_overflow`);
  }
  if (snapshot.uncorrelatableSpans.length > 0) {
    traceFailures.push(`${key}_node_uncorrelatable_spans`);
  }
}
if (
  !everyTraceHasExactCount(
    greetingTraceIds,
    nodeSpans.model.traceIds.filter((id) => greetingTraceIds.has(id)),
    1,
  )
) {
  traceFailures.push('greeting_call_model_count');
}
if (
  !everyTraceHasExactCount(
    menuTraceIds,
    nodeSpans.model.traceIds.filter((id) => menuTraceIds.has(id)),
    2,
  )
) {
  traceFailures.push('menu_call_model_count');
}
if (nodeSpans.responseModel.traceIds.length !== 0) {
  traceFailures.push('low_risk_call_response_model_spans');
}
if (nodeSpans.trustedActions.traceIds.length !== 0) {
  traceFailures.push('low_risk_execute_trusted_action_spans');
}
if (
  !everyTraceHasExactCount(
    new Set([...greetingTraceIds, ...menuTraceIds]),
    nodeSpans.responseVerification.traceIds,
    1,
  )
) {
  traceFailures.push('response_verification_count');
}
if (greetingToolExecutionSpans !== 0) {
  traceFailures.push('greeting_execute_tools_spans');
}
if (
  nodeSpans.tools.traceIds.some((id) => !menuTraceIds.has(id))
) {
  traceFailures.push('unexpected_execute_tools_spans');
}
if (menuToolExecutionTraceIds.size !== iterations) {
  traceFailures.push('menu_execute_tools_trace_coverage');
}
if (!traceSettleCompleted) {
  traceFailures.push('trace_settle_incomplete');
}

const traceGate = traceFailures.length === 0;
const report = {
  schemaVersion: 2,
  probeRunId,
  chatBaseUrl,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  release,
  readiness,
  projectName,
  targets,
  latency,
  traces: {
    runtime: KFC_AGENT_RUNTIME_ID,
    agentTurns,
    monitorTurns,
    rootRuns: rootRunCount,
    rootQueryLimit,
    rootQueryOverflowed,
    rootCoverage,
    agentTraceIdsByKind: {
      greeting: greetingTraceIds.size,
      menu: menuTraceIds.size,
    },
    graphNodeSpanQueryLimit,
    graphNodes: {
      callModel: {
        name: productionLatencyGraphNodeSpans.model,
        ...nodeSpans.model,
      },
      callResponseModel: {
        name: productionLatencyGraphNodeSpans.responseModel,
        ...nodeSpans.responseModel,
      },
      executeTools: {
        name: productionLatencyGraphNodeSpans.tools,
        ...nodeSpans.tools,
        menuTraceCoverage: menuToolExecutionTraceIds.size,
      },
      executeTrustedAction: {
        name: productionLatencyGraphNodeSpans.trustedActions,
        ...nodeSpans.trustedActions,
      },
      verifyResponse: {
        name: productionLatencyGraphNodeSpans.responseVerification,
        ...nodeSpans.responseVerification,
      },
    },
    byKind: {
      greeting: {
        modelSpans: greetingModelSpans,
        responseModelSpans: greetingResponseModelSpans,
        toolExecutionSpans: greetingToolExecutionSpans,
        trustedActionSpans: greetingTrustedActionSpans,
        responseVerificationSpans: greetingResponseVerificationSpans,
      },
      menu: {
        modelSpans: menuModelSpans,
        responseModelSpans: menuResponseModelSpans,
        toolExecutionSpans: nodeSpans.tools.traceIds.filter(
          (id) => menuTraceIds.has(id),
        ).length,
        trustedActionSpans: menuTrustedActionSpans,
        responseVerificationSpans: menuResponseVerificationSpans,
      },
    },
    expected: {
      agentRoots: expectedAgentTurns,
      monitorRoots: expectedAgentTurns,
      greetingModelNodesPerTrace: 1,
      menuModelNodesPerTrace: 2,
      lowRiskResponseModelNodes: 0,
      lowRiskTrustedActionNodes: 0,
      responseVerificationNodesPerTrace: 1,
      greetingToolExecutionNodes: 0,
      menuToolExecutionTraceCoverage: iterations,
    },
    settle: {
      intervalMs: TRACE_SETTLE_INTERVAL_MS,
      completed: traceSettleCompleted,
    },
    failures: traceFailures,
    ok: traceGate,
  },
  samples,
};

const reportDir = resolve(
  process.cwd(),
  '../../artifacts/production-latency',
);
await mkdir(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `${probeRunId}.json`);
await writeFile(
  reportPath,
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.info(JSON.stringify({
  type: 'production_latency_summary',
  reportPath,
  ...report,
}));
if (!latency.ok || !traceGate) process.exitCode = 1;
