import { Client, RunTree } from 'langsmith';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from './agentTracing.js';

export interface LangSmithRunConfig {
  name: string;
  run_type?: string | undefined;
  inputs?: Record<string, unknown> | undefined;
  metadata?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  project_name?: string | undefined;
  client?: Client | undefined;
}

export interface LangSmithRunLike {
  createChild(config: LangSmithRunConfig): LangSmithRunLike;
  postRun(): Promise<void>;
  end(outputs?: Record<string, unknown>, error?: string): Promise<void>;
  patchRun(): Promise<void>;
}

export interface LangSmithAgentTracerOptions {
  projectName: string;
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  samplingRate?: number | undefined;
  createRoot?: ((config: LangSmithRunConfig) => LangSmithRunLike) | undefined;
  flush?: (() => Promise<void>) | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
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
      inputs: input.inputs,
      metadata: input.metadata,
      tags: input.tags,
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
    const message = errorText(error);
    const endOperation = this.run.end(undefined, message);
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }
}

export class LangSmithAgentTracer implements AgentTracer {
  private readonly createRoot: (config: LangSmithRunConfig) => LangSmithRunLike;
  private readonly flushPending: (() => Promise<void>) | undefined;
  private readonly pendingOperations: PendingTraceOperation[] = [];

  constructor(private readonly options: LangSmithAgentTracerOptions) {
    if (options.createRoot) {
      this.createRoot = options.createRoot;
      this.flushPending = options.flush;
      return;
    }

    const client = new Client({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.samplingRate === undefined ? {} : { tracingSamplingRate: options.samplingRate }),
    });
    this.createRoot = (config) => new RunTree({
      client,
      name: config.name,
      ...(config.run_type ? { run_type: config.run_type } : {}),
      ...(config.inputs ? { inputs: config.inputs } : {}),
      ...(config.metadata ? { metadata: config.metadata } : {}),
      ...(config.tags ? { tags: config.tags } : {}),
      ...(config.project_name ? { project_name: config.project_name } : {}),
    });
    this.flushPending = options.flush ?? (() => client.awaitPendingTraceBatches());
  }

  async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan> {
    const root = this.createRoot({
      name: input.name,
      run_type: 'chain',
      inputs: input.inputs,
      metadata: input.metadata,
      tags: input.tags,
      project_name: this.options.projectName,
    });
    this.pendingOperations.push(() => root.postRun());
    return new LangSmithTraceSpan(root, (operation) => this.pendingOperations.push(operation));
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
