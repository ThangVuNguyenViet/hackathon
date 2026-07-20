import { stateRevision } from '../graph/turnSupport.js';
import type { ToolName } from '../ordering/types.js';
import type {
  ResponseClaimKind,
} from './responseEvidenceContracts.js';

export const CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION =
  'kfc-current-turn-response-evidence-v1' as const;

export type CurrentTurnResponseEvidenceExecutionOutcome =
  | 'success'
  | 'error';

export interface CurrentTurnResponseEvidenceDigestInput {
  authorityDigest: string;
  currentTurnRevision: string;
  toolCallId: string;
  toolName: ToolName;
  claimKinds: readonly ResponseClaimKind[];
  value: unknown;
  privateData: boolean;
  executionOutcome: CurrentTurnResponseEvidenceExecutionOutcome;
}

export function currentTurnResponseEvidenceDigestInput(
  input: CurrentTurnResponseEvidenceDigestInput,
) {
  return {
    schemaVersion: CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION,
    authorityDigest: input.authorityDigest,
    currentTurnRevision: input.currentTurnRevision,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    claimKinds: [...input.claimKinds],
    value: input.value,
    privateData: input.privateData,
    executionOutcome: input.executionOutcome,
  };
}

export async function currentTurnResponseEvidenceDigest(
  input: CurrentTurnResponseEvidenceDigestInput,
): Promise<string> {
  return stateRevision(currentTurnResponseEvidenceDigestInput(input));
}
