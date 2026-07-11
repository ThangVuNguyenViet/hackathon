import { Client, RunTree } from 'langsmith';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from './agentTracing.js';

export interface LangSmithRunConfig {
  name: string;
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
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

class LangSmithTraceSpan implements AgentTraceSpan {
  constructor(private readonly run: LangSmithRunLike) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const child = this.run.createChild({
      name: input.name,
      run_type: input.runType,
      inputs: input.inputs,
      metadata: input.metadata,
      tags: input.tags,
    });
    await child.postRun();
    return new LangSmithTraceSpan(child);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    await this.run.end(outputs);
    await this.run.patchRun();
  }

  async fail(error: unknown): Promise<void> {
    await this.run.end(undefined, errorText(error));
    await this.run.patchRun();
  }
}

export class LangSmithAgentTracer implements AgentTracer {
  private readonly createRoot: (config: LangSmithRunConfig) => LangSmithRunLike;
  private readonly flushPending?: () => Promise<void>;

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
    });
    this.createRoot = (config) => new RunTree({ ...config, client });
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
    await root.postRun();
    return new LangSmithTraceSpan(root);
  }

  async flush(): Promise<void> {
    await this.flushPending?.();
  }
}
