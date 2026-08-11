import { z } from 'zod';
import type { CustomerAccessContext } from '../domain/types.js';
import type { AgentTurnOutput } from '../businesses/kfc/turnContracts.js';
import type { AgentGraphState } from '../graph/state.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import type { GuestCheckoutAuthority } from '../security/guestCheckoutAuthority.js';
import {
  issueConfirmationApprovalCapability,
  type ConfirmationApprovalKeyRing,
  type VerifiedGuestConfirmationApprovalAuthority,
} from './confirmationApprovalCapability.js';

export const publicConfirmationApprovalPauseSchema = z
  .object({
    capability: z.enum([
      'placeOrder',
      'createPaymentLink',
      'acquireVoucher',
      'redeemReward',
      'handoff',
      'resolveHandoff',
    ]),
    requestId: z.string().uuid(),
    approvalCapability: z.string().min(1).max(8_192),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const confirmationApprovalPausePointerSchema =
  publicConfirmationApprovalPauseSchema
    .omit({ approvalCapability: true })
    .strict();

export type PublicConfirmationApprovalPause = z.infer<
  typeof publicConfirmationApprovalPauseSchema
>;
export type ConfirmationApprovalPausePointer = z.infer<
  typeof confirmationApprovalPausePointerSchema
>;

export async function confirmationPauseForPublicResponse(input: {
  pause: ConfirmationApprovalPausePointer;
  store: ConversationStore;
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  verifiedGuestContinuationAuthority?:
    VerifiedGuestConfirmationApprovalAuthority;
  keyRing: ConfirmationApprovalKeyRing;
  now?: Date;
}): Promise<PublicConfirmationApprovalPause> {
  const snapshot = await input.store.getConfirmationPauseStorageSnapshot(
    input.pause.requestId,
  );
  if (
    !snapshot ||
    snapshot.record.action.toolName !== input.pause.capability ||
    snapshot.record.expiresAt !== input.pause.expiresAt ||
    snapshot.record.status !== 'pending'
  ) {
    throw new Error('confirmation_pause_public_authority_missing');
  }
  return publicConfirmationApprovalPauseSchema.parse({
    capability: input.pause.capability,
    requestId: input.pause.requestId,
    ...(await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: input.accessContext,
      guestCheckoutAuthority: input.guestCheckoutAuthority,
      verifiedGuestAuthority: input.verifiedGuestAuthority,
      verifiedGuestContinuationAuthority:
        input.verifiedGuestContinuationAuthority,
      keyRing: input.keyRing,
      now: input.now,
    })),
  });
}

export async function confirmationPausePointerForDurableEvent(input: {
  pause: Pick<
    NonNullable<AgentTurnOutput['pause']>,
    'capability' | 'requestId'
  >;
  store: ConversationStore;
}): Promise<ConfirmationApprovalPausePointer> {
  const snapshot = await input.store.getConfirmationPauseStorageSnapshot(
    input.pause.requestId,
  );
  if (
    !snapshot ||
    snapshot.record.action.toolName !== input.pause.capability ||
    snapshot.record.status !== 'pending'
  ) {
    throw new Error('confirmation_pause_public_authority_missing');
  }
  return confirmationApprovalPausePointerSchema.parse({
    capability: input.pause.capability,
    requestId: input.pause.requestId,
    expiresAt: snapshot.record.expiresAt,
  });
}

/**
 * The LangChain application transaction persists the canonical pause before
 * returning it. This boundary verifies that route projection never fabricates
 * a pause or changes its exact action identity.
 */
export async function persistCanonicalConfirmationPause(input: {
  store: ConversationStore;
  sessionId: string;
  customerId: string;
  channel: AgentTurnOutput['state']['channel'];
  pause: NonNullable<AgentTurnOutput['pause']>;
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  runCommit?: { fence: RunCommitFence; state: AgentGraphState };
}): Promise<void> {
  const snapshot = await input.store.getConfirmationPauseStorageSnapshot(
    input.pause.requestId,
  );
  if (
    !snapshot ||
    snapshot.record.sessionId !== input.sessionId ||
    snapshot.record.customerId !== input.customerId ||
    snapshot.record.channel !== input.channel ||
    snapshot.record.action.toolName !== input.pause.capability ||
    snapshot.record.action.toolName !== input.pause.action?.toolName
  ) {
    throw new Error('confirmation_pause_canonical_record_mismatch');
  }
}
