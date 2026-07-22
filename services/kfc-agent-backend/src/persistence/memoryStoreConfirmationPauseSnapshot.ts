import type { SessionControl } from './contracts.js';
import {
  parseConfirmationPauseRecord,
  type ConfirmationPauseStorageSnapshot,
} from './confirmationPause.js';
import { captureActiveMemorySessionAuthority } from './memoryStoreSessionAuthority.js';

export async function currentMemoryConfirmationPause(input: {
  requestId: string;
  confirmationPauses: ReadonlyMap<string, unknown>;
  confirmationPauseSessions: ReadonlyMap<string, string>;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  confirmationPauseStoredGenerations: ReadonlyMap<string, number>;
  confirmationPauseStoredAuthorityGenerations: ReadonlyMap<string, number>;
  confirmationPauseIdentityDigests: ReadonlyMap<string, string>;
  sessionControls: ReadonlyMap<string, SessionControl>;
}): Promise<ConfirmationPauseStorageSnapshot | undefined> {
  const value = input.confirmationPauses.get(input.requestId);
  const sessionId = input.confirmationPauseSessions.get(input.requestId);
  const sessionGeneration =
    input.confirmationPauseStoredGenerations.get(input.requestId);
  const sessionAuthorityGeneration =
    input.confirmationPauseStoredAuthorityGenerations.get(input.requestId);
  const identityDigest =
    input.confirmationPauseIdentityDigests.get(input.requestId);
  if (
    value === undefined ||
    sessionId === undefined ||
    sessionGeneration === undefined ||
    sessionAuthorityGeneration === undefined ||
    identityDigest === undefined ||
    (input.confirmationPauseGenerations.get(sessionId) ?? 0) !==
      sessionGeneration ||
    captureActiveMemorySessionAuthority(
      input.sessionControls,
      sessionId,
    ) !== sessionAuthorityGeneration
  ) {
    return undefined;
  }
  const record = await parseConfirmationPauseRecord(value);
  if (record.sessionId !== sessionId) return undefined;
  return {
    record: structuredClone(record),
    sessionGeneration,
    sessionAuthorityGeneration,
    identityDigest,
  };
}
