import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import type { Channel, CustomerAccessContext } from '../domain/types.js';
import type { AgentTurnOutput } from '../graph/agentTurnState.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  buildVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import {
  verifiedStateSnapshotSourceType,
} from '../graph/turnSupport.js';
import { digestCommerceAction } from '../ordering/approvalReceipt.js';
import {
  approvalCapabilityScopes,
  approvalCapabilitySupportsGuestCheckout,
} from '../ordering/toolBoundaries.js';
import {
  guestPrincipalMatchesAuthority,
  isAuthenticatedCommerceApprovalPrincipal,
  isGuestCheckoutPrincipal,
} from '../ordering/commerceApprovalPrincipal.js';
import {
  agentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';
import { parseCreateConfirmationPauseInput } from '../persistence/confirmationPause.js';
import type {
  ConversationStore,
  CreateConfirmationPauseInput,
  RunCommitFence,
} from '../persistence/contracts.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  authorizeGuestCheckout,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import {
  agentCheckpointThreadBelongsToSession,
} from '../session/sessionContext.js';
import {
  issueConfirmationApprovalCapability,
  type ConfirmationApprovalKeyRing,
  type VerifiedGuestConfirmationApprovalAuthority,
  verifiedGuestApprovalAuthorityAllowsContinuation,
} from './confirmationApprovalCapability.js';

const maximumConfirmationPauseTtlMs = 15 * 60_000;

export const publicConfirmationApprovalPauseSchema = z.object({
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
}).strict();

export const confirmationApprovalPausePointerSchema =
  publicConfirmationApprovalPauseSchema.omit({
    approvalCapability: true,
  }).strict();

export type PublicConfirmationApprovalPause = z.infer<
  typeof publicConfirmationApprovalPauseSchema
>;
export type ConfirmationApprovalPausePointer = z.infer<
  typeof confirmationApprovalPausePointerSchema
>;

export interface ConfirmationCheckpointReader {
  getTuple(config: RunnableConfig): Promise<{
    config: RunnableConfig;
    checkpoint: { id: string };
  } | undefined>;
}

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
  const snapshot =
    await input.store.getConfirmationPauseStorageSnapshot(
      input.pause.requestId,
    );
  if (
    !snapshot ||
    snapshot.record.requestId !== input.pause.requestId ||
    snapshot.record.action.toolName !== input.pause.capability ||
    snapshot.record.expiresAt !== input.pause.expiresAt ||
    snapshot.record.status !== 'pending'
  ) {
    throw new Error('confirmation_pause_public_authority_missing');
  }
  const issued = await issueConfirmationApprovalCapability({
    snapshot,
    accessContext: input.accessContext,
    guestCheckoutAuthority: input.guestCheckoutAuthority,
    verifiedGuestAuthority: input.verifiedGuestAuthority,
    verifiedGuestContinuationAuthority:
      input.verifiedGuestContinuationAuthority,
    keyRing: input.keyRing,
    now: input.now,
  });
  return publicConfirmationApprovalPauseSchema.parse({
    capability: input.pause.capability,
    requestId: input.pause.requestId,
    ...issued,
  });
}

export async function confirmationPausePointerForDurableEvent(input: {
  pause: Pick<
    NonNullable<AgentTurnOutput['pause']>,
    'capability' | 'requestId'
  >;
  store: ConversationStore;
}): Promise<ConfirmationApprovalPausePointer> {
  const snapshot =
    await input.store.getConfirmationPauseStorageSnapshot(
      input.pause.requestId,
    );
  if (
    !snapshot ||
    snapshot.record.requestId !== input.pause.requestId ||
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

export async function persistCanonicalConfirmationPause(input: {
  store: ConversationStore;
  sessionId: string;
  customerId: string;
  channel: Channel;
  pause: NonNullable<AgentTurnOutput['pause']>;
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  checkpointer: ConfirmationCheckpointReader | undefined;
  runCommit?: {
    fence: RunCommitFence;
    state: AgentGraphState;
  };
  now?: Date;
}): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    input.pause,
    'confirmationRecord',
  );
  const confirmationRecord: unknown = descriptor?.value;
  if (
    confirmationRecord === undefined ||
    descriptor?.configurable !== false ||
    descriptor.enumerable !== false ||
    descriptor.writable !== false ||
    input.pause.action === undefined
  ) {
    throw new Error('confirmation_pause_canonical_record_missing');
  }
  let record: CreateConfirmationPauseInput;
  try {
    record = await parseCreateConfirmationPauseInput(confirmationRecord);
  } catch {
    throw new Error('confirmation_pause_canonical_record_mismatch');
  }
  const disposition = agentToolCallDisposition(
    record.action.toolName,
    record.action.arguments,
  );
  if (
    !disposition.success ||
    disposition.data.effect !== 'irreversible_mutation' ||
    await digestCommerceAction(disposition.data.arguments) !==
      await digestCommerceAction(record.action.arguments) ||
    record.requestId !== input.pause.requestId ||
    record.sessionId !== input.sessionId ||
    record.customerId !== input.customerId ||
    record.channel !== input.channel ||
    !agentCheckpointThreadBelongsToSession(
      record.checkpointThreadId,
      input.sessionId,
    ) ||
    record.checkpointNamespace !== '' ||
    input.pause.capability !== record.action.toolName ||
    await digestCommerceAction(input.pause.action) !== record.actionDigest
  ) {
    throw new Error('confirmation_pause_canonical_record_mismatch');
  }
  const checkpointTuple = await input.checkpointer?.getTuple({
    configurable: {
      thread_id: record.checkpointThreadId,
      checkpoint_ns: record.checkpointNamespace,
      checkpoint_id: record.checkpointId,
    },
  });
  const storedCheckpoint = checkpointTuple?.config.configurable;
  const now = (input.now ?? new Date()).getTime();
  const authenticatedPrincipal =
    isAuthenticatedCommerceApprovalPrincipal(record.principal)
      ? record.principal
      : undefined;
  const access = authenticatedPrincipal
    ? authorizeCustomerAccess(input.accessContext, {
        channel: record.channel,
        sessionId: record.sessionId,
        customerId: record.customerId,
        scope: approvalCapabilityScopes[record.approvalBinding.capability],
      }, now)
    : undefined;
  const evidence = input.accessContext?.authenticationEvidence;
  const guestAuthority = input.guestCheckoutAuthority;
  const guestPrincipal = isGuestCheckoutPrincipal(record.principal)
    ? record.principal
    : undefined;
  const guestDecision =
    guestPrincipal &&
    approvalCapabilitySupportsGuestCheckout(
      record.approvalBinding.capability,
    ) &&
    guestAuthority &&
    input.runCommit
      ? authorizeGuestCheckout(guestAuthority, {
          channel: record.channel,
          sessionId: record.sessionId,
          customerId: record.customerId,
          externalMessageId: guestPrincipal.externalMessageId,
          surfaceSubjectRef: guestPrincipal.surfaceSubjectRef,
          runFence: input.runCommit.fence,
          confirmationResume:
            input.runCommit.fence.kind === 'operation_lease',
          now,
        })
      : undefined;
  const verifiedGuestDecision =
    guestPrincipal &&
    approvalCapabilitySupportsGuestCheckout(
      record.approvalBinding.capability,
    ) &&
    input.runCommit
      ? await verifiedGuestApprovalAuthorityAllowsContinuation(
          input.verifiedGuestAuthority,
          {
            principal: guestPrincipal,
            sessionId: record.sessionId,
            customerId: record.customerId,
            channel: record.channel,
            sessionGeneration:
              input.runCommit.fence.sessionAuthorityGeneration,
            checkpointThreadId: record.checkpointThreadId,
            checkpointNamespace: record.checkpointNamespace,
            checkpointId: record.checkpointId,
            toolName: record.action.toolName,
            now,
          },
        )
      : false;
  const principalAuthorized = authenticatedPrincipal
    ? (
        access?.allowed === true &&
        input.accessContext?.authenticationState === 'authenticated' &&
        evidence?.state === 'verified' &&
        input.accessContext.kfcSubjectRef ===
          authenticatedPrincipal.authenticatedSubject &&
        evidence.evidenceRef ===
          authenticatedPrincipal.authenticationEvidenceRef
      )
    : Boolean(
        guestPrincipal &&
        guestAuthority &&
        guestDecision?.allowed &&
        guestPrincipalMatchesAuthority(guestPrincipal, guestAuthority)
      ) || Boolean(
        guestPrincipal &&
        verifiedGuestDecision,
      );
  const createdAt = Date.parse(record.createdAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    !principalAuthorized ||
    checkpointTuple?.checkpoint.id !== record.checkpointId ||
    storedCheckpoint?.thread_id !== record.checkpointThreadId ||
    storedCheckpoint?.checkpoint_ns !== record.checkpointNamespace ||
    storedCheckpoint?.checkpoint_id !== record.checkpointId ||
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > maximumConfirmationPauseTtlMs
  ) {
    throw new Error('confirmation_pause_canonical_record_mismatch');
  }
  if (input.runCommit) {
    if (
      input.runCommit.state.sessionId !== record.sessionId ||
      input.runCommit.state.customerId !== record.customerId ||
      input.runCommit.state.channel !== record.channel
    ) {
      throw new Error('confirmation_pause_canonical_record_mismatch');
    }
    const authorityNotAfter = [
      record.expiresAt,
      guestAuthority?.expiresAt,
      input.verifiedGuestAuthority?.expiresAt,
    ].reduce<string>((earliest, candidate) =>
      candidate && Date.parse(candidate) < Date.parse(earliest)
        ? candidate
        : earliest,
      record.expiresAt,
    );
    const committed =
      await input.store.commitConfirmationPauseIfRunCurrent({
        fence: input.runCommit.fence,
        notAfter: authorityNotAfter,
        stateEvent: {
          sessionId: record.sessionId,
          sourceType: verifiedStateSnapshotSourceType,
          payload: {
            verifiedState:
              buildVerifiedStateSnapshot(input.runCommit.state),
          },
        },
        pause: record,
      });
    if (
      committed.status === 'created' ||
      committed.status === 'replay'
    ) {
      return;
    }
    if (committed.status === 'stale') {
      throw new Error('customer_run_cancelled');
    }
    throw new Error('confirmation_pause_request_id_conflict');
  }
  const created = await input.store.createConfirmationPause(record);
  if (created.status === 'conflict') {
    throw new Error('confirmation_pause_request_id_conflict');
  }
  await input.store.appendEvent(
    input.sessionId,
    'confirmation_pause_created',
    {
      requestId: record.requestId,
      checkpointThreadId: record.checkpointThreadId,
      checkpointNamespace: record.checkpointNamespace,
      checkpointId: record.checkpointId,
      customerId: record.customerId,
      channel: record.channel,
      actionDigest: record.actionDigest,
      approvalBindingDigest: record.approvalBindingDigest,
      status: created.record.status,
      replayed: created.status === 'replay',
    },
  );
}
