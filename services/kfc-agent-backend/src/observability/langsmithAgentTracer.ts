import { Client, RunTree } from 'langsmith';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from './agentTracing.js';
import {
  privacySafeLangSmithError,
  privacySafeLangSmithInputs,
  privacySafeLangSmithMetadata,
  privacySafeLangSmithOutputs,
} from './langsmithTracePrivacy.js';
import {
  verifyCapturedAgentTracePublication,
  type CapturedAgentTraceRun,
  type RequiredAgentTraceContext,
  type RequiredAgentTracePublicationClient,
  type VerifiedAgentTraceReceipt,
} from './requiredAgentTracePublication.js';

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
  readonly id: string;
  readonly trace_id: string;
  readonly parent_run_id?: string;
  createChild(config: LangSmithRunConfig): LangSmithRunLike;
  postRun(): Promise<void>;
  end(outputs?: Record<string, unknown>, error?: string): Promise<void>;
  patchRun(): Promise<void>;
}

interface RequiredProofOptions {
  context: RequiredAgentTraceContext;
  publicationClient?: RequiredAgentTracePublicationClient;
  polling?: {
    timeoutMs: number;
    pollIntervalMs: number;
    now?: () => number;
    sleep?: (durationMs: number) => Promise<void>;
  };
}

export interface LangSmithAgentTracerOptions {
  projectName: string;
  apiKey?: string;
  apiUrl?: string;
  samplingRate?: number;
  createRoot?: (config: LangSmithRunConfig) => LangSmithRunLike;
  flush?: () => Promise<void>;
  requiredProof?: RequiredProofOptions;
}

type PendingTraceOperation = () => Promise<void>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export function createLangSmithPublicationClient(
  client: Client,
): RequiredAgentTracePublicationClient {
  return {
    async readDataset(input) {
      const dataset = await client.readDataset(input);
      return { id: String(dataset.id), name: dataset.name };
    },
    async *listRuns(input) {
      for await (const run of client.listRuns(input)) {
        yield {
          id: String(run.id),
          trace_id: run.trace_id ? String(run.trace_id) : undefined,
          parent_run_id: run.parent_run_id ? String(run.parent_run_id) : undefined,
          name: run.name,
          run_type: run.run_type,
          start_time: run.start_time,
          end_time: run.end_time,
          extra: run.extra,
          inputs: run.inputs,
          outputs: run.outputs,
          error: run.error ?? undefined,
        };
      }
    },
  };
}

function contextMetadata(context: RequiredAgentTraceContext): Record<string, unknown> {
  return {
    executionId: context.executionId,
    gitSha: context.gitSha,
    runtimeId: context.runtime.runtimeId,
    provider: context.runtime.provider,
    model: context.runtime.model,
    profile: context.runtime.profile,
    mode: context.mode,
    repetition: context.repetition,
    policyId: context.policy.policyId,
    inventoryName: context.policy.dataset.name,
    inventoryVersion: context.policy.dataset.inventoryVersion,
    inventoryDigest: context.policy.dataset.inventoryDigest,
    remoteDatasetId: context.remoteDatasetId,
  };
}

class LangSmithTraceSpan implements AgentTraceSpan {
  constructor(
    private readonly run: LangSmithRunLike,
    private readonly enqueue: (operation: PendingTraceOperation) => void,
    private readonly captures: CapturedAgentTraceRun[] | undefined,
    private readonly privacyEnabled: boolean,
    private readonly sharedMetadata: Record<string, unknown>,
    private readonly capture: CapturedAgentTraceRun | undefined,
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const category = input.category;
    if (this.captures && !category) {
      throw new Error('agent_required_trace_category_missing');
    }
    const metadata = this.privacyEnabled
      ? privacySafeLangSmithMetadata({
          ...input.metadata,
          ...this.sharedMetadata,
          category: input.category,
        })
      : input.metadata;
    const inputs = this.privacyEnabled
      ? privacySafeLangSmithInputs(input.inputs)
      : input.inputs;
    const child = this.run.createChild({
      name: input.name,
      run_type: input.runType,
      inputs,
      metadata,
      tags: input.tags,
    });
    this.enqueue(() => child.postRun());
    const capture = this.captures && category
      ? {
          id: String(child.id),
          traceId: String(child.trace_id),
          ...(child.parent_run_id ? { parentRunId: String(child.parent_run_id) } : {}),
          name: input.name,
          runType: input.runType,
          category,
          metadata: metadata ?? {},
          inputs,
          completion: {
            status: 'succeeded' as const,
            outputs: {},
            error: null,
          },
        }
      : undefined;
    if (capture) this.captures?.push(capture);
    return new LangSmithTraceSpan(
      child,
      this.enqueue,
      this.captures,
      this.privacyEnabled,
      this.sharedMetadata,
      capture,
    );
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    const safeOutputs = this.privacyEnabled
      ? privacySafeLangSmithOutputs(outputs)
      : outputs;
    if (this.capture) {
      this.capture.completion = {
        status: 'succeeded',
        outputs: safeOutputs,
        error: null,
      };
    }
    const endOperation = this.run.end(safeOutputs);
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }

  async fail(error: unknown): Promise<void> {
    const safeError = this.privacyEnabled
      ? privacySafeLangSmithError(error)
      : errorText(error);
    if (this.capture) {
      this.capture.completion = {
        status: 'failed',
        outputs: {},
        error: safeError,
      };
    }
    const endOperation = this.run.end(undefined, safeError);
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }
}

export class LangSmithAgentTracer implements AgentTracer {
  private readonly createRoot: (config: LangSmithRunConfig) => LangSmithRunLike;
  private readonly flushPending?: () => Promise<void>;
  private readonly publicationClient?: RequiredAgentTracePublicationClient;
  private readonly pendingOperations: PendingTraceOperation[] = [];
  private readonly capturedRuns?: CapturedAgentTraceRun[];
  private readonly sharedMetadata: Record<string, unknown>;
  private receipt?: VerifiedAgentTraceReceipt;

  constructor(private readonly options: LangSmithAgentTracerOptions) {
    if (
      options.requiredProof &&
      (options.apiUrl !== 'https://apac.api.smith.langchain.com' ||
        options.samplingRate !== 1)
    ) {
      throw new Error('agent_required_trace_target_invalid');
    }
    const client = options.createRoot
      ? undefined
      : new Client({
          apiKey: options.apiKey,
          apiUrl: options.apiUrl,
          tracingSamplingRate: options.samplingRate,
        });
    this.createRoot = options.createRoot ?? ((config) => new RunTree({ ...config, client }));
    this.flushPending = options.flush ?? (client ? () => client.awaitPendingTraceBatches() : undefined);
    this.publicationClient = options.requiredProof?.publicationClient ??
      (client ? createLangSmithPublicationClient(client) : undefined);
    this.capturedRuns = options.requiredProof ? [] : undefined;
    this.sharedMetadata = options.requiredProof
      ? contextMetadata(options.requiredProof.context)
      : {};
  }

  async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan> {
    if (this.capturedRuns && (input.category !== 'agent_loop' || !input.applicability)) {
      throw new Error('agent_required_trace_root_invalid');
    }
    const privacyEnabled = this.capturedRuns !== undefined;
    const metadata = privacyEnabled
      ? privacySafeLangSmithMetadata({
          ...input.metadata,
          ...this.sharedMetadata,
          category: input.category,
        })
      : input.metadata;
    const inputs = privacyEnabled
      ? privacySafeLangSmithInputs(input.inputs)
      : input.inputs;
    const root = this.createRoot({
      name: input.name,
      run_type: 'chain',
      inputs,
      metadata,
      tags: input.tags,
      project_name: this.options.projectName,
    });
    this.pendingOperations.push(() => root.postRun());
    const capture = this.capturedRuns
      ? {
          id: String(root.id),
          traceId: String(root.trace_id),
          name: input.name,
          runType: 'chain' as const,
          category: 'agent_loop' as const,
          applicability: input.applicability,
          metadata: metadata ?? {},
          inputs,
          completion: {
            status: 'succeeded' as const,
            outputs: {},
            error: null,
          },
        }
      : undefined;
    if (capture) this.capturedRuns?.push(capture);
    return new LangSmithTraceSpan(
      root,
      (operation) => this.pendingOperations.push(operation),
      this.capturedRuns,
      privacyEnabled,
      this.sharedMetadata,
      capture,
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
    if (!this.options.requiredProof || this.receipt) return;
    if (!this.publicationClient || !this.capturedRuns) {
      throw new Error('agent_required_trace_publication_client_missing');
    }
    const polling = this.options.requiredProof.polling;
    this.receipt = await verifyCapturedAgentTracePublication({
      apiUrl: this.options.apiUrl ?? '',
      projectName: this.options.projectName,
      context: this.options.requiredProof.context,
      runs: this.capturedRuns,
      client: this.publicationClient,
      polling: {
        timeoutMs: polling?.timeoutMs ?? 30_000,
        pollIntervalMs: polling?.pollIntervalMs ?? 1_000,
        now: polling?.now ?? Date.now,
        sleep: polling?.sleep ??
          ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))),
      },
    });
  }

  requiredProofReceipt(): VerifiedAgentTraceReceipt {
    if (!this.options.requiredProof) {
      throw new Error('agent_required_trace_proof_not_configured');
    }
    if (!this.receipt) {
      throw new Error('agent_required_trace_proof_not_flushed');
    }
    return this.receipt;
  }
}
