import type { CustomerAccessContext } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type {
  GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import type {
  VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';
import { canonicalJson } from '../graph/turnSupport.js';
import {
  modelPublicationAuthorityIsLive,
  validateModelPublicationAccessContext,
  validateModelPublicationAuthority,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import {
  buildModelPublicationBundle,
  type CurrentTurnResponseEvidence,
} from './modelPublicationProjection.js';
import {
  validateResponsePublicationAttestation,
  type ResponsePublicationAttestation,
} from './responsePrivacyAttestation.js';

export async function assertPublicationCommitAuthority(input: {
  state: AgentGraphState;
  authority: ModelPublicationAuthority;
  currentTurnEvidence: readonly CurrentTurnResponseEvidence[];
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  runFence?: RunCommitFence;
  confirmationResume?: boolean;
  responseText: string;
  responsePublicationAttestation: ResponsePublicationAttestation;
}): Promise<() => void> {
  const exactBinding = canonicalJson({
    authorityDigest: input.authority.authorityDigest,
    state: input.state,
    currentTurnEvidence: input.currentTurnEvidence,
    accessContext: input.accessContext ?? null,
    guestCheckoutAuthority:
      input.guestCheckoutAuthority ?? null,
    verifiedGuestAuthority:
      input.verifiedGuestAuthority ?? null,
    runFence: input.runFence ?? null,
    confirmationResume: input.confirmationResume === true,
    responseText: input.responseText,
    responsePublicationAttestation:
      input.responsePublicationAttestation,
  });
  const assertCurrent = () => {
    if (
      !modelPublicationAuthorityIsLive(input.authority) ||
      canonicalJson({
        authorityDigest: input.authority.authorityDigest,
        state: input.state,
        currentTurnEvidence: input.currentTurnEvidence,
        accessContext: input.accessContext ?? null,
        guestCheckoutAuthority:
          input.guestCheckoutAuthority ?? null,
        verifiedGuestAuthority:
          input.verifiedGuestAuthority ?? null,
        runFence: input.runFence ?? null,
        confirmationResume: input.confirmationResume === true,
        responseText: input.responseText,
        responsePublicationAttestation:
          input.responsePublicationAttestation,
      }) !== exactBinding
    ) {
      throw new Error('agent_model_publication_authority_invalid');
    }
  };
  if (
    !await validateModelPublicationAuthority({
      authority: input.authority,
      state: input.state,
    }) ||
    !await validateModelPublicationAccessContext({
      authority: input.authority,
      accessContext: input.accessContext,
      guestCheckoutAuthority: input.guestCheckoutAuthority,
      verifiedGuestAuthority: input.verifiedGuestAuthority,
      runFence: input.runFence,
      confirmationResume: input.confirmationResume,
    })
  ) {
    throw new Error('agent_model_publication_authority_invalid');
  }
  let bundle;
  try {
    bundle = await buildModelPublicationBundle({
      state: input.state,
      authority: input.authority,
      currentTurnEvidence: input.currentTurnEvidence,
    });
  } catch {
    throw new Error('agent_model_publication_authority_invalid');
  }
  const attestation = await validateResponsePublicationAttestation({
    raw: input.responsePublicationAttestation,
    bundle,
    customerText: input.responseText,
  });
  if (
    !attestation.ok ||
    !await validateModelPublicationAuthority({
      authority: input.authority,
      state: input.state,
    }) ||
    !await validateModelPublicationAccessContext({
      authority: input.authority,
      accessContext: input.accessContext,
      guestCheckoutAuthority: input.guestCheckoutAuthority,
      verifiedGuestAuthority: input.verifiedGuestAuthority,
      runFence: input.runFence,
      confirmationResume: input.confirmationResume,
    })
  ) {
    throw new Error('agent_model_publication_authority_invalid');
  }
  assertCurrent();
  return assertCurrent;
}
