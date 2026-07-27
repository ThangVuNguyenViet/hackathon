import {
  verifiedRefRecordSchema,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type { ConversationTurn } from '../domain/types.js';
import type {
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnInput,
} from './contracts.js';

export interface PreparedAssistantTurnCommit {
  turn: ConversationTurn;
  verifiedRefs: VerifiedRefRecord[];
}

export function prepareAssistantTurnCommit(
  input: CommitAssistantTurnIfRunCurrentInput | CommitAssistantTurnInput,
  now = new Date(),
  ordinal = 0,
): PreparedAssistantTurnCommit {
  if (
    input.assistantTurn.role !== 'assistant' ||
    (input.packState &&
      input.packState.sessionId !== input.assistantTurn.sessionId)
  ) {
    throw new Error('agent_turn_commit_shape_invalid');
  }
  const verifiedRefs = (input.verifiedRefs ?? []).map((value) =>
    verifiedRefRecordSchema.parse(structuredClone(value)),
  );
  if (
    verifiedRefs.some(
      (record) => record.principal.sessionId !== input.assistantTurn.sessionId,
    )
  ) {
    throw new Error('agent_turn_commit_verified_ref_session_mismatch');
  }
  const createdAt = input.assistantTurn.createdAt ?? now.toISOString();
  const turn: ConversationTurn = {
    ...structuredClone(input.assistantTurn),
    metadata: structuredClone(input.assistantTurn.metadata ?? null),
    id: input.assistantTurn.id ?? `turn_${crypto.randomUUID()}`,
    ordinal,
    createdAt,
  };
  return { turn, verifiedRefs };
}
