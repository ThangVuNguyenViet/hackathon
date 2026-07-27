import { writeFile } from 'node:fs/promises';
import {
  protectedTraceDatasetInventoryDigest,
  type ProtectedTraceQualificationPolicy,
} from '../evaluation/protectedTraceQualificationPolicy.js';
import type {
  AgentTraceApplicability,
  AgentTraceCategory,
  AgentTraceRequirement,
  AgentTraceRunType,
} from './agentTracing.js';
import {
  exactTraceEvidenceMatches,
  isTraceRecord,
  safeBoundedTraceInteger,
} from './langsmithTracePrivacy.js';

export interface RequiredAgentTraceContext {
  executionId: string;
  gitSha: string;
  runtime: {
    runtimeId: string;
    provider: 'openai' | 'google';
    model: string;
    profile: string;
  };
  policy: ProtectedTraceQualificationPolicy;
  remoteDatasetId: string;
  mode: 'text' | 'genui';
  repetition: number;
}

export interface CapturedAgentTraceRun {
  id: string;
  traceId: string;
  parentRunId?: string;
  name: string;
  runType: AgentTraceRunType;
  category: AgentTraceCategory;
  metadata: Record<string, unknown>;
  inputs: Record<string, unknown>;
  applicability?: AgentTraceApplicability;
  completion: {
    status: 'succeeded' | 'failed';
    outputs: Record<string, unknown>;
    error: string | null;
  };
}

export interface PublishedAgentTraceRun {
  id: string;
  trace_id?: string;
  parent_run_id?: string;
  name: string;
  run_type: string;
  start_time?: number | string;
  end_time?: number | string;
  extra?: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
}

export interface RequiredAgentTracePublicationClient {
  readDataset(input: { datasetId: string }): Promise<{ id: string; name: string }>;
  listRuns(input: {
    projectName: string;
    id: string[];
    limit: number;
  }): AsyncIterable<PublishedAgentTraceRun>;
}

export interface VerifiedAgentTraceReceiptPayload {
  schemaVersion: 1;
  artifactKind: 'kfc-verified-agent-trace-receipt';
  target: {
    apiUrl: 'https://apac.api.smith.langchain.com';
    projectName: string;
  };
  context: RequiredAgentTraceContext;
  publication: {
    queryAttempts: number;
    flushVerified: true;
    datasetReadbackVerified: true;
    readbackVerified: true;
  };
  runs: CapturedAgentTraceRun[];
  evidence: {
    latency: { totalMs: number; modelMs: number; toolMs: number };
    providerEconomics: {
      usage:
        | {
            status: 'reported';
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
          }
        | { status: 'provider_did_not_report' };
      cost:
        | { status: 'reported'; currency: 'USD'; amountUsd: number }
        | { status: 'provider_did_not_report' };
    };
  };
}

export interface VerifiedAgentTraceReceipt {
  readonly payload: VerifiedAgentTraceReceiptPayload;
}

const issuedReceipts = new WeakSet<object>();
const APAC_ENDPOINT = 'https://apac.api.smith.langchain.com' as const;
const LEGACY_SPAN_NAMES = new Set([
  'small_talk_router',
  'planner_iteration',
  'response_compose',
]);
const BASE_REQUIRED_CATEGORIES: readonly AgentTraceCategory[] = [
  'agent_loop',
  'graph_node',
  'model',
];
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

export function isVerifiedAgentTraceReceipt(
  value: unknown,
): value is VerifiedAgentTraceReceipt {
  return typeof value === 'object' && value !== null && issuedReceipts.has(value);
}

export function verifiedAgentTraceReceiptPayload(
  receipt: VerifiedAgentTraceReceipt,
): VerifiedAgentTraceReceiptPayload {
  if (!isVerifiedAgentTraceReceipt(receipt)) {
    throw new Error('agent_required_trace_receipt_unverified');
  }
  return receipt.payload;
}

function timestampMs(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function durationMs(run: PublishedAgentTraceRun): number | undefined {
  const started = timestampMs(run.start_time);
  const ended = timestampMs(run.end_time);
  if (started === undefined || ended === undefined) return undefined;
  const duration = ended - started;
  return Number.isFinite(duration) && duration >= 0 && duration <= MAX_DURATION_MS
    ? duration
    : undefined;
}

function metadataOf(run: PublishedAgentTraceRun): Record<string, unknown> | undefined {
  return isTraceRecord(run.extra) && isTraceRecord(run.extra.metadata)
    ? run.extra.metadata
    : undefined;
}

function exactRunMatches(
  run: PublishedAgentTraceRun,
  expected: CapturedAgentTraceRun,
): boolean {
  return run.name === expected.name &&
    run.run_type === expected.runType &&
    run.trace_id === expected.traceId &&
    (run.parent_run_id ?? undefined) === expected.parentRunId &&
    exactTraceEvidenceMatches(metadataOf(run), expected.metadata) &&
    exactTraceEvidenceMatches(run.inputs, expected.inputs) &&
    exactTraceEvidenceMatches(run.outputs ?? {}, expected.completion.outputs) &&
    (run.error ?? null) === expected.completion.error &&
    durationMs(run) !== undefined;
}

function assertCapturedSemantics(runs: readonly CapturedAgentTraceRun[]): void {
  const byId = new Map(runs.map((run) => [run.id, run]));
  if (byId.size !== runs.length || runs.some(({ name }) => LEGACY_SPAN_NAMES.has(name))) {
    throw new Error('agent_required_trace_semantics_invalid');
  }
  if (
    runs.some(
      ({ category, runType, completion }) =>
        completion.status !== 'succeeded' ||
        (category === 'model' && runType !== 'llm') ||
        (category === 'tool' && runType !== 'tool') ||
        (category !== 'model' && category !== 'tool' && runType !== 'chain'),
    )
  ) {
    throw new Error('agent_required_trace_semantics_invalid');
  }
  const roots = runs.filter(({ parentRunId }) => parentRunId === undefined);
  for (const root of roots) {
    if (root.id !== root.traceId || root.category !== 'agent_loop' || !root.applicability) {
      throw new Error('agent_required_trace_semantics_invalid');
    }
    const categories = new Set(
      runs.filter(({ traceId }) => traceId === root.traceId).map(({ category }) => category),
    );
    const required = [
      ...BASE_REQUIRED_CATEGORIES,
      ...(root.applicability.tool === 'required' ? ['tool' as const] : []),
      ...(root.applicability.approval === 'required' ? ['approval' as const] : []),
      ...(root.applicability.verifiedState === 'required'
        ? ['verified_state' as const]
        : []),
      ...(root.applicability.genui === 'required'
        ? ['genui_projection' as const]
        : []),
    ];
    if (
      required.some((category) => !categories.has(category)) ||
      (root.applicability.tool === 'forbidden' && categories.has('tool')) ||
      (root.applicability.approval === 'forbidden' && categories.has('approval')) ||
      (root.applicability.verifiedState === 'forbidden' &&
        categories.has('verified_state')) ||
      (root.applicability.genui === 'forbidden' &&
        categories.has('genui_projection'))
    ) {
      throw new Error('agent_required_trace_categories_invalid');
    }
  }
  if (roots.length === 0) throw new Error('agent_required_trace_semantics_invalid');

  const resolvedRoot = new Map<string, string>();
  const resolveRoot = (run: CapturedAgentTraceRun, path: Set<string>): string => {
    const memoized = resolvedRoot.get(run.id);
    if (memoized) return memoized;
    if (path.has(run.id)) throw new Error('agent_required_trace_hierarchy_invalid');
    if (run.parentRunId === undefined) {
      resolvedRoot.set(run.id, run.id);
      return run.id;
    }
    const parent = byId.get(run.parentRunId);
    if (!parent || parent.traceId !== run.traceId) {
      throw new Error('agent_required_trace_hierarchy_invalid');
    }
    const rootId = resolveRoot(parent, new Set(path).add(run.id));
    resolvedRoot.set(run.id, rootId);
    return rootId;
  };
  for (const run of runs) {
    if (resolveRoot(run, new Set()) !== run.traceId) {
      throw new Error('agent_required_trace_hierarchy_invalid');
    }
  }
}

function usageOf(outputs: Record<string, unknown>) {
  if (!isTraceRecord(outputs.usageMetadata)) return undefined;
  const inputTokens = safeBoundedTraceInteger(outputs.usageMetadata.inputTokens, 10_000_000);
  const outputTokens = safeBoundedTraceInteger(outputs.usageMetadata.outputTokens, 10_000_000);
  const totalTokens = safeBoundedTraceInteger(outputs.usageMetadata.totalTokens, 20_000_000);
  return inputTokens !== undefined &&
    outputTokens !== undefined &&
    totalTokens === inputTokens + outputTokens &&
    totalTokens > 0
    ? { inputTokens, outputTokens, totalTokens }
    : undefined;
}

function costOf(outputs: Record<string, unknown>): number | undefined {
  if (!isTraceRecord(outputs.costMetadata)) return undefined;
  const amount = outputs.costMetadata.amountUsd;
  return outputs.costMetadata.currency === 'USD' &&
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    amount >= 0
    ? amount
    : undefined;
}

interface TimeInterval {
  start: number;
  end: number;
}

function intervalOf(run: PublishedAgentTraceRun): TimeInterval | undefined {
  const start = timestampMs(run.start_time);
  const end = timestampMs(run.end_time);
  return start !== undefined && end !== undefined && end >= start
    ? { start, end }
    : undefined;
}

function coveredDuration(intervals: readonly TimeInterval[]): number | undefined {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  let total = 0;
  let current: TimeInterval | undefined;
  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
    } else if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      total += current.end - current.start;
      current = { ...interval };
    }
  }
  if (current) total += current.end - current.start;
  return Number.isFinite(total) && total >= 0 && total <= MAX_DURATION_MS
    ? total
    : undefined;
}

async function queryOnce(input: {
  client: RequiredAgentTracePublicationClient;
  projectName: string;
  runs: readonly CapturedAgentTraceRun[];
}): Promise<VerifiedAgentTraceReceiptPayload['evidence'] | undefined> {
  const expectedById = new Map(input.runs.map((run) => [run.id, run]));
  const seen = new Set<string>();
  const rootIntervals: TimeInterval[] = [];
  const modelIntervals: TimeInterval[] = [];
  const toolIntervals: TimeInterval[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let usageReports = 0;
  let amountUsd = 0;
  let costReports = 0;
  const ids = [...expectedById.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    for await (const run of input.client.listRuns({
      projectName: input.projectName,
      id: chunk,
      limit: chunk.length,
    })) {
      const expected = expectedById.get(run.id);
      if (!expected || seen.has(run.id) || !exactRunMatches(run, expected)) return undefined;
      const interval = intervalOf(run);
      if (!interval || durationMs(run) === undefined) return undefined;
      if (expected.parentRunId === undefined) rootIntervals.push(interval);
      if (expected.category === 'model') modelIntervals.push(interval);
      if (expected.category === 'tool') toolIntervals.push(interval);
      const usage = usageOf(expected.completion.outputs);
      if (usage) {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        usageReports += 1;
      }
      const cost = costOf(expected.completion.outputs);
      if (cost !== undefined) {
        amountUsd += cost;
        costReports += 1;
      }
      seen.add(run.id);
    }
  }
  const totalMs = coveredDuration(rootIntervals);
  const modelMs = coveredDuration(modelIntervals);
  const toolMs = coveredDuration(toolIntervals);
  const modelRunCount = input.runs.filter(({ category }) => category === 'model').length;
  if (
    seen.size !== expectedById.size ||
    totalMs === undefined ||
    modelMs === undefined ||
    toolMs === undefined ||
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    !Number.isFinite(amountUsd) ||
    (usageReports !== 0 && usageReports !== modelRunCount) ||
    (costReports !== 0 && costReports !== modelRunCount)
  ) return undefined;
  return {
    latency: { totalMs, modelMs, toolMs },
    providerEconomics: {
      usage: usageReports === 0
        ? { status: 'provider_did_not_report' }
        : {
            status: 'reported',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
      cost: costReports === 0
        ? { status: 'provider_did_not_report' }
        : { status: 'reported', currency: 'USD', amountUsd },
    },
  };
}

export async function writeVerifiedAgentTraceReceipt(
  path: string,
  receipt: VerifiedAgentTraceReceipt,
): Promise<void> {
  const payload = verifiedAgentTraceReceiptPayload(receipt);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function isRequirement(value: unknown): value is AgentTraceRequirement {
  return value === 'required' || value === 'optional' || value === 'forbidden';
}

function isRunType(value: unknown): value is AgentTraceRunType {
  return typeof value === 'string' && (
    value === 'chain' || value === 'llm' || value === 'tool'
  );
}

function isCategory(value: unknown): value is AgentTraceCategory {
  return value === 'agent_loop' ||
    value === 'graph_node' ||
    value === 'model' ||
    value === 'tool' ||
    value === 'approval' ||
    value === 'retry' ||
    value === 'verified_state' ||
    value === 'genui_projection';
}

function parsedCapturedRun(value: unknown): CapturedAgentTraceRun | undefined {
  if (
    !isTraceRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.traceId !== 'string' ||
    (value.parentRunId !== undefined && typeof value.parentRunId !== 'string') ||
    typeof value.name !== 'string' ||
    !isRunType(value.runType) ||
    !isCategory(value.category) ||
    !isTraceRecord(value.metadata) ||
    !isTraceRecord(value.inputs) ||
    !isTraceRecord(value.completion) ||
    (value.completion.status !== 'succeeded' && value.completion.status !== 'failed') ||
    !isTraceRecord(value.completion.outputs) ||
    (value.completion.error !== null && typeof value.completion.error !== 'string')
  ) return undefined;
  const applicability = value.applicability;
  if (
    applicability !== undefined &&
    (!isTraceRecord(applicability) ||
      !isRequirement(applicability.tool) ||
      !isRequirement(applicability.approval) ||
      !isRequirement(applicability.verifiedState) ||
      !isRequirement(applicability.genui))
  ) return undefined;
  const runType = value.runType;
  const category = value.category;
  if (!isRunType(runType) || !isCategory(category)) return undefined;
  return {
    id: value.id,
    traceId: value.traceId,
    ...(typeof value.parentRunId === 'string' ? { parentRunId: value.parentRunId } : {}),
    name: value.name,
    runType,
    category,
    metadata: value.metadata,
    inputs: value.inputs,
    ...(applicability && isTraceRecord(applicability)
      ? {
          applicability: {
            tool: isRequirement(applicability.tool) ? applicability.tool : 'forbidden',
            approval: isRequirement(applicability.approval)
              ? applicability.approval
              : 'forbidden',
            verifiedState: isRequirement(applicability.verifiedState)
              ? applicability.verifiedState
              : 'forbidden',
            genui: isRequirement(applicability.genui) ? applicability.genui : 'forbidden',
          },
        }
      : {}),
    completion: {
      status: value.completion.status,
      outputs: value.completion.outputs,
      error: value.completion.error,
    },
  };
}

function parsedReceiptPayload(value: unknown): {
  apiUrl: string;
  projectName: string;
  context: RequiredAgentTraceContext;
  runs: CapturedAgentTraceRun[];
} | undefined {
  if (
    !isTraceRecord(value) ||
    value.schemaVersion !== 1 ||
    value.artifactKind !== 'kfc-verified-agent-trace-receipt' ||
    !isTraceRecord(value.target) ||
    typeof value.target.apiUrl !== 'string' ||
    typeof value.target.projectName !== 'string' ||
    !isTraceRecord(value.context) ||
    !isTraceRecord(value.context.runtime) ||
    !isTraceRecord(value.context.policy) ||
    !isTraceRecord(value.context.policy.dataset) ||
    !Array.isArray(value.context.policy.modes) ||
    !Array.isArray(value.runs)
  ) return undefined;
  const runs = value.runs.map(parsedCapturedRun);
  const modes = value.context.policy.modes.filter(
    (mode): mode is 'text' | 'genui' => mode === 'text' || mode === 'genui',
  );
  if (
    runs.some((run) => !run) ||
    modes.length !== value.context.policy.modes.length ||
    (value.context.runtime.provider !== 'openai' && value.context.runtime.provider !== 'google') ||
    typeof value.context.runtime.runtimeId !== 'string' ||
    typeof value.context.runtime.model !== 'string' ||
    typeof value.context.runtime.profile !== 'string' ||
    typeof value.context.executionId !== 'string' ||
    typeof value.context.gitSha !== 'string' ||
    typeof value.context.remoteDatasetId !== 'string' ||
    (value.context.mode !== 'text' && value.context.mode !== 'genui') ||
    typeof value.context.repetition !== 'number' ||
    typeof value.context.policy.policyId !== 'string' ||
    typeof value.context.policy.dataset.name !== 'string' ||
    typeof value.context.policy.dataset.schemaVersion !== 'string' ||
    typeof value.context.policy.dataset.inventoryVersion !== 'string' ||
    typeof value.context.policy.dataset.inventoryDigest !== 'string' ||
    typeof value.context.policy.dataset.sourcePath !== 'string' ||
    typeof value.context.policy.dataset.scenarioCount !== 'number' ||
    typeof value.context.policy.dataset.turnCount !== 'number' ||
    typeof value.context.policy.dataset.caseCount !== 'number' ||
    typeof value.context.policy.repetitionsPerMode !== 'number' ||
    value.context.policy.costPolicy !== 'provider_reported_or_unavailable'
  ) return undefined;
  return {
    apiUrl: value.target.apiUrl,
    projectName: value.target.projectName,
    context: {
      executionId: value.context.executionId,
      gitSha: value.context.gitSha,
      runtime: {
        runtimeId: value.context.runtime.runtimeId,
        provider: value.context.runtime.provider,
        model: value.context.runtime.model,
        profile: value.context.runtime.profile,
      },
      policy: {
        policyId: value.context.policy.policyId,
        dataset: {
          name: value.context.policy.dataset.name,
          schemaVersion: value.context.policy.dataset.schemaVersion,
          inventoryVersion: value.context.policy.dataset.inventoryVersion,
          inventoryDigest: value.context.policy.dataset.inventoryDigest,
          sourcePath: value.context.policy.dataset.sourcePath,
          scenarioCount: value.context.policy.dataset.scenarioCount,
          turnCount: value.context.policy.dataset.turnCount,
          caseCount: value.context.policy.dataset.caseCount,
        },
        modes,
        repetitionsPerMode: value.context.policy.repetitionsPerMode,
        costPolicy: value.context.policy.costPolicy,
      },
      remoteDatasetId: value.context.remoteDatasetId,
      mode: value.context.mode,
      repetition: value.context.repetition,
    },
    runs: runs.filter((run): run is CapturedAgentTraceRun => run !== undefined),
  };
}

export async function reverifyAgentTraceReceiptPayload(input: {
  payload: unknown;
  client: RequiredAgentTracePublicationClient;
  polling: {
    timeoutMs: number;
    pollIntervalMs: number;
    now: () => number;
    sleep: (durationMs: number) => Promise<void>;
  };
}): Promise<VerifiedAgentTraceReceipt> {
  const parsed = parsedReceiptPayload(input.payload);
  if (!parsed) throw new Error('agent_required_trace_receipt_invalid');
  return verifyCapturedAgentTracePublication({
    ...parsed,
    client: input.client,
    polling: input.polling,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function verifyCapturedAgentTracePublication(input: {
  apiUrl: string;
  projectName: string;
  context: RequiredAgentTraceContext;
  runs: readonly CapturedAgentTraceRun[];
  client: RequiredAgentTracePublicationClient;
  polling: {
    timeoutMs: number;
    pollIntervalMs: number;
    now: () => number;
    sleep: (durationMs: number) => Promise<void>;
  };
}): Promise<VerifiedAgentTraceReceipt> {
  if (input.apiUrl !== APAC_ENDPOINT || input.projectName.length === 0) {
    throw new Error('agent_required_trace_target_invalid');
  }
  if (
    !input.context.policy.modes.includes(input.context.mode) ||
    input.context.repetition < 1 ||
    input.context.repetition > input.context.policy.repetitionsPerMode
  ) {
    throw new Error('agent_required_trace_context_invalid');
  }
  const dataset = await input.client
    .readDataset({ datasetId: input.context.remoteDatasetId })
    .catch(() => undefined);
  if (
    !dataset ||
    dataset.id !== input.context.remoteDatasetId ||
    dataset.name !== input.context.policy.dataset.name
  ) {
    throw new Error('agent_required_trace_dataset_unverified');
  }
  assertCapturedSemantics(input.runs);
  const rootCount = input.runs.filter(({ parentRunId }) => parentRunId === undefined).length;
  if (rootCount !== input.context.policy.dataset.turnCount) {
    throw new Error('agent_required_trace_completeness_invalid');
  }

  const deadline = input.polling.now() + input.polling.timeoutMs;
  let queryAttempts = 0;
  while (true) {
    queryAttempts += 1;
    const evidence = await queryOnce({
      client: input.client,
      projectName: input.projectName,
      runs: input.runs,
    }).catch(() => undefined);
    if (evidence) {
      const payload: VerifiedAgentTraceReceiptPayload = {
        schemaVersion: 1,
        artifactKind: 'kfc-verified-agent-trace-receipt',
        target: { apiUrl: APAC_ENDPOINT, projectName: input.projectName },
        context: input.context,
        publication: {
          queryAttempts,
          flushVerified: true,
          datasetReadbackVerified: true,
          readbackVerified: true,
        },
        runs: [...structuredClone(input.runs)],
        evidence,
      };
      const receipt = deepFreeze({ payload: structuredClone(payload) });
      issuedReceipts.add(receipt);
      return receipt;
    }
    const now = input.polling.now();
    if (now >= deadline) break;
    await input.polling.sleep(
      Math.min(input.polling.pollIntervalMs, Math.max(1, deadline - now)),
    );
  }
  throw new Error('agent_required_trace_publication_unverified');
}
