const CURRENT_AGENT_RUNTIME = 'langgraph-stategraph-v1';
const CURRENT_GRAPH_NODES = {
  callModel: 'call_model',
  callResponseModel: 'call_response_model',
  executeTools: 'execute_tools',
  executeTrustedAction: 'execute_trusted_action',
  verifyResponse: 'verify_response',
};
const CURRENT_SAMPLES_PER_KIND = 20;
const CURRENT_TARGETS = {
  greetingP95Ms: 6000,
  menuP95Ms: 8000,
  overallP95Ms: 8000,
};
const CURRENT_MODEL_IDENTITIES = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini',
  },
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low',
  },
};

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Production latency report ${label} must be an object`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Production latency report ${label} must be an array`);
  }
  return value;
}

function emptyArray(value, label) {
  if (array(value, label).length !== 0) {
    throw new Error(`Production latency report ${label} must be empty`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `Production latency report ${label} keys are not current: ${actual.join(',')}`,
    );
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Production latency report ${label} must be a non-empty string`,
    );
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Production latency report ${label} must be finite`);
  }
  return value;
}

function falseBoolean(value, label) {
  if (value !== false) {
    throw new Error(`Production latency report ${label} must be false`);
  }
  return value;
}

function currentModelIdentity(value, label) {
  const identity = record(value, label);
  exactKeys(identity, ['model', 'profile', 'provider'], label);
  const provider = nonEmptyString(identity.provider, `${label}.provider`);
  const expected = CURRENT_MODEL_IDENTITIES[provider];
  if (!expected) {
    throw new Error(
      `Production latency report ${label}.provider is unsupported`,
    );
  }
  if (
    identity.model !== expected.model ||
    identity.profile !== expected.profile
  ) {
    throw new Error(
      `Production latency report ${label} is not a reviewed model profile`,
    );
  }
  return expected;
}

function sameModelIdentity(actual, expected, label) {
  if (
    actual.provider !== expected.provider ||
    actual.model !== expected.model ||
    actual.profile !== expected.profile
  ) {
    throw new Error(
      `Production latency report ${label} model identity does not match`,
    );
  }
}

function releaseIdentity(value, label, builtAtKey) {
  const release = record(value, label);
  exactKeys(
    release,
    ['deploymentId', 'dirty', 'gitSha', builtAtKey],
    label,
  );
  return {
    gitSha: nonEmptyString(release.gitSha, `${label}.gitSha`),
    deploymentId: nonEmptyString(
      release.deploymentId,
      `${label}.deploymentId`,
    ),
    builtAt: nonEmptyString(release[builtAtKey], `${label}.${builtAtKey}`),
    dirty: falseBoolean(release.dirty, `${label}.dirty`),
  };
}

function assertSanitizedReadiness(value, publicReleaseValue) {
  const readiness = record(value, 'readiness');
  exactKeys(readiness, ['checks', 'ok', 'proof', 'release'], 'readiness');
  if (readiness.ok !== true) {
    throw new Error('Production latency report readiness must be accepted');
  }

  const checks = record(readiness.checks, 'readiness.checks');
  exactKeys(
    checks,
    ['agent', 'responseVerifier'],
    'readiness.checks',
  );
  const agentCheck = record(checks.agent, 'readiness.checks.agent');
  exactKeys(
    agentCheck,
    ['configured', 'model', 'ok', 'profile', 'provider'],
    'readiness.checks.agent',
  );
  if (agentCheck.ok !== true || agentCheck.configured !== true) {
    throw new Error(
      'Production latency report agent readiness is not configured and healthy',
    );
  }
  const agent = currentModelIdentity(
    {
      provider: agentCheck.provider,
      model: agentCheck.model,
      profile: agentCheck.profile,
    },
    'readiness.checks.agent identity',
  );

  const verifierCheck = record(
    checks.responseVerifier,
    'readiness.checks.responseVerifier',
  );
  exactKeys(
    verifierCheck,
    ['configured', 'model', 'ok', 'profile', 'provider', 'required'],
    'readiness.checks.responseVerifier',
  );
  if (
    verifierCheck.ok !== true ||
    verifierCheck.configured !== true ||
    verifierCheck.required !== true
  ) {
    throw new Error(
      'Production latency report response verifier is not required, configured, and healthy',
    );
  }
  const responseVerifier = currentModelIdentity(
    {
      provider: verifierCheck.provider,
      model: verifierCheck.model,
      profile: verifierCheck.profile,
    },
    'readiness.checks.responseVerifier identity',
  );
  if (agent.provider === responseVerifier.provider) {
    throw new Error(
      'Production latency report response verifier provider must differ from the agent provider',
    );
  }

  const proof = record(readiness.proof, 'readiness.proof');
  exactKeys(proof, ['deployment', 'versions'], 'readiness.proof');
  const versions = record(
    proof.versions,
    'readiness.proof.versions',
  );
  exactKeys(
    versions,
    ['agent', 'responseVerifier'],
    'readiness.proof.versions',
  );
  const proofAgent = currentModelIdentity(
    versions.agent,
    'readiness.proof.versions.agent',
  );
  const proofResponseVerifier = currentModelIdentity(
    versions.responseVerifier,
    'readiness.proof.versions.responseVerifier',
  );
  sameModelIdentity(
    proofAgent,
    agent,
    'readiness.proof.versions.agent',
  );
  sameModelIdentity(
    proofResponseVerifier,
    responseVerifier,
    'readiness.proof.versions.responseVerifier',
  );

  const readinessRelease = releaseIdentity(
    readiness.release,
    'readiness.release',
    'releaseBuiltAt',
  );
  const proofDeployment = releaseIdentity(
    proof.deployment,
    'readiness.proof.deployment',
    'builtAt',
  );
  if (
    readinessRelease.gitSha !== proofDeployment.gitSha ||
    readinessRelease.deploymentId !== proofDeployment.deploymentId ||
    readinessRelease.builtAt !== proofDeployment.builtAt
  ) {
    throw new Error(
      'Production latency report readiness release does not match its proof deployment',
    );
  }

  const publicRelease = record(publicReleaseValue, 'release');
  if (
    publicRelease.gitSha !== readinessRelease.gitSha ||
    publicRelease.releaseBuiltAt !== readinessRelease.builtAt ||
    publicRelease.dirty !== false
  ) {
    throw new Error(
      'Production latency report readiness is not bound to the public release',
    );
  }
  return readiness;
}

function sortedUniqueStrings(value, label) {
  const values = array(value, label).map((entry, index) =>
    nonEmptyString(entry, `${label}[${index}]`));
  const unique = [...new Set(values)].sort();
  if (unique.length !== values.length) {
    throw new Error(`Production latency report ${label} must be unique`);
  }
  return unique;
}

function sameStrings(actual, expected, label) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Production latency report ${label} does not match requests`);
  }
}

function rootKindCoverage(value, expectedClientMessageIds, label) {
  const coverage = record(value, label);
  exactKeys(coverage, [
    'byClientMessageId',
    'duplicateClientMessageIds',
    'missingClientMessageIds',
  ], label);
  emptyArray(
    coverage.missingClientMessageIds,
    `${label}.missingClientMessageIds`,
  );
  emptyArray(
    coverage.duplicateClientMessageIds,
    `${label}.duplicateClientMessageIds`,
  );
  const byClientMessageId = record(
    coverage.byClientMessageId,
    `${label}.byClientMessageId`,
  );
  sameStrings(
    Object.keys(byClientMessageId),
    expectedClientMessageIds,
    `${label}.byClientMessageId`,
  );
  const traceIds = [];
  for (const clientMessageId of expectedClientMessageIds) {
    const roots = array(
      byClientMessageId[clientMessageId],
      `${label}.byClientMessageId.${clientMessageId}`,
    );
    if (roots.length !== 1) {
      throw new Error(
        `Production latency report ${label} must have exactly one root for ${clientMessageId}`,
      );
    }
    traceIds.push(nonEmptyString(
      roots[0],
      `${label}.byClientMessageId.${clientMessageId}[0]`,
    ));
  }
  if (new Set(traceIds).size !== traceIds.length) {
    throw new Error(
      `Production latency report ${label} root trace IDs must be unique`,
    );
  }
  return traceIds;
}

function graphNode(value, expectedName, label) {
  const node = record(value, label);
  if (node.name !== expectedName) {
    throw new Error(
      `Production latency report ${label} must use ${expectedName}`,
    );
  }
  if (node.overflowed !== false) {
    throw new Error(`Production latency report ${label} query overflowed`);
  }
  emptyArray(node.uncorrelatableSpans, `${label}.uncorrelatableSpans`);
  const traceIds = array(node.traceIds, `${label}.traceIds`).map(
    (traceId, index) =>
      nonEmptyString(traceId, `${label}.traceIds[${index}]`),
  );
  if (node.runCount !== traceIds.length) {
    throw new Error(
      `Production latency report ${label}.runCount does not match its spans`,
    );
  }
  return traceIds;
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function exactChildCoverage(
  traceIds,
  expectedTraceIds,
  expectedCount,
  label,
) {
  const actualCounts = counts(traceIds);
  const expected = new Set(expectedTraceIds);
  for (const traceId of actualCounts.keys()) {
    if (!expected.has(traceId)) {
      throw new Error(
        `Production latency report ${label} has an unexpected root trace`,
      );
    }
  }
  for (const traceId of expected) {
    if ((actualCounts.get(traceId) ?? 0) !== expectedCount) {
      throw new Error(
        `Production latency report ${label} coverage is not exact`,
      );
    }
  }
}

function atLeastOneChildPerRoot(traceIds, expectedTraceIds, label) {
  const actualCounts = counts(traceIds);
  const expected = new Set(expectedTraceIds);
  for (const traceId of actualCounts.keys()) {
    if (!expected.has(traceId)) {
      throw new Error(
        `Production latency report ${label} has an unexpected root trace`,
      );
    }
  }
  for (const traceId of expected) {
    if ((actualCounts.get(traceId) ?? 0) < 1) {
      throw new Error(
        `Production latency report ${label} is missing a request trace`,
      );
    }
  }
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

function latencySummary(samples) {
  return {
    count: samples.length,
    p95Ms: percentile(samples.map((sample) => sample.durationMs), 0.95),
  };
}

function assertLatencySummary(value, expected, label) {
  const summary = record(value, label);
  exactKeys(summary, ['count', 'p95Ms'], label);
  if (
    summary.count !== expected.count ||
    summary.p95Ms !== expected.p95Ms
  ) {
    throw new Error(
      `Production latency report ${label} does not match its samples`,
    );
  }
}

export function assertCurrentProductionLatencyReport(input) {
  const report = record(input, 'root');
  if (report.schemaVersion !== 2) {
    throw new Error('Production latency report schemaVersion must be 2');
  }
  assertSanitizedReadiness(report.readiness, report.release);

  const samples = array(report.samples, 'samples');
  if (samples.length === 0) {
    throw new Error('Production latency report samples must not be empty');
  }
  const sampleKindByClientMessageId = new Map();
  const validatedSamples = [];
  for (const [index, entry] of samples.entries()) {
    const sample = record(entry, `samples[${index}]`);
    const clientMessageId = nonEmptyString(
      sample.clientMessageId,
      `samples[${index}].clientMessageId`,
    );
    if (sampleKindByClientMessageId.has(clientMessageId)) {
      throw new Error(
        'Production latency report sample clientMessageIds must be unique',
      );
    }
    if (sample.kind !== 'greeting' && sample.kind !== 'menu') {
      throw new Error(
        `Production latency report samples[${index}].kind is invalid`,
      );
    }
    const durationMs = finiteNumber(
      sample.durationMs,
      `samples[${index}].durationMs`,
    );
    if (
      durationMs < 0 ||
      sample.status !== 200 ||
      typeof sample.responseText !== 'string' ||
      sample.responseText.length === 0 ||
      sample.ok !== true
    ) {
      throw new Error(
        `Production latency report samples[${index}] is not a successful HTTP response`,
      );
    }
    sampleKindByClientMessageId.set(clientMessageId, sample.kind);
    validatedSamples.push({
      kind: sample.kind,
      durationMs,
    });
  }
  const expectedClientMessageIds = [...sampleKindByClientMessageId.keys()]
    .sort();
  const greetingCount = [...sampleKindByClientMessageId.values()]
    .filter((kind) => kind === 'greeting').length;
  const menuCount = samples.length - greetingCount;
  if (
    greetingCount !== CURRENT_SAMPLES_PER_KIND ||
    menuCount !== CURRENT_SAMPLES_PER_KIND
  ) {
    throw new Error(
      `Production latency report must include exactly ${CURRENT_SAMPLES_PER_KIND} greeting and ${CURRENT_SAMPLES_PER_KIND} menu samples`,
    );
  }

  const targets = record(report.targets, 'targets');
  exactKeys(
    targets,
    ['greetingP95Ms', 'menuP95Ms', 'overallP95Ms'],
    'targets',
  );
  const greetingP95Ms = finiteNumber(
    targets.greetingP95Ms,
    'targets.greetingP95Ms',
  );
  const menuP95Ms = finiteNumber(
    targets.menuP95Ms,
    'targets.menuP95Ms',
  );
  const overallP95Ms = finiteNumber(
    targets.overallP95Ms,
    'targets.overallP95Ms',
  );
  if (greetingP95Ms <= 0 || menuP95Ms <= 0 || overallP95Ms <= 0) {
    throw new Error('Production latency report targets must be positive');
  }
  if (
    greetingP95Ms !== CURRENT_TARGETS.greetingP95Ms ||
    menuP95Ms !== CURRENT_TARGETS.menuP95Ms ||
    overallP95Ms !== CURRENT_TARGETS.overallP95Ms
  ) {
    throw new Error(
      'Production latency report targets do not match the reviewed release contract',
    );
  }
  const greetingSamples = validatedSamples.filter(
    (sample) => sample.kind === 'greeting',
  );
  const menuSamples = validatedSamples.filter(
    (sample) => sample.kind === 'menu',
  );
  const expectedLatency = {
    overall: latencySummary(validatedSamples),
    greeting: latencySummary(greetingSamples),
    menu: latencySummary(menuSamples),
  };
  if (
    !(expectedLatency.greeting.p95Ms < greetingP95Ms) ||
    !(expectedLatency.menu.p95Ms < menuP95Ms) ||
    !(expectedLatency.overall.p95Ms < overallP95Ms)
  ) {
    throw new Error(
      'Production latency report samples exceed the declared targets',
    );
  }
  const latency = record(report.latency, 'latency');
  exactKeys(
    latency,
    ['byKind', 'failures', 'ok', 'overall', 'successRate'],
    'latency',
  );
  if (latency.ok !== true || latency.successRate !== 1) {
    throw new Error('Production latency report latency gate is not accepted');
  }
  emptyArray(latency.failures, 'latency.failures');
  assertLatencySummary(
    latency.overall,
    expectedLatency.overall,
    'latency.overall',
  );
  const latencyByKind = record(latency.byKind, 'latency.byKind');
  exactKeys(latencyByKind, ['greeting', 'menu'], 'latency.byKind');
  assertLatencySummary(
    latencyByKind.greeting,
    expectedLatency.greeting,
    'latency.byKind.greeting',
  );
  assertLatencySummary(
    latencyByKind.menu,
    expectedLatency.menu,
    'latency.byKind.menu',
  );

  const traces = record(report.traces, 'traces');
  if (traces.runtime !== CURRENT_AGENT_RUNTIME) {
    throw new Error(
      `Production latency report runtime must be ${CURRENT_AGENT_RUNTIME}`,
    );
  }
  if (traces.ok !== true) {
    throw new Error('Production latency report trace gate is not accepted');
  }
  emptyArray(traces.failures, 'traces.failures');
  if (traces.rootQueryOverflowed !== false) {
    throw new Error('Production latency report root query overflowed');
  }
  const settle = record(traces.settle, 'traces.settle');
  if (settle.completed !== true) {
    throw new Error('Production latency report trace settle did not complete');
  }

  const rootCoverage = record(traces.rootCoverage, 'traces.rootCoverage');
  exactKeys(rootCoverage, [
    'agent',
    'expectedClientMessageIds',
    'monitor',
    'uncorrelatableRoots',
  ], 'traces.rootCoverage');
  const declaredExpectedClientMessageIds = sortedUniqueStrings(
    rootCoverage.expectedClientMessageIds,
    'traces.rootCoverage.expectedClientMessageIds',
  );
  sameStrings(
    declaredExpectedClientMessageIds,
    expectedClientMessageIds,
    'traces.rootCoverage.expectedClientMessageIds',
  );
  emptyArray(
    rootCoverage.uncorrelatableRoots,
    'traces.rootCoverage.uncorrelatableRoots',
  );
  const agentTraceIds = rootKindCoverage(
    rootCoverage.agent,
    expectedClientMessageIds,
    'traces.rootCoverage.agent',
  );
  const monitorTraceIds = rootKindCoverage(
    rootCoverage.monitor,
    expectedClientMessageIds,
    'traces.rootCoverage.monitor',
  );
  if (agentTraceIds.some((traceId) => monitorTraceIds.includes(traceId))) {
    throw new Error(
      'Production latency report agent and monitor root traces must be disjoint',
    );
  }
  if (
    traces.agentTurns !== samples.length ||
    traces.monitorTurns !== samples.length ||
    traces.rootRuns !== samples.length * 2
  ) {
    throw new Error(
      'Production latency report root totals do not match exact request coverage',
    );
  }

  const byKind = record(traces.agentTraceIdsByKind, 'traces.agentTraceIdsByKind');
  exactKeys(byKind, ['greeting', 'menu'], 'traces.agentTraceIdsByKind');
  if (byKind.greeting !== greetingCount || byKind.menu !== menuCount) {
    throw new Error(
      'Production latency report root kind totals do not match samples',
    );
  }

  const graphNodes = record(traces.graphNodes, 'traces.graphNodes');
  exactKeys(
    graphNodes,
    Object.keys(CURRENT_GRAPH_NODES),
    'traces.graphNodes',
  );
  const modelTraceIds = graphNode(
    graphNodes.callModel,
    CURRENT_GRAPH_NODES.callModel,
    'traces.graphNodes.callModel',
  );
  const responseModelTraceIds = graphNode(
    graphNodes.callResponseModel,
    CURRENT_GRAPH_NODES.callResponseModel,
    'traces.graphNodes.callResponseModel',
  );
  const toolTraceIds = graphNode(
    graphNodes.executeTools,
    CURRENT_GRAPH_NODES.executeTools,
    'traces.graphNodes.executeTools',
  );
  const trustedActionTraceIds = graphNode(
    graphNodes.executeTrustedAction,
    CURRENT_GRAPH_NODES.executeTrustedAction,
    'traces.graphNodes.executeTrustedAction',
  );
  const verificationTraceIds = graphNode(
    graphNodes.verifyResponse,
    CURRENT_GRAPH_NODES.verifyResponse,
    'traces.graphNodes.verifyResponse',
  );
  const greetingTraceIds = agentTraceIds.filter((_, index) =>
    sampleKindByClientMessageId.get(expectedClientMessageIds[index]) ===
    'greeting');
  const menuTraceIds = agentTraceIds.filter((_, index) =>
    sampleKindByClientMessageId.get(expectedClientMessageIds[index]) ===
    'menu');
  exactChildCoverage(
    modelTraceIds.filter((traceId) => greetingTraceIds.includes(traceId)),
    greetingTraceIds,
    1,
    'traces.graphNodes.callModel.greeting',
  );
  exactChildCoverage(
    modelTraceIds.filter((traceId) => menuTraceIds.includes(traceId)),
    menuTraceIds,
    2,
    'traces.graphNodes.callModel.menu',
  );
  if (modelTraceIds.some((traceId) =>
    !greetingTraceIds.includes(traceId) && !menuTraceIds.includes(traceId))) {
    throw new Error(
      'Production latency report call_model has an unexpected root trace',
    );
  }
  if (
    responseModelTraceIds.length !== 0 ||
    trustedActionTraceIds.length !== 0
  ) {
    throw new Error(
      'Production latency report probes used a structured-action graph node',
    );
  }
  exactChildCoverage(
    verificationTraceIds,
    agentTraceIds,
    1,
    'traces.graphNodes.verifyResponse',
  );
  exactChildCoverage(
    toolTraceIds.filter((traceId) => greetingTraceIds.includes(traceId)),
    greetingTraceIds,
    0,
    'traces.graphNodes.executeTools.greeting',
  );
  atLeastOneChildPerRoot(
    toolTraceIds.filter((traceId) => menuTraceIds.includes(traceId)),
    menuTraceIds,
    'traces.graphNodes.executeTools.menu',
  );
  if (toolTraceIds.some((traceId) =>
    !greetingTraceIds.includes(traceId) && !menuTraceIds.includes(traceId))) {
    throw new Error(
      'Production latency report execute_tools has an unexpected root trace',
    );
  }

  const nodeCountsByKind = record(traces.byKind, 'traces.byKind');
  exactKeys(nodeCountsByKind, ['greeting', 'menu'], 'traces.byKind');
  const assertKindNodeCounts = (value, expectedCounts, label) => {
    const actual = record(value, label);
    exactKeys(actual, Object.keys(expectedCounts), label);
    for (const [key, expectedCount] of Object.entries(expectedCounts)) {
      if (actual[key] !== expectedCount) {
        throw new Error(
          `Production latency report ${label}.${key} does not match node spans`,
        );
      }
    }
  };
  assertKindNodeCounts(nodeCountsByKind.greeting, {
    modelSpans: greetingTraceIds.length,
    responseModelSpans: 0,
    toolExecutionSpans: 0,
    trustedActionSpans: 0,
    responseVerificationSpans: greetingTraceIds.length,
  }, 'traces.byKind.greeting');
  assertKindNodeCounts(nodeCountsByKind.menu, {
    modelSpans: menuTraceIds.length * 2,
    responseModelSpans: 0,
    toolExecutionSpans: toolTraceIds.length,
    trustedActionSpans: 0,
    responseVerificationSpans: menuTraceIds.length,
  }, 'traces.byKind.menu');

  const expected = record(traces.expected, 'traces.expected');
  exactKeys(expected, [
    'agentRoots',
    'greetingModelNodesPerTrace',
    'greetingToolExecutionNodes',
    'lowRiskResponseModelNodes',
    'lowRiskTrustedActionNodes',
    'menuModelNodesPerTrace',
    'menuToolExecutionTraceCoverage',
    'monitorRoots',
    'responseVerificationNodesPerTrace',
  ], 'traces.expected');
  if (
    expected.agentRoots !== samples.length ||
    expected.monitorRoots !== samples.length ||
    expected.greetingModelNodesPerTrace !== 1 ||
    expected.menuModelNodesPerTrace !== 2 ||
    expected.lowRiskResponseModelNodes !== 0 ||
    expected.lowRiskTrustedActionNodes !== 0 ||
    expected.responseVerificationNodesPerTrace !== 1 ||
    expected.greetingToolExecutionNodes !== 0 ||
    expected.menuToolExecutionTraceCoverage !== menuCount
  ) {
    throw new Error(
      'Production latency report declared expectations do not match requests',
    );
  }
  return report;
}

export const currentProductionLatencyRuntime = CURRENT_AGENT_RUNTIME;
export const currentProductionLatencyGraphNodes = CURRENT_GRAPH_NODES;
