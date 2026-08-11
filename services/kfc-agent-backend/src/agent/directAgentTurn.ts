import type { ConversationTurnMetadata } from '../domain/types.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type { OpenAiCompactionEvent } from './observedOpenAiResponsesCompactionSession.js';

export interface DirectAgentToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status?: 'success' | 'error';
  durationMs?: number;
}

export interface DirectAgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface DirectAgentLifecycleObserver {
  onRunStart?(): Promise<void> | void;
  onToolEnd?(event: {
    name: string;
    status: 'success' | 'error';
    durationMs: number;
  }): Promise<void> | void;
  onCompactionEnd?(event: OpenAiCompactionEvent): Promise<void> | void;
  onRunEnd?(event: {
    status: 'success' | 'error';
    latencyMs: number;
    usage?: DirectAgentUsage;
  }): Promise<void> | void;
}

export interface DirectAgentExecutionResult {
  responseText: string;
  toolCalls: DirectAgentToolCallTrace[];
  usage: DirectAgentUsage;
}

/** Business-neutral execution envelope for a public direct-agent transport. */
export interface DirectAgentTurnInput<TTransport extends string = 'web_chat'> {
  sessionId: string;
  customerId: string;
  transport: TTransport;
  text: string;
  externalMessageId: string | null;
  metadata: ConversationTurnMetadata | null;
  fence?: RunCommitFence;
  lifecycle?: DirectAgentLifecycleObserver;
}

/** Shared execution result excludes every business-owned presentation/state field. */
export interface DirectAgentTurnResult extends DirectAgentExecutionResult {
  userTurnId: string;
  assistantTurnId: string;
  stateCommit?: 'committed' | 'stale';
}
