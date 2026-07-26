import type { CustomerCommand } from '../domain/customerCommand.js';
import { stateRevision } from '../graph/turnSupport.js';
import { loadPriorVerifiedState } from '../graph/verifiedState.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import { projectKfcOpenAiGenUiState } from './kfcOpenAiGenUi.js';
import {
  hydrateKfcToolSession,
  type KfcToolSession,
} from './kfcOpenAiTools.js';
import type { OpenAiToolCallTrace } from './openAiKfcAgent.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactedResultSummary(result: unknown): Record<string, unknown> {
  const envelope = isRecord(result) ? result : {};
  const value =
    envelope.ok === true && isRecord(envelope.value)
      ? envelope.value
      : envelope;
  const items = Array.isArray(value.items) ? value.items : undefined;
  const recovery = isRecord(envelope.recovery) ? envelope.recovery : undefined;
  return {
    outcome: envelope.ok === false ? 'error' : 'success',
    ...(typeof value.total === 'number' ? { total: value.total } : {}),
    ...(items ? { itemCount: items.length } : {}),
    ...(recovery &&
    typeof recovery.reason === 'string' &&
    typeof recovery.attempt === 'number' &&
    typeof recovery.maxAttempts === 'number'
      ? {
          recovery: {
            reason: recovery.reason,
            attempt: recovery.attempt,
            maxAttempts: recovery.maxAttempts,
            exhausted: recovery.exhausted === true,
          },
        }
      : {}),
  };
}

async function redactedToolCalls(
  toolCalls: readonly OpenAiToolCallTrace[],
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    toolCalls.map(async (call, index) => ({
      index,
      name: call.name,
      status:
        call.status ??
        (isRecord(call.result) && call.result.ok === false
          ? 'error'
          : 'success'),
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
      arguments: {
        redacted: true,
        keys: Object.keys(call.arguments).sort(),
        digest: await stateRevision(call.arguments),
      },
      result: redactedResultSummary(call.result),
    })),
  );
}

export async function hydrateKfcOpenAiToolSession(input: {
  store: ConversationStore;
  sessionId: string;
  freshSession: KfcToolSession;
}): Promise<KfcToolSession> {
  return hydrateKfcToolSession(
    input.freshSession,
    await loadPriorVerifiedState(input.store, input.sessionId),
  );
}

export async function persistKfcOpenAiToolSession(input: {
  store: ConversationStore;
  sessionId: string;
  session: KfcToolSession;
  latestUserMessage: string;
  toolCalls: OpenAiToolCallTrace[];
  assistantTurnId: string;
  customerCommand?: CustomerCommand;
  fence?: RunCommitFence;
  runMetrics?: {
    status: 'success' | 'error';
    latencyMs: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}): Promise<'committed' | 'stale'> {
  const publication = await prepareKfcOpenAiToolSessionPublication(input);
  const { verifiedState } = publication;
  const tracePayload = publication.auditPayload;
  if (!input.fence) {
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState,
    });
    if (tracePayload) {
      await input.store.appendEvent(
        input.sessionId,
        'openai:tool_trace',
        tracePayload,
      );
    }
    return 'committed';
  }
  const result = await input.store.appendEventIfRunCurrent({
    sessionId: input.sessionId,
    sourceType: 'graph:verified_state',
    payload: { verifiedState },
    fence: input.fence,
  });
  if (result.status === 'stale' || !tracePayload) return result.status;
  await input.store.appendEventIfRunCurrent({
    sessionId: input.sessionId,
    sourceType: 'openai:tool_trace',
    payload: tracePayload,
    fence: input.fence,
  });
  return 'committed';
}

export async function prepareKfcOpenAiToolSessionPublication(input: {
  session: KfcToolSession;
  latestUserMessage: string;
  toolCalls: OpenAiToolCallTrace[];
  assistantTurnId: string;
  customerCommand?: CustomerCommand;
  runMetrics?: {
    status: 'success' | 'error';
    latencyMs: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}): Promise<{
  verifiedState: Record<string, unknown>;
  auditPayload?: Record<string, unknown>;
}> {
  const verifiedState = projectKfcOpenAiGenUiState({
    session: input.session,
    latestUserMessage: input.latestUserMessage,
    toolCalls: input.toolCalls,
    customerCommand: input.customerCommand,
  }).state as unknown as Record<string, unknown>;
  const auditPayload =
    input.toolCalls.length > 0 || input.runMetrics
      ? {
        schemaVersion: 'openai-redacted-tool-trace-v1',
        assistantTurnId: input.assistantTurnId,
        ...(input.runMetrics ? { run: input.runMetrics } : {}),
        calls: await redactedToolCalls(input.toolCalls),
        }
      : undefined;
  return { verifiedState, ...(auditPayload ? { auditPayload } : {}) };
}
