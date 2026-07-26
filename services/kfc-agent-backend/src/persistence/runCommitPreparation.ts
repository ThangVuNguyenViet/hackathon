import {
  verifiedRefRecordSchema,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type { ConversationTurn } from '../domain/types.js';
import type {
  CommitAssistantTurnInput,
  CommitAssistantTurnIfRunCurrentInput,
  StoredEvent,
} from './contracts.js';
import type { AgentInputItem } from '@kfc/openai-agents-runtime';

export interface PreparedAssistantTurnCommit {
  stateEvent: StoredEvent;
  turnEvent: StoredEvent;
  turn: ConversationTurn;
  verifiedRefs: VerifiedRefRecord[];
  sdkSessionItems: AgentInputItem[];
  auditEvent?: StoredEvent;
}

export function prepareAssistantTurnCommit(
  input: CommitAssistantTurnInput | CommitAssistantTurnIfRunCurrentInput,
  now = new Date(),
): PreparedAssistantTurnCommit {
  if (
    input.stateEvent.sessionId !== input.assistantTurn.sessionId ||
    input.assistantTurn.role !== 'assistant'
  ) {
    throw new Error('agent_turn_commit_shape_invalid');
  }
  const verifiedRefs = (input.verifiedRefs ?? []).map((value) =>
    verifiedRefRecordSchema.parse(structuredClone(value))
  );
  if (
    verifiedRefs.some(
      (record) =>
        record.principal.sessionId !== input.assistantTurn.sessionId,
    )
  ) {
    throw new Error('agent_turn_commit_verified_ref_session_mismatch');
  }
  const createdAt =
    input.assistantTurn.createdAt ?? now.toISOString();
  const turn: ConversationTurn = {
    ...structuredClone(input.assistantTurn),
    metadata: structuredClone(input.assistantTurn.metadata ?? null),
    id: input.assistantTurn.id ?? `turn_${crypto.randomUUID()}`,
    createdAt,
  };
  const stateEvent: StoredEvent = {
    id: `event_${crypto.randomUUID()}`,
    sessionId: input.stateEvent.sessionId,
    sourceType: input.stateEvent.sourceType,
    payload: structuredClone(input.stateEvent.payload),
    createdAt: now.toISOString(),
  };
  const turnEvent: StoredEvent = {
    id: `event_${crypto.randomUUID()}`,
    sessionId: turn.sessionId,
    sourceType: 'conversation_turn:assistant',
    payload: {
      text: turn.text,
      channel: turn.channel,
      deliveryStatus: turn.deliveryStatus,
      externalMessageId: turn.externalMessageId,
      externalUserId: turn.externalUserId,
      metadata: structuredClone(turn.metadata),
    },
    createdAt: now.toISOString(),
  };
  const auditEvent = input.auditEvent
    ? {
        id: `event_${crypto.randomUUID()}`,
        sessionId: input.auditEvent.sessionId,
        sourceType: input.auditEvent.sourceType,
        payload: structuredClone(input.auditEvent.payload),
        createdAt: now.toISOString(),
      }
    : undefined;
  return {
    stateEvent,
    turnEvent,
    turn,
    verifiedRefs,
    sdkSessionItems: [...structuredClone(input.sdkSessionItems ?? [])],
    ...(auditEvent ? { auditEvent } : {}),
  };
}
