import { Client, RunTree } from 'langsmith';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { withRunTree } from 'langsmith/traceable';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
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

function traceError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

type NativeRun = ReturnType<LangChainTracer['_addRunToRunMap']>;

interface NativeLifecycleState {
  preferredTracer: LangChainTracer;
  run?: NativeRun;
  start?: Promise<NativeRun>;
  terminal?: Promise<NativeRun>;
}

class NativeLifecycleCoordinator {
  private readonly states = new Map<string, NativeLifecycleState>();

  create(
    runId: string,
    tracer: LangChainTracer,
    create: () => NativeRun,
  ): NativeRun {
    const existing = this.states.get(runId);
    if (existing) {
      existing.preferredTracer = tracer;
      if (existing.run) return existing.run;
      const run = create();
      existing.run = run;
      return run;
    }

    const run = create();
    this.states.set(runId, { preferredTracer: tracer, run });
    return run;
  }

  start(
    runId: string,
    tracer: LangChainTracer,
    invoke: (preferredTracer: LangChainTracer) => Promise<NativeRun>,
  ): Promise<NativeRun> {
    const state = this.state(runId, tracer);
    state.start ??= invoke(state.preferredTracer);
    return state.start;
  }

  terminal(
    runId: string,
    tracer: LangChainTracer,
    invoke: (preferredTracer: LangChainTracer) => Promise<NativeRun>,
  ): Promise<NativeRun> {
    const state = this.state(runId, tracer);
    state.terminal ??= invoke(state.preferredTracer);
    return state.terminal;
  }

  private state(runId: string, tracer: LangChainTracer): NativeLifecycleState {
    const existing = this.states.get(runId);
    if (existing) return existing;
    const state = { preferredTracer: tracer };
    this.states.set(runId, state);
    return state;
  }
}

class NativeLifecycleLangChainTracer extends BaseCallbackHandler {
  override readonly name = 'langchain_tracer';

  constructor(
    private readonly tracer: LangChainTracer,
    private readonly lifecycle: NativeLifecycleCoordinator,
  ) {
    super({
      ignoreLLM: tracer.ignoreLLM,
      ignoreChain: tracer.ignoreChain,
      ignoreAgent: tracer.ignoreAgent,
      ignoreRetriever: tracer.ignoreRetriever,
      ignoreCustomEvent: tracer.ignoreCustomEvent,
      raiseError: tracer.raiseError,
      _awaitHandler: tracer.awaitHandlers,
    });
  }

  copyWithTracingConfig(
    input: Parameters<LangChainTracer['copyWithTracingConfig']>[0],
  ): NativeLifecycleLangChainTracer {
    return new NativeLifecycleLangChainTracer(
      this.tracer.copyWithTracingConfig(input),
      this.lifecycle,
    );
  }

  getRunTreeWithTracingConfig(
    ...args: Parameters<LangChainTracer['getRunTreeWithTracingConfig']>
  ): ReturnType<LangChainTracer['getRunTreeWithTracingConfig']> {
    return this.tracer.getRunTreeWithTracingConfig(...args);
  }

  updateFromRunTree(
    ...args: Parameters<LangChainTracer['updateFromRunTree']>
  ): ReturnType<LangChainTracer['updateFromRunTree']> {
    return this.tracer.updateFromRunTree(...args);
  }

  _addRunToRunMap(
    ...args: Parameters<LangChainTracer['_addRunToRunMap']>
  ): ReturnType<LangChainTracer['_addRunToRunMap']> {
    return this.tracer._addRunToRunMap(...args);
  }

  _createRunForLLMStart(
    ...args: Parameters<LangChainTracer['_createRunForLLMStart']>
  ): ReturnType<LangChainTracer['_createRunForLLMStart']> {
    return this.lifecycle.create(args[2], this.tracer, () =>
      this.tracer._createRunForLLMStart(...args),
    );
  }

  override handleLLMStart(
    ...args: Parameters<LangChainTracer['handleLLMStart']>
  ): ReturnType<LangChainTracer['handleLLMStart']> {
    return this.lifecycle.start(args[2], this.tracer, (tracer) =>
      tracer.handleLLMStart(...args),
    );
  }

  _createRunForChatModelStart(
    ...args: Parameters<LangChainTracer['_createRunForChatModelStart']>
  ): ReturnType<LangChainTracer['_createRunForChatModelStart']> {
    return this.lifecycle.create(args[2], this.tracer, () =>
      this.tracer._createRunForChatModelStart(...args),
    );
  }

  override handleChatModelStart(
    ...args: Parameters<LangChainTracer['handleChatModelStart']>
  ): ReturnType<LangChainTracer['handleChatModelStart']> {
    return this.lifecycle.start(args[2], this.tracer, (tracer) =>
      tracer.handleChatModelStart(...args),
    );
  }

  override handleLLMEnd(
    ...args: Parameters<LangChainTracer['handleLLMEnd']>
  ): ReturnType<LangChainTracer['handleLLMEnd']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleLLMEnd(...args),
    );
  }

  override handleLLMError(
    ...args: Parameters<LangChainTracer['handleLLMError']>
  ): ReturnType<LangChainTracer['handleLLMError']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleLLMError(...args),
    );
  }

  _createRunForChainStart(
    ...args: Parameters<LangChainTracer['_createRunForChainStart']>
  ): ReturnType<LangChainTracer['_createRunForChainStart']> {
    return this.lifecycle.create(args[2], this.tracer, () =>
      this.tracer._createRunForChainStart(...args),
    );
  }

  override handleChainStart(
    ...args: Parameters<LangChainTracer['handleChainStart']>
  ): ReturnType<LangChainTracer['handleChainStart']> {
    return this.lifecycle.start(args[2], this.tracer, (tracer) =>
      tracer.handleChainStart(...args),
    );
  }

  override handleChainEnd(
    ...args: Parameters<LangChainTracer['handleChainEnd']>
  ): ReturnType<LangChainTracer['handleChainEnd']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleChainEnd(...args),
    );
  }

  override handleChainError(
    ...args: Parameters<LangChainTracer['handleChainError']>
  ): ReturnType<LangChainTracer['handleChainError']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleChainError(...args),
    );
  }

  _createRunForToolStart(
    ...args: Parameters<LangChainTracer['_createRunForToolStart']>
  ): ReturnType<LangChainTracer['_createRunForToolStart']> {
    return this.lifecycle.create(args[2], this.tracer, () =>
      this.tracer._createRunForToolStart(...args),
    );
  }

  override handleToolStart(
    ...args: Parameters<LangChainTracer['handleToolStart']>
  ): ReturnType<LangChainTracer['handleToolStart']> {
    return this.lifecycle.start(args[2], this.tracer, (tracer) =>
      tracer.handleToolStart(...args),
    );
  }

  override handleToolEnd(
    ...args: Parameters<LangChainTracer['handleToolEnd']>
  ): ReturnType<LangChainTracer['handleToolEnd']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleToolEnd(...args),
    );
  }

  override handleToolError(
    ...args: Parameters<LangChainTracer['handleToolError']>
  ): ReturnType<LangChainTracer['handleToolError']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleToolError(...args),
    );
  }

  _createRunForRetrieverStart(
    ...args: Parameters<LangChainTracer['_createRunForRetrieverStart']>
  ): ReturnType<LangChainTracer['_createRunForRetrieverStart']> {
    return this.lifecycle.create(args[2], this.tracer, () =>
      this.tracer._createRunForRetrieverStart(...args),
    );
  }

  override handleRetrieverStart(
    ...args: Parameters<LangChainTracer['handleRetrieverStart']>
  ): ReturnType<LangChainTracer['handleRetrieverStart']> {
    return this.lifecycle.start(args[2], this.tracer, (tracer) =>
      tracer.handleRetrieverStart(...args),
    );
  }

  override handleRetrieverEnd(
    ...args: Parameters<LangChainTracer['handleRetrieverEnd']>
  ): ReturnType<LangChainTracer['handleRetrieverEnd']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleRetrieverEnd(...args),
    );
  }

  override handleRetrieverError(
    ...args: Parameters<LangChainTracer['handleRetrieverError']>
  ): ReturnType<LangChainTracer['handleRetrieverError']> {
    return this.lifecycle.terminal(args[1], this.tracer, (tracer) =>
      tracer.handleRetrieverError(...args),
    );
  }

  override handleAgentAction(
    ...args: Parameters<LangChainTracer['handleAgentAction']>
  ): ReturnType<LangChainTracer['handleAgentAction']> {
    return this.tracer.handleAgentAction(...args);
  }

  override handleAgentEnd(
    ...args: Parameters<LangChainTracer['handleAgentEnd']>
  ): ReturnType<LangChainTracer['handleAgentEnd']> {
    return this.tracer.handleAgentEnd(...args);
  }

  override handleText(
    ...args: Parameters<LangChainTracer['handleText']>
  ): ReturnType<LangChainTracer['handleText']> {
    return this.tracer.handleText(...args);
  }

  override handleLLMNewToken(
    ...args: Parameters<LangChainTracer['handleLLMNewToken']>
  ): ReturnType<LangChainTracer['handleLLMNewToken']> {
    return this.tracer.handleLLMNewToken(...args);
  }
}

function stabilizeLangChainCallbacks(
  callbacks: Callbacks | undefined,
): Callbacks | undefined {
  if (!callbacks) return undefined;
  const lifecycle = new NativeLifecycleCoordinator();
  const wrappers = new WeakMap<
    LangChainTracer,
    NativeLifecycleLangChainTracer
  >();
  const wrap = (handler: BaseCallbackHandler): BaseCallbackHandler => {
    if (!(handler instanceof LangChainTracer)) return handler;
    const existing = wrappers.get(handler);
    if (existing) return existing;
    const wrapper = new NativeLifecycleLangChainTracer(handler, lifecycle);
    wrappers.set(handler, wrapper);
    return wrapper;
  };

  if (Array.isArray(callbacks)) {
    return callbacks.map(
      (handler: BaseCallbackHandler | CallbackHandlerMethods) =>
        handler instanceof BaseCallbackHandler ? wrap(handler) : handler,
    );
  }
  callbacks.handlers = callbacks.handlers.map(wrap);
  callbacks.inheritableHandlers = callbacks.inheritableHandlers.map(wrap);
  return callbacks;
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
    const endOperation = this.run.end(undefined, traceError(error));
    void endOperation.catch(() => undefined);
    this.enqueue(async () => {
      await endOperation;
      await this.run.patchRun();
    });
  }

  async langchainCallbacks(): Promise<Callbacks | undefined> {
    if (!(this.run instanceof RunTree)) return undefined;
    return stabilizeLangChainCallbacks(await getLangchainCallbacks(this.run));
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
      metadata: input.metadata,
      tags: input.tags,
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
