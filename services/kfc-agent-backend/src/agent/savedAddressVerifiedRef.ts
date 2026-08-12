import { z } from 'zod';
import type {
  TrustedCustomerActionEnvelope,
} from '../domain/customerCommand.js';
import type { Address } from '../domain/types.js';
import {
  issueVerifiedRefRecord,
  type VerifiedRef,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import { kfcGenUiVerifiedStateRevision } from '../genui/kfcGenUi.js';
import type { AgentTurnInput } from '../businesses/kfc/turnContracts.js';
import type { AgentGraphState } from '../graph/state.js';
import { parseAgentToolArguments } from '../ordering/toolCatalog.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../ordering/types.js';
import type { ConversationStore } from '../persistence/contracts.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  authorityHasScopes,
  modelPublicationAuthorityIsLive,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import {
  validateIssuedCurrentTurnResponseEvidence,
  type CurrentTurnResponseEvidence,
} from './modelPublicationProjection.js';
import type {
  PendingToolCall,
} from './singleAgentRuntime.js';

const SAVED_ADDRESS_REF_PAYLOAD_SCHEMA_VERSION =
  'kfc-saved-address-ref-payload-v1' as const;

const exactAddressPart = z.string()
  .min(1)
  .max(500)
  .refine(
    (value) => value === value.trim(),
    'Address fields must not contain surrounding whitespace',
  );

const savedAddressSchema: z.ZodType<Address> = z.object({
  label: exactAddressPart,
  line1: exactAddressPart,
  district: exactAddressPart,
  city: exactAddressPart,
}).strict();

const savedAddressRefPayloadSchema = z.object({
  schemaVersion: z.literal(SAVED_ADDRESS_REF_PAYLOAD_SCHEMA_VERSION),
  address: savedAddressSchema,
}).strict();

export interface SavedAddressPresentationReference {
  address: Address;
  ref: VerifiedRef;
  persistence: {
    kind: 'staged';
    record: VerifiedRefRecord;
  };
}

export type ClaimedSavedAddressQuote =
  | {
      ok: true;
      state: AgentGraphState;
      call: PendingToolCall;
    }
  | {
      ok: false;
      errorCode: string;
    };

export interface PendingSavedAddressQuoteInput {
  ref: VerifiedRef;
  method: 'delivery';
  useId: string;
  callId: string;
  turnInput: Pick<
    AgentTurnInput,
    | 'accessContext'
    | 'channel'
    | 'customerId'
    | 'runGuard'
    | 'sessionId'
    | 'store'
  >;
  state: AgentGraphState;
}

function principalFromPublicationAuthority(
  authority: ModelPublicationAuthority,
): AuthenticatedCommerceApprovalPrincipal | undefined {
  if (
    !modelPublicationAuthorityIsLive(authority) ||
    !authorityHasScopes(authority, ['customer:read']) ||
    authority.privateAccess.state !== 'authenticated'
  ) {
    return undefined;
  }
  return {
    sessionId: authority.sessionId,
    customerId: authority.customerId,
    channel: authority.channel,
    authenticatedSubject: authority.privateAccess.authenticatedSubject,
    authenticationEvidenceRef:
      authority.privateAccess.authenticationEvidenceRef,
  };
}

function principalFromTurnInput(
  input: Pick<
    AgentTurnInput,
    'accessContext' | 'channel' | 'customerId' | 'sessionId'
  >,
): AuthenticatedCommerceApprovalPrincipal | undefined {
  const access = authorizeCustomerAccess(input.accessContext, {
    channel: input.channel,
    sessionId: input.sessionId,
    customerId: input.customerId,
    scope: 'customer:read',
  });
  const context = input.accessContext;
  const evidence = context?.authenticationEvidence;
  if (
    !access.allowed ||
    !context ||
    evidence?.state !== 'verified'
  ) {
    return undefined;
  }
  return {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    authenticatedSubject: context.kfcSubjectRef,
    authenticationEvidenceRef: evidence.evidenceRef,
  };
}

async function latestSingleSavedAddress(
  evidence: readonly CurrentTurnResponseEvidence[],
  authority: ModelPublicationAuthority,
): Promise<Address | undefined> {
  const latest = evidence
    .filter((entry) => entry.toolName === 'getSavedAddresses')
    .at(-1);
  if (
    !latest ||
    !latest.privateData ||
    latest.executionOutcome !== 'success' ||
    !Array.isArray(latest.value) ||
    latest.value.length !== 1
  ) {
    return undefined;
  }
  if (!await validateIssuedCurrentTurnResponseEvidence({
    evidence: latest,
    authority,
  })) {
    return undefined;
  }
  const parsed = savedAddressSchema.safeParse(latest.value[0]);
  return parsed.success ? parsed.data : undefined;
}

function normalizedPrivateText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Data-loss-prevention boundary for private saved-address evidence. This is
 * exact, evidence-derived matching rather than customer-language routing:
 * no fixed phrase or semantic keyword can authorize disclosure.
 */
export async function responseDisclosesPrivateSavedAddress(input: {
  authority: ModelPublicationAuthority;
  currentTurnEvidence: readonly CurrentTurnResponseEvidence[];
  customerText: string;
  state?: AgentGraphState;
}): Promise<boolean> {
  const response = normalizedPrivateText(input.customerText);
  if (!response) return false;
  const privateAddresses: Address[] = [];
  for (const evidence of input.currentTurnEvidence) {
    if (
      evidence.toolName !== 'getSavedAddresses' ||
      !evidence.privateData ||
      evidence.executionOutcome !== 'success' ||
      !Array.isArray(evidence.value) ||
      !await validateIssuedCurrentTurnResponseEvidence({
        evidence,
        authority: input.authority,
      })
    ) {
      continue;
    }
    for (const rawAddress of evidence.value) {
      const address = savedAddressSchema.safeParse(rawAddress);
      if (address.success) privateAddresses.push(address.data);
    }
  }
  const latestQuote = [...(input.state?.toolTrace ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.ok && entry.toolName === 'quoteFulfillment',
    );
  const ref = latestQuote?.arguments.savedAddressRef;
  if (
    input.state?.address &&
    typeof ref === 'object' &&
    ref !== null &&
    !Array.isArray(ref) &&
    'kind' in ref &&
    ref.kind === 'saved_address'
  ) {
    privateAddresses.push(input.state.address);
  }
  return privateAddresses.some((address) =>
    [
      address.label,
      address.line1,
      address.district,
      address.city,
    ]
      .map(normalizedPrivateText)
      .some(
        (privateValue) =>
          privateValue.length > 0 && response.includes(privateValue),
      ));
}

/**
 * Converts one authenticated, current-turn saved-address result into a
 * server-owned opaque handle. The raw address remains available only for the
 * immediate response presentation; it is not placed in graph state.
 */
export async function issueSavedAddressPresentationReference(input: {
  authority: ModelPublicationAuthority;
  currentTurnEvidence: readonly CurrentTurnResponseEvidence[];
  verifiedRevision: string;
  createdAt: string;
  expiresAt: string;
}): Promise<SavedAddressPresentationReference | undefined> {
  const address = await latestSingleSavedAddress(
    input.currentTurnEvidence,
    input.authority,
  );
  if (!address) return undefined;
  const principal = principalFromPublicationAuthority(input.authority);
  if (!principal) {
    throw new Error('saved_address_ref_principal_invalid');
  }
  if (input.authority.privateAccess.state !== 'authenticated') {
    throw new Error('saved_address_ref_principal_invalid');
  }
  const expiresAt = new Date(Math.min(
    Date.parse(input.expiresAt),
    Date.parse(input.authority.privateAccess.authenticationExpiresAt),
  )).toISOString();
  const issueInput = {
    kind: 'saved_address',
    principal,
    verifiedRevision: input.verifiedRevision,
    payload: {
      schemaVersion: SAVED_ADDRESS_REF_PAYLOAD_SCHEMA_VERSION,
      address: {
        label: address.label,
        line1: address.line1,
        district: address.district,
        city: address.city,
      },
    },
    lifecycle: 'one_shot',
    createdAt: input.createdAt,
    expiresAt,
  } as const;
  const record = issueVerifiedRefRecord(issueInput);
  return {
    address: { ...address },
    ref: record.ref,
    persistence: {
      kind: 'staged',
      record,
    },
  };
}

function sameSavedAddressRef(
  left: VerifiedRef | undefined,
  right: VerifiedRef,
): boolean {
  return (
    left?.kind === 'saved_address' &&
    right.kind === 'saved_address' &&
    left.id === right.id
  );
}

async function claimSavedAddressForQuote(input: {
  ref: VerifiedRef;
  expectedVerifiedRevision: string;
  useId: string;
  callId: string;
  turnInput: PendingSavedAddressQuoteInput['turnInput'];
  state: AgentGraphState;
}): Promise<ClaimedSavedAddressQuote> {
  if (!sameSavedAddressRef(input.state.pendingSavedAddressRef, input.ref)) {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    };
  }
  if (
    input.expectedVerifiedRevision !==
      kfcGenUiVerifiedStateRevision(input.state)
  ) {
    return {
      ok: false,
      errorCode: 'structured_action_verified_state_stale',
    };
  }
  if (!input.state.cart?.items.length) {
    return {
      ok: false,
      errorCode: 'structured_action_cart_required',
    };
  }
  if (input.state.addressDraft !== undefined) {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_conflicts_with_draft',
    };
  }
  const principal = principalFromTurnInput(input.turnInput);
  const runFence = input.turnInput.runGuard?.commitFence;
  const authenticationEvidence =
    input.turnInput.accessContext?.authenticationEvidence;
  if (
    !principal ||
    !runFence ||
    authenticationEvidence?.state !== 'verified'
  ) {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    };
  }
  const claimed = await input.turnInput.store.claimVerifiedRef({
    ref: input.ref,
    principal,
    expectedVerifiedRevision: input.expectedVerifiedRevision,
    now: new Date().toISOString(),
    useId: input.useId,
    runFence: {
      sessionId: principal.sessionId,
      fence: runFence,
      notAfter: authenticationEvidence.expiresAt,
    },
  });
  if (claimed.status === 'unavailable') {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    };
  }
  const payload = savedAddressRefPayloadSchema.safeParse(
    claimed.record.payload,
  );
  if (!payload.success) {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_payload_invalid',
    };
  }
  const parsedCall = parseAgentToolArguments('quoteFulfillment', {
    address: payload.data.address,
    method: 'delivery',
  });
  if (!parsedCall.success) {
    return {
      ok: false,
      errorCode: 'structured_action_tool_contract_invalid',
    };
  }
  return {
    ok: true,
    state: {
      ...input.state,
      pendingSavedAddressRef: undefined,
      fulfillment: undefined,
      orderPreview: undefined,
    },
    call: {
      id: input.callId,
      toolName: 'quoteFulfillment',
      arguments: parsedCall.data as Record<string, unknown>,
      auditArguments: {
        savedAddressRef: structuredClone(input.ref),
        method: 'delivery',
      },
    },
  };
}

/**
 * Atomically consumes the exact pending saved-address handle selected by the
 * model. The raw address exists only in the returned untracked pending call;
 * verified state receives it later from a successful fulfillment quote.
 */
export async function claimPendingSavedAddressQuote(
  input: PendingSavedAddressQuoteInput,
): Promise<ClaimedSavedAddressQuote> {
  return claimSavedAddressForQuote({
    ref: input.ref,
    expectedVerifiedRevision:
      kfcGenUiVerifiedStateRevision(input.state),
    useId: input.useId,
    callId: input.callId,
    turnInput: input.turnInput,
    state: input.state,
  });
}

/**
 * Atomically consumes a saved-address handle under the current authenticated
 * principal. The returned raw address and quote arguments are turn-local;
 * callers must not place the transient pending call in tracked graph state.
 */
export async function claimSavedAddressQuote(input: {
  envelope: TrustedCustomerActionEnvelope;
  turnInput: PendingSavedAddressQuoteInput['turnInput'];
  state: AgentGraphState;
}): Promise<ClaimedSavedAddressQuote> {
  const command = input.envelope.command;
  if (
    command.kind !== 'accept_fulfillment' ||
    !command.savedAddressRef
  ) {
    return {
      ok: false,
      errorCode: 'structured_action_saved_address_ref_missing',
    };
  }
  return claimSavedAddressForQuote({
    ref: command.savedAddressRef,
    expectedVerifiedRevision: input.envelope.verifiedRevision,
    useId: `trusted-action:${input.envelope.actionDigest}`,
    callId:
      `structured:${input.envelope.actionDigest}:quoteFulfillment`,
    turnInput: input.turnInput,
    state: input.state,
  });
}
