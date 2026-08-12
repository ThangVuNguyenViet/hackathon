import type { Callbacks } from '@langchain/core/callbacks/manager';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { Client, RunTree } from 'langsmith';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { withRunTree } from 'langsmith/traceable';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from './agentTracing.js';

export interface LangSmithRunConfig {
  name: string;
  run_type?: string;
  inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  project_name?: string;
  client?: Client;
  tracingEnabled?: boolean;
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

type PendingTraceOperation = () => Promise<void>;
type SafeTraceMetadataValue = string | number | boolean | null;

const traceMetadataKeys = new Set([
  'agentModel',
  'agentProfile',
  'agentProvider',
  'boundary',
  'businessId',
  'canonicalScenarioTurnIndex',
  'commit',
  'component',
  'probeRunId',
  'releaseSha',
  'runtime',
  'scenarioId',
  'showcaseMode',
  'toolName',
  'turn_index',
]);
const exactTraceTags = new Set([
  'agent-session-intelligence',
  'agent-tool',
  'agentic-proof',
  'confirmation-resume',
  'kfc-post-turn-monitor',
  'kfc-showcase-replay',
  'model-attempt',
]);
const structuredTraceTag = /^(?:business|mode|runtime|scenario|tool):[A-Za-z0-9._-]{1,80}$/u;

function safeTraceMetadataValue(
  value: unknown,
): SafeTraceMetadataValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' && value.length <= 256 ? value : undefined;
}

function safeTraceMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, SafeTraceMetadataValue> | undefined {
  if (!metadata) return undefined;
  const safeEntries = Object.entries(metadata).flatMap(([key, value]) => {
    if (!traceMetadataKeys.has(key)) return [];
    const safeValue = safeTraceMetadataValue(value);
    return safeValue === undefined ? [] : [[key, safeValue] as const];
  });
  return safeEntries.length > 0 ? Object.fromEntries(safeEntries.slice(0, 24)) : undefined;
}

function safeTraceTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const safeTags = tags.filter(
    (tag) => exactTraceTags.has(tag) || structuredTraceTag.test(tag),
  );
  return safeTags.length > 0 ? [...new Set(safeTags)].slice(0, 24) : undefined;
}

function traceError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

class LangSmithTraceSpan implements AgentTraceSpan {
  constructor(
    private readonly run: LangSmithRunLike,
    private readonly enqueue: (operation: PendingTraceOperation) => void,
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const child = this.run.createChild({
      name: input.name,
      run_type: input.runType,
      inputs: input.inputs,
      metadata: safeTraceMetadata(input.metadata),
      tags: safeTraceTags(input.tags),
    });
    this.enqueue(() => child.postRun());
    return new LangSmithTraceSpan(child, this.enqueue);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    const endOperation = this.run.end(outputs);
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }

  async fail(error: unknown): Promise<void> {
    const endOperation = this.run.end(undefined, traceError(error));
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
      run_type: 'chain',
      inputs: input.inputs,
      metadata: safeTraceMetadata(input.metadata),
      tags: safeTraceTags(input.tags),
      project_name: this.options.projectName,
      tracingEnabled: true,
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
      await awaitAllCallbacks();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await this.flushPending?.();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }
}
