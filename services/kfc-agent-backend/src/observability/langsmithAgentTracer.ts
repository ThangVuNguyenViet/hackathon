import { Client, RunTree } from 'langsmith';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { withRunTree } from 'langsmith/traceable';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from './agentTracing.js';

export interface LangSmithRunConfig {
  name: string;
  tracingEnabled?: boolean;
  run_type?: string;
  inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  project_name?: string;
  client?: Client;
}

export interface LangSmithRunLike {
  createChild(config: LangSmithRunConfig): LangSmithRunLike;
  postRun(): Promise<void>;
  end(outputs?: Record<string, unknown>, error?: string): Promise<void>;
  patchRun(): Promise<void>;
}

export interface LangSmithAgentTracerOptions {
  projectName: string;
  apiKey?: string;
  apiUrl?: string;
  samplingRate?: number;
  createRoot?: (config: LangSmithRunConfig) => LangSmithRunLike;
  flush?: () => Promise<void>;
  fetchImplementation?: typeof fetch;
  autoBatchTracing?: boolean;
}

const traceFailureError = 'agent_trace_failed_closed';
const opaqueCorrelationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const safeTagPattern =
  /^(?:candidate|channel|pack|pack-version|profile|transport):[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

function privacySafeLangSmithMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of [
    'session_id',
    'run_id',
    'turn_id',
    'pack_id',
    'pack_version',
    'candidate',
    'profile',
    'transport',
    'response_profile',
    'channel',
    'scenarioId',
  ] as const) {
    if (
      typeof metadata[key] === 'string' &&
      opaqueCorrelationIdPattern.test(metadata[key])
    ) {
      safe[key] = metadata[key];
    }
  }
  if (metadata.probeRunId === null) {
    safe.probeRunId = metadata.probeRunId;
  } else if (
    typeof metadata.probeRunId === 'string' &&
    opaqueCorrelationIdPattern.test(metadata.probeRunId)
  ) {
    safe.probeRunId = metadata.probeRunId;
  }
  return safe;
}

function privacySafeLangSmithTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => safeTagPattern.test(tag));
}

function privacySafeLangSmithError(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.hasOwn(values, 'error') ? { error: traceFailureError } : {};
}

const safeProviderAttemptPurposes = new Set([
  'agent_decision',
  'response_composition',
]);
const safeProviderAttemptOutcomes = new Set([
  'error',
  'invalid_response',
  'success',
]);
const safeProviderErrorClasses = new Set([
  'aborted',
  'client_error',
  'network_error',
  'rate_limited',
  'server_error',
  'timeout',
  'unknown',
]);
const safeSpanStatuses = new Set(['completed', 'interrupted', 'paused']);
const safeExecutionOutcomes = new Set(['error', 'success']);
const safeGraphDestinations = new Set([
  '__end__',
  'call_model',
  'execute_tools',
  'execute_trusted_action',
  'fail_closed',
  'finalize_response',
  'persist_and_project',
  'prepare_structured_action',
  'record_provider_retry',
  'record_semantic_correction',
  'request_approval',
  'revalidate_approval',
  'validate_tool_calls',
]);

function safeBoundedInteger(
  value: unknown,
  maximum: number,
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : undefined;
}

function copySafeEnum(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
): void {
  const value = source[key];
  if (typeof value === 'string' && allowed.has(value)) {
    target[key] = value;
  }
}

/**
 * LangSmith applies this function to every explicit span and native callback
 * output before transport. Keep only bounded control-flow evidence. Raw model
 * generations, customer prose, tool arguments/results, state, and errors are
 * intentionally dropped even if a caller accidentally supplies them.
 */
export function privacySafeLangSmithOutputs(
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const attempt = safeBoundedInteger(outputs.attempt, 6);
  if (attempt !== undefined) safe.attempt = attempt;
  const toolCallCount = safeBoundedInteger(
    outputs.toolCallCount ?? outputs.toolCalls,
    100,
  );
  if (toolCallCount !== undefined) safe.toolCallCount = toolCallCount;
  const responseCharacterCount = safeBoundedInteger(
    outputs.responseCharacterCount,
    1_000_000,
  );
  if (responseCharacterCount !== undefined) {
    safe.responseCharacterCount = responseCharacterCount;
  }
  for (const key of [
    'emittedFailure',
    'emittedValidationError',
    'retryable',
  ] as const) {
    if (typeof outputs[key] === 'boolean') safe[key] = outputs[key];
  }
  copySafeEnum(safe, outputs, 'purpose', safeProviderAttemptPurposes);
  copySafeEnum(safe, outputs, 'outcome', safeProviderAttemptOutcomes);
  copySafeEnum(safe, outputs, 'errorClass', safeProviderErrorClasses);
  copySafeEnum(safe, outputs, 'status', safeSpanStatuses);
  copySafeEnum(safe, outputs, 'executionOutcome', safeExecutionOutcomes);
  copySafeEnum(safe, outputs, 'destination', safeGraphDestinations);
  return safe;
}

export function privacySafeLangSmithInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of [
    'messageCharacterCount',
    'historyExchangeCount',
  ] as const) {
    const value = safeBoundedInteger(inputs[key], 1_000_000);
    if (value !== undefined) safe[key] = value;
  }
  for (const key of ['structuredAction', 'hasSummary'] as const) {
    if (typeof inputs[key] === 'boolean') safe[key] = inputs[key];
  }
  return safe;
}

type PendingTraceOperation = () => Promise<void>;

class LangSmithTraceSpan implements AgentTraceSpan {
  constructor(
    private readonly run: LangSmithRunLike,
    private readonly enqueue: (operation: PendingTraceOperation) => void,
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const child = this.run.createChild({
      name: input.name,
      run_type: input.runType,
      inputs: privacySafeLangSmithInputs(input.inputs),
      metadata: privacySafeLangSmithMetadata(input.metadata ?? {}),
      tags: privacySafeLangSmithTags(input.tags ?? []),
    });
    this.enqueue(() => child.postRun());
    return new LangSmithTraceSpan(child, this.enqueue);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    const endOperation = this.run.end(privacySafeLangSmithOutputs(outputs));
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }

  async fail(_error: unknown): Promise<void> {
    const endOperation = this.run.end(undefined, traceFailureError);
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }

  async langchainCallbacks(): Promise<Callbacks | undefined> {
    return this.run instanceof RunTree
      ? getLangchainCallbacks(this.run)
      : undefined;
  }

  async withActiveTrace<T>(fn: () => Promise<T>): Promise<T> {
    return this.run instanceof RunTree ? withRunTree(this.run, fn) : fn();
  }
}

export class LangSmithAgentTracer implements AgentTracer {
  private readonly createRoot: (config: LangSmithRunConfig) => LangSmithRunLike;
  private readonly flushPending?: () => Promise<void>;
  private readonly pendingOperations: PendingTraceOperation[] = [];

  constructor(private readonly options: LangSmithAgentTracerOptions) {
    if (options.createRoot) {
      this.createRoot = options.createRoot;
      this.flushPending = options.flush;
      return;
    }

    const client = new Client({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      tracingSamplingRate: options.samplingRate,
      fetchImplementation: options.fetchImplementation,
      autoBatchTracing: options.autoBatchTracing,
      hideInputs: privacySafeLangSmithInputs,
      hideOutputs: privacySafeLangSmithOutputs,
      hideMetadata: privacySafeLangSmithMetadata,
      anonymizer: privacySafeLangSmithError,
      omitTracedRuntimeInfo: true,
    });
    this.createRoot = (config) => new RunTree({ ...config, client });
    this.flushPending =
      options.flush ?? (() => client.awaitPendingTraceBatches());
  }

  async startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan> {
    const root = this.createRoot({
      name: input.name,
      tracingEnabled: true,
      run_type: 'chain',
      inputs: privacySafeLangSmithInputs(input.inputs),
      metadata: privacySafeLangSmithMetadata(input.metadata ?? {}),
      tags: privacySafeLangSmithTags(input.tags ?? []),
      project_name: this.options.projectName,
    });
    this.pendingOperations.push(() => root.postRun());
    return new LangSmithTraceSpan(root, (operation) =>
      this.pendingOperations.push(operation),
    );
  }

  async flush(): Promise<void> {
    let firstError: unknown;
    while (this.pendingOperations.length > 0) {
      const operation = this.pendingOperations.shift();
      if (!operation) continue;
      try {
        await operation();
      } catch (error) {
        firstError ??= error;
      }
    }
    try {
      await this.flushPending?.();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }
}
