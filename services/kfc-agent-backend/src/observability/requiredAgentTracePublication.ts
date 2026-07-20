export type PublishedAgentTraceRunType = 'chain' | 'llm' | 'tool';
export type PublishedAgentTraceCompletion =
  | 'running'
  | 'succeeded'
  | 'failed';

export interface RequiredAgentTraceRunExpectation {
  id: string;
  traceId: string;
  parentRunId?: string;
  name: string;
  runType: PublishedAgentTraceRunType;
  category: string;
  metadataDigest: string;
  inputDigest: string;
  outputDigest: string;
  completion: Exclude<PublishedAgentTraceCompletion, 'running'>;
}

export interface PublishedAgentTraceRun {
  id: string;
  traceId: string;
  parentRunId?: string;
  name: string;
  runType: PublishedAgentTraceRunType;
  category: string;
  metadataDigest: string;
  inputDigest: string;
  outputDigest: string;
  completion: PublishedAgentTraceCompletion;
  startTimeMs: number;
  endTimeMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface RequiredAgentTracePublicationClient {
  listRuns(query: {
    projectName: string;
    runIds: readonly string[];
  }): Promise<readonly PublishedAgentTraceRun[]>;
}

export interface RequiredAgentTracePublicationVerification {
  verified: true;
  flushVerified: true;
  readbackVerified: true;
  queryAttempts: number;
  runIds: string[];
  traceIds: string[];
  latency: {
    totalMs: number;
    modelMs: number;
    toolMs: number;
  };
  usage:
    | {
        status: 'reported';
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }
    | { status: 'provider_did_not_report' };
  cost: { status: 'provider_did_not_report' };
}

interface RequiredAgentTracePublicationInput {
  target: {
    apiUrl: string;
    projectName: string;
  };
  flushSucceeded: boolean;
  mode: 'text' | 'genui';
  expectedRuns: readonly RequiredAgentTraceRunExpectation[];
  client: RequiredAgentTracePublicationClient;
}

const APAC_LANGSMITH_API_URL =
  'https://apac.api.smith.langchain.com';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(code: string): never {
  throw new Error(code);
}

function isNonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validExpectation(run: RequiredAgentTraceRunExpectation): boolean {
  return (
    UUID_PATTERN.test(run.id) &&
    UUID_PATTERN.test(run.traceId) &&
    (run.parentRunId === undefined || UUID_PATTERN.test(run.parentRunId)) &&
    run.name.length > 0 &&
    run.category.length > 0 &&
    DIGEST_PATTERN.test(run.metadataDigest) &&
    DIGEST_PATTERN.test(run.inputDigest) &&
    DIGEST_PATTERN.test(run.outputDigest)
  );
}

const BASE_REQUIRED_CATEGORIES = [
  'agent_loop',
  'graph_node',
  'model',
  'tool',
  'approval',
  'verified_state',
] as const;
const ALLOWED_SPAN_CATEGORIES = new Set([
  ...BASE_REQUIRED_CATEGORIES,
  'retry',
  'genui_projection',
]);

function assertExpectedCategories(
  mode: RequiredAgentTracePublicationInput['mode'],
  runs: readonly RequiredAgentTraceRunExpectation[],
): void {
  const required =
    mode === 'genui'
      ? [...BASE_REQUIRED_CATEGORIES, 'genui_projection']
      : BASE_REQUIRED_CATEGORIES;
  const roots = runs.filter(({ parentRunId }) => parentRunId === undefined);
  if (
    roots.length === 0 ||
    runs.some(
      ({ category, runType }) =>
        !ALLOWED_SPAN_CATEGORIES.has(category) ||
        (category === 'model' && runType !== 'llm') ||
        (category === 'tool' && runType !== 'tool') ||
        (mode === 'text' && category === 'genui_projection'),
    ) ||
    roots.some(({ traceId }) => {
      const observed = new Set(
        runs
          .filter((run) => run.traceId === traceId)
          .map(({ category }) => category),
      );
      return required.some((category) => !observed.has(category));
    })
  ) {
    fail('agent_required_trace_categories_invalid');
  }
}

function sameRun(
  expected: RequiredAgentTraceRunExpectation,
  published: PublishedAgentTraceRun,
): boolean {
  return (
    published.id === expected.id &&
    published.traceId === expected.traceId &&
    published.parentRunId === expected.parentRunId &&
    published.name === expected.name &&
    published.runType === expected.runType &&
    published.category === expected.category &&
    published.metadataDigest === expected.metadataDigest &&
    published.inputDigest === expected.inputDigest &&
    published.outputDigest === expected.outputDigest &&
    published.completion === expected.completion &&
    isNonnegativeFinite(published.startTimeMs) &&
    isNonnegativeFinite(published.endTimeMs) &&
    published.endTimeMs >= published.startTimeMs
  );
}

function duration(run: PublishedAgentTraceRun): number {
  return run.endTimeMs - run.startTimeMs;
}

function aggregateUsage(
  runs: readonly PublishedAgentTraceRun[],
): RequiredAgentTracePublicationVerification['usage'] {
  const modelRuns = runs.filter(({ runType }) => runType === 'llm');
  const runsWithUsage = modelRuns.filter(({ usage }) => usage !== undefined);
  if (runsWithUsage.length === 0) {
    return { status: 'provider_did_not_report' };
  }
  if (runsWithUsage.length !== modelRuns.length) {
    fail('agent_required_trace_publication_invalid');
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const run of runsWithUsage) {
    const usage = run.usage;
    if (
      usage === undefined ||
      !Number.isSafeInteger(usage.inputTokens) ||
      !Number.isSafeInteger(usage.outputTokens) ||
      !Number.isSafeInteger(usage.totalTokens) ||
      usage.inputTokens < 0 ||
      usage.outputTokens < 0 ||
      usage.totalTokens !== usage.inputTokens + usage.outputTokens
    ) {
      fail('agent_required_trace_publication_invalid');
    }
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    totalTokens += usage.totalTokens;
    if (
      !Number.isSafeInteger(inputTokens) ||
      !Number.isSafeInteger(outputTokens) ||
      !Number.isSafeInteger(totalTokens)
    ) {
      fail('agent_required_trace_publication_invalid');
    }
  }
  if (totalTokens === 0) {
    fail('agent_required_trace_publication_invalid');
  }
  return {
    status: 'reported',
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function assertPublishedHierarchy(
  runs: readonly PublishedAgentTraceRun[],
  runsById: ReadonlyMap<string, PublishedAgentTraceRun>,
): PublishedAgentTraceRun[] {
  const roots = runs.filter(({ parentRunId }) => parentRunId === undefined);
  const rootsByTrace = new Map<string, PublishedAgentTraceRun>();
  for (const root of roots) {
    if (root.id !== root.traceId || rootsByTrace.has(root.traceId)) {
      fail('agent_required_trace_publication_invalid');
    }
    rootsByTrace.set(root.traceId, root);
  }
  if (roots.length === 0) {
    fail('agent_required_trace_publication_invalid');
  }

  for (const run of runs) {
    const root = rootsByTrace.get(run.traceId);
    if (root === undefined) {
      fail('agent_required_trace_publication_invalid');
    }
    const visited = new Set<string>();
    let current = run;
    while (current.parentRunId !== undefined) {
      if (visited.has(current.id)) {
        fail('agent_required_trace_publication_invalid');
      }
      visited.add(current.id);
      const parent = runsById.get(current.parentRunId);
      if (parent === undefined || parent.traceId !== run.traceId) {
        fail('agent_required_trace_publication_invalid');
      }
      current = parent;
    }
    if (current.id !== root.id) {
      fail('agent_required_trace_publication_invalid');
    }
  }
  return roots;
}

const MAX_RECEIPT_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

function aggregateLatency(
  roots: readonly PublishedAgentTraceRun[],
  runs: readonly PublishedAgentTraceRun[],
): RequiredAgentTracePublicationVerification['latency'] {
  const latency = {
    totalMs: roots.reduce((total, run) => total + duration(run), 0),
    modelMs: runs
      .filter(({ runType }) => runType === 'llm')
      .reduce((total, run) => total + duration(run), 0),
    toolMs: runs
      .filter(({ runType }) => runType === 'tool')
      .reduce((total, run) => total + duration(run), 0),
  };
  if (
    Object.values(latency).some(
      (value) =>
        !Number.isFinite(value) ||
        value < 0 ||
        value > MAX_RECEIPT_DURATION_MS,
    ) ||
    latency.modelMs + latency.toolMs > latency.totalMs
  ) {
    fail('agent_required_trace_publication_invalid');
  }
  return latency;
}

export async function verifyRequiredAgentTracePublication(
  input: RequiredAgentTracePublicationInput,
): Promise<RequiredAgentTracePublicationVerification> {
  if (
    input.target.apiUrl !== APAC_LANGSMITH_API_URL ||
    input.target.projectName.length === 0
  ) {
    fail('agent_required_trace_target_invalid');
  }
  if (!input.flushSucceeded) {
    fail('agent_required_trace_flush_unverified');
  }
  if (
    input.expectedRuns.length === 0 ||
    input.expectedRuns.some((run) => !validExpectation(run))
  ) {
    fail('agent_required_trace_publication_invalid');
  }

  assertExpectedCategories(input.mode, input.expectedRuns);
  const runIds = input.expectedRuns.map(({ id }) => id);
  if (new Set(runIds).size !== runIds.length) {
    fail('agent_required_trace_publication_invalid');
  }

  const publishedRuns = await input.client.listRuns({
    projectName: input.target.projectName,
    runIds,
  });
  const publishedIds = publishedRuns.map(({ id }) => id);
  if (
    publishedRuns.length !== input.expectedRuns.length ||
    new Set(publishedIds).size !== publishedIds.length ||
    publishedIds.some((id) => !runIds.includes(id))
  ) {
    fail('agent_required_trace_publication_invalid');
  }

  const publishedById = new Map(
    publishedRuns.map((run) => [run.id, run]),
  );
  for (const expected of input.expectedRuns) {
    const published = publishedById.get(expected.id);
    if (published === undefined || !sameRun(expected, published)) {
      fail('agent_required_trace_publication_invalid');
    }
  }

  const roots = assertPublishedHierarchy(publishedRuns, publishedById);
  const latency = aggregateLatency(roots, publishedRuns);

  return {
    verified: true,
    flushVerified: true,
    readbackVerified: true,
    queryAttempts: 1,
    runIds,
    traceIds: [...new Set(roots.map(({ traceId }) => traceId))],
    latency,
    usage: aggregateUsage(publishedRuns),
    cost: { status: 'provider_did_not_report' },
  };
}
