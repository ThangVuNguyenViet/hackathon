import type { ConversationTurn } from '../domain/types.js';
import { KFC_GENUI_SCHEMA_VERSION } from '../genui/kfcGenUi.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTrustedActionAuditTurn(
  turn: Pick<ConversationTurn, 'channel' | 'role' | 'metadata'>,
): boolean {
  const rawEvent = turn.metadata?.rawEvent;
  return (
    turn.channel === 'kfc' &&
    turn.role === 'user' &&
    isRecord(rawEvent) &&
    rawEvent.source === 'kfc_genui_action' &&
    rawEvent.schemaVersion === KFC_GENUI_SCHEMA_VERSION &&
    typeof rawEvent.assistantTurnId === 'string' &&
    rawEvent.assistantTurnId.trim().length > 0 &&
    typeof rawEvent.verifiedRevision === 'string' &&
    /^[a-f0-9]{64}$/u.test(rawEvent.verifiedRevision) &&
    typeof rawEvent.actionDigest === 'string' &&
    /^[a-f0-9]{64}$/u.test(rawEvent.actionDigest)
  );
}

export function semanticConversationTurns(
  turns: readonly ConversationTurn[],
): ConversationTurn[] {
  return turns.filter((turn) => !isTrustedActionAuditTurn(turn));
}

export function trustedActionAuditMessageIds(
  turns: readonly ConversationTurn[] | undefined,
): ReadonlySet<string> {
  return new Set(
    (turns ?? [])
      .filter(isTrustedActionAuditTurn)
      .map((turn) => `conversation:${turn.id}`),
  );
}
