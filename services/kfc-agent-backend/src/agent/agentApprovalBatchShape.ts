import type {
  CanonicalAgentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';

export const APPROVAL_BATCH_MODEL_INSTRUCTION =
  'An approval-required tool must be the only call in its tool-call batch. Complete reads and reversible operations in earlier model rounds, then author exactly one approval-required call against the resulting verified state.';

export function isValidApprovalBatchShape(
  calls: readonly CanonicalAgentToolCallDisposition[],
): boolean {
  const approvalCount = calls.filter(
    ({ effect }) => effect === 'irreversible_mutation',
  ).length;
  return approvalCount === 0 ||
    (approvalCount === 1 && calls.length === 1);
}
