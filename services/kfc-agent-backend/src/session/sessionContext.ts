import type { ConversationTurn } from '../domain/types.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';

const defaultRecentTurnLimit = 8;

export function sessionIdForConversationEvent(
  event: Pick<ConversationEvent, 'channel' | 'externalThreadId'>,
): string {
  if (event.channel === 'messenger' || event.channel === 'zalo') {
    return `${event.channel}:${event.externalThreadId}`;
  }
  return event.externalThreadId;
}

export function langGraphConfigForSession(sessionId: string): { configurable: { thread_id: string } } {
  return { configurable: { thread_id: sessionId } };
}

export function langGraphConfigForRun(
  sessionId: string,
  runId: string,
): { configurable: { thread_id: string; checkpoint_ns: string } } {
  return { configurable: { thread_id: sessionId, checkpoint_ns: `run:${runId}` } };
}

export function agentCheckpointThreadId(input: {
  threadId: string;
  namespace: string;
}): string {
  return `agent:${JSON.stringify([input.threadId, input.namespace])}`;
}

export function agentCheckpointThreadBelongsToSession(
  threadId: string,
  sessionId: string,
): boolean {
  if (!threadId.startsWith('agent:')) return false;
  try {
    const parsed: unknown = JSON.parse(threadId.slice('agent:'.length));
    return (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed[0] === sessionId &&
      typeof parsed[1] === 'string' &&
      parsed[1].length > 0
    );
  } catch {
    return false;
  }
}

export function agentCheckpointRunId(
  checkpointThreadId: string,
  sessionId: string,
): string | undefined {
  if (!checkpointThreadId.startsWith('agent:')) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      checkpointThreadId.slice('agent:'.length),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed[0] !== sessionId ||
      typeof parsed[1] !== 'string' ||
      !parsed[1].startsWith('run:')
    ) {
      return undefined;
    }
    const runId = parsed[1].slice('run:'.length);
    return runId.trim() ? runId : undefined;
  } catch {
    return undefined;
  }
}

export function agentCheckpointThreadPrefix(sessionId: string): string {
  const encoded = JSON.stringify([sessionId]);
  return `agent:${encoded.slice(0, -1)},`;
}

export function buildBoundedRecentTurns(
  turns: ConversationTurn[],
  limit = defaultRecentTurnLimit,
): ConversationTurn[] {
  return turns
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-limit);
}
