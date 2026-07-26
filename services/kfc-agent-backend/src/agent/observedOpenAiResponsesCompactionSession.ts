import {
  OpenAIResponsesCompactionSession,
  type AgentInputItem,
  type OpenAIClient,
  type OpenAIResponsesCompactionArgs,
  type OpenAIResponsesCompactionResult,
  type Session,
} from '@kfc/openai-agents-runtime';

export interface OpenAiCompactionEvent {
  status: 'success' | 'error';
  latencyMs: number;
  beforeItems: number;
  beforeBytes: number;
  afterItems?: number;
  afterBytes?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export function serializedAgentItemsBytes(
  items: readonly AgentInputItem[],
): number {
  return new TextEncoder().encode(JSON.stringify(items)).byteLength;
}

export class ObservedOpenAiResponsesCompactionSession extends OpenAIResponsesCompactionSession {
  constructor(options: {
    client: OpenAIClient;
    underlyingSession: Session;
    model: string;
    thresholdBytes: number;
    onCompactionEnd?(event: OpenAiCompactionEvent): Promise<void> | void;
  }) {
    super({
      client: options.client,
      underlyingSession: options.underlyingSession,
      model: options.model,
      compactionMode: 'input',
      shouldTriggerCompaction: ({ sessionItems }) =>
        serializedAgentItemsBytes(sessionItems) >= options.thresholdBytes,
    });
    this.onCompactionEnd = options.onCompactionEnd;
  }

  private readonly onCompactionEnd:
    ((event: OpenAiCompactionEvent) => Promise<void> | void) | undefined;

  override async runCompaction(
    args?: OpenAIResponsesCompactionArgs,
  ): Promise<OpenAIResponsesCompactionResult | null> {
    const before = await this.getItems();
    const beforeBytes = serializedAgentItemsBytes(before);
    const startedAt = Date.now();
    try {
      const result = await super.runCompaction(args);
      if (!result) return null;
      const after = await this.getItems();
      await this.onCompactionEnd?.({
        status: 'success',
        latencyMs: Math.max(0, Date.now() - startedAt),
        beforeItems: before.length,
        beforeBytes,
        afterItems: after.length,
        afterBytes: serializedAgentItemsBytes(after),
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
      });
      return result;
    } catch {
      await this.onCompactionEnd?.({
        status: 'error',
        latencyMs: Math.max(0, Date.now() - startedAt),
        beforeItems: before.length,
        beforeBytes,
      });
      return null;
    }
  }
}
