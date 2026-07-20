import type {
  ConversationTurn,
  CustomerAccessContext,
  CustomerAccessScope,
} from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import { stateRevision } from '../graph/turnSupport.js';
import type {
  VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';
import {
  authorizeGuestCheckout,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';

export const MODEL_PUBLICATION_AUTHORITY_SCHEMA_VERSION =
  'kfc-model-publication-authority-v2' as const;

const issuedAuthorities = new WeakSet<object>();

export type ModelPublicationPrivateAccess =
  | { state: 'none' }
  | {
      state: 'guest_checkout';
      tenantScope: 'kfc-vietnam';
      surfaceSubjectRef: string;
      externalThreadRef: string;
      externalMessageId: string;
      ingressEvidenceRef: string;
      ingressEvidenceDigest: string;
      sourceRunFenceDigest: string;
      sessionAuthorityGeneration: number;
      guestAuthorityDigest: string;
      authorityExpiresAt: string;
    }
  | {
      state: 'authenticated';
      tenantScope: string;
      customerSurface: CustomerAccessContext['customerSurface'];
      authenticatedSubject: string;
      surfaceSubjectRef: string;
      membershipState: CustomerAccessContext['membershipState'];
      channelAccountLinkState:
        CustomerAccessContext['channelAccountLinkState'];
      authenticationEvidenceRef: string;
      authenticationEvidenceDigest: string;
      authenticationExpiresAt: string;
      authorizedScopes: CustomerAccessScope[];
    };

export interface ModelPublicationAuthority {
  schemaVersion: typeof MODEL_PUBLICATION_AUTHORITY_SCHEMA_VERSION;
  sessionId: string;
  customerId: string;
  channel: AgentGraphState['channel'];
  currentTurnId: string;
  currentTurnRevision: string;
  currentTurnExternalUserId: string | null;
  surfaceSubjectRef: string;
  privateAccess: ModelPublicationPrivateAccess;
  authorityDigest: string;
}

function sameTurn(
  left: ConversationTurn,
  right: ConversationTurn,
): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.channel === right.channel &&
    left.role === right.role &&
    left.text === right.text &&
    left.externalMessageId === right.externalMessageId &&
    left.externalUserId === right.externalUserId &&
    left.createdAt === right.createdAt
  );
}

function currentTurnBinding(turn: ConversationTurn) {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    channel: turn.channel,
    role: turn.role,
    text: turn.text,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    createdAt: turn.createdAt,
  };
}

function expectedCustomerSurface(
  channel: AgentGraphState['channel'],
): CustomerAccessContext['customerSurface'] {
  if (channel === 'messenger' || channel === 'messenger_mock') {
    return 'messenger';
  }
  if (channel === 'zalo' || channel === 'zalo_mock') return 'zalo';
  return 'kfc-app-chat';
}

function turnSurfaceSubjectRef(
  channel: AgentGraphState['channel'],
  externalUserId: string | null | undefined,
): string | undefined {
  if (expectedCustomerSurface(channel) === 'kfc-app-chat') {
    return 'not-applicable';
  }
  return typeof externalUserId === 'string' && externalUserId.length > 0
    ? externalUserId
    : undefined;
}

function currentlyAuthenticatedAccess(
  accessContext: CustomerAccessContext,
): accessContext is CustomerAccessContext & {
  authenticationEvidence: Extract<
    CustomerAccessContext['authenticationEvidence'],
    { state: 'verified' }
  >;
} {
  const now = Date.now();
  const evidence = accessContext.authenticationEvidence;
  return (
    accessContext.authenticationState === 'authenticated' &&
    accessContext.subjectBindingState === 'verified' &&
    accessContext.kfcSubjectRef !== 'none' &&
    accessContext.kfcSubjectRef !== 'unknown' &&
    evidence.state === 'verified' &&
    Number.isFinite(Date.parse(evidence.authenticatedAt)) &&
    Number.isFinite(Date.parse(evidence.expiresAt)) &&
    Date.parse(evidence.authenticatedAt) <= now &&
    Date.parse(evidence.expiresAt) > now
  );
}

function accessClaimsCurrentCredential(
  accessContext: CustomerAccessContext,
): boolean {
  const evidence = accessContext.authenticationEvidence;
  if (
    evidence.state === 'verified' &&
    Number.isFinite(Date.parse(evidence.expiresAt)) &&
    Date.parse(evidence.expiresAt) <= Date.now()
  ) {
    return false;
  }
  return (
    accessContext.authenticationState === 'authenticated' ||
    evidence.state === 'verified' ||
    accessContext.authorizedScopes.length > 0
  );
}

function accessMatchesTurn(
  accessContext: CustomerAccessContext,
  state: AgentGraphState,
  currentUserTurn: ConversationTurn,
): boolean {
  const customerSurface = expectedCustomerSurface(state.channel);
  const surfaceSubjectRef = turnSurfaceSubjectRef(
    state.channel,
    currentUserTurn.externalUserId,
  );
  if (
    surfaceSubjectRef === undefined ||
    accessContext.sessionRef !== state.sessionId ||
    accessContext.kfcSubjectRef !== state.customerId ||
    accessContext.customerSurface !== customerSurface ||
    accessContext.surfaceSubjectRef !== surfaceSubjectRef
  ) {
    return false;
  }
  return customerSurface === 'kfc-app-chat'
    ? accessContext.channelAccountLinkState === 'not-applicable'
    : accessContext.channelAccountLinkState === 'linked';
}

function authorityBinding(
  authority: Omit<ModelPublicationAuthority, 'authorityDigest'>,
) {
  return {
    schemaVersion: authority.schemaVersion,
    sessionId: authority.sessionId,
    customerId: authority.customerId,
    channel: authority.channel,
    currentTurnId: authority.currentTurnId,
    currentTurnRevision: authority.currentTurnRevision,
    currentTurnExternalUserId: authority.currentTurnExternalUserId,
    surfaceSubjectRef: authority.surfaceSubjectRef,
    privateAccess: authority.privateAccess.state === 'authenticated'
      ? {
          ...authority.privateAccess,
          authorizedScopes: [
            ...authority.privateAccess.authorizedScopes,
          ].sort(),
        }
      : { ...authority.privateAccess },
  };
}

async function privateAccessFor(input: {
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority: GuestCheckoutAuthority | undefined;
  verifiedGuestAuthority:
    VerifiedGuestApprovalResumeAuthority | undefined;
  runFence: RunCommitFence | undefined;
  confirmationResume: boolean;
  state: AgentGraphState;
  currentUserTurn: ConversationTurn;
}): Promise<ModelPublicationPrivateAccess> {
  const {
    accessContext,
    currentUserTurn,
    guestCheckoutAuthority,
    verifiedGuestAuthority,
    state,
  } = input;
  if (accessContext && currentlyAuthenticatedAccess(accessContext)) {
    if (!accessMatchesTurn(accessContext, state, currentUserTurn)) {
      throw new Error('model_publication_authority_invalid');
    }
    const authorizedScopes = Object.freeze(
      [...accessContext.authorizedScopes].sort(),
    ) as CustomerAccessScope[];
    return Object.freeze({
      state: 'authenticated',
      tenantScope: accessContext.tenantScope,
      customerSurface: accessContext.customerSurface,
      authenticatedSubject: accessContext.kfcSubjectRef,
      surfaceSubjectRef: accessContext.surfaceSubjectRef,
      membershipState: accessContext.membershipState,
      channelAccountLinkState: accessContext.channelAccountLinkState,
      authenticationEvidenceRef:
        accessContext.authenticationEvidence.evidenceRef,
      authenticationEvidenceDigest: await stateRevision(
        accessContext.authenticationEvidence,
      ),
      authenticationExpiresAt:
        accessContext.authenticationEvidence.expiresAt,
      authorizedScopes,
    });
  }
  if (accessContext && accessClaimsCurrentCredential(accessContext)) {
    throw new Error('model_publication_authority_invalid');
  }
  if (
    input.confirmationResume &&
    verifiedGuestAuthority &&
    verifiedGuestAuthority.sessionId === state.sessionId &&
    verifiedGuestAuthority.customerId === state.customerId &&
    verifiedGuestAuthority.channel === state.channel &&
    verifiedGuestAuthority.externalMessageId ===
      currentUserTurn.externalMessageId &&
    verifiedGuestAuthority.surfaceSubjectRef ===
      turnSurfaceSubjectRef(
        state.channel,
        currentUserTurn.externalUserId,
      ) &&
    verifiedGuestAuthority.sessionGeneration ===
      input.runFence?.sessionAuthorityGeneration &&
    Date.parse(verifiedGuestAuthority.expiresAt) > Date.now()
  ) {
    return Object.freeze({
      state: 'guest_checkout',
      tenantScope: verifiedGuestAuthority.tenantScope,
      surfaceSubjectRef:
        verifiedGuestAuthority.surfaceSubjectRef,
      externalThreadRef:
        verifiedGuestAuthority.externalThreadRef,
      externalMessageId:
        verifiedGuestAuthority.externalMessageId,
      ingressEvidenceRef:
        verifiedGuestAuthority.ingressEvidenceRef,
      ingressEvidenceDigest:
        verifiedGuestAuthority.ingressEvidenceDigest,
      sourceRunFenceDigest:
        verifiedGuestAuthority.sourceRunFenceDigest,
      sessionAuthorityGeneration:
        verifiedGuestAuthority.sessionGeneration,
      guestAuthorityDigest:
        verifiedGuestAuthority.guestAuthorityDigest,
      authorityExpiresAt: verifiedGuestAuthority.expiresAt,
    });
  }
  const guestDecision = authorizeGuestCheckout(
    guestCheckoutAuthority,
    {
      channel: state.channel,
      sessionId: state.sessionId,
      customerId: state.customerId,
      externalMessageId: currentUserTurn.externalMessageId,
      surfaceSubjectRef:
        turnSurfaceSubjectRef(state.channel, currentUserTurn.externalUserId),
      runFence: input.runFence,
      confirmationResume: input.confirmationResume,
    },
  );
  if (guestDecision.allowed && guestCheckoutAuthority) {
    return Object.freeze({
      state: 'guest_checkout',
      tenantScope: guestCheckoutAuthority.tenantScope,
      surfaceSubjectRef: guestCheckoutAuthority.surfaceSubjectRef,
      externalThreadRef: guestCheckoutAuthority.externalThreadRef,
      externalMessageId: guestCheckoutAuthority.externalMessageId,
      ingressEvidenceRef: guestCheckoutAuthority.ingressEvidenceRef,
      ingressEvidenceDigest:
        guestCheckoutAuthority.ingressEvidenceDigest,
      sourceRunFenceDigest:
        guestCheckoutAuthority.sourceRunFenceDigest,
      sessionAuthorityGeneration:
        guestCheckoutAuthority.sessionAuthorityGeneration,
      guestAuthorityDigest: guestCheckoutAuthority.authorityDigest,
      authorityExpiresAt: guestCheckoutAuthority.expiresAt,
    });
  }
  if (guestCheckoutAuthority) {
    throw new Error('model_publication_authority_invalid');
  }
  return Object.freeze({ state: 'none' });
}

export async function issueModelPublicationAuthority(input: {
  state: AgentGraphState;
  currentUserTurn: ConversationTurn;
  accessContext?: CustomerAccessContext;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  runFence?: RunCommitFence;
  confirmationResume?: boolean;
}): Promise<ModelPublicationAuthority> {
  const { currentUserTurn, state } = input;
  const matchingTurns = state.recentTurns?.filter(
    (turn) => turn.id === currentUserTurn.id,
  ) ?? [];
  const stateTurn = matchingTurns[0];
  const currentStateUserTurn = state.recentTurns
    ?.filter((turn) => turn.role === 'user')
    .at(-1);
  const surfaceSubjectRef = turnSurfaceSubjectRef(
    state.channel,
    currentUserTurn.externalUserId,
  );
  if (
    currentUserTurn.role !== 'user' ||
    currentUserTurn.sessionId !== state.sessionId ||
    currentUserTurn.channel !== state.channel ||
    currentUserTurn.text !== state.latestUserMessage ||
    matchingTurns.length !== 1 ||
    currentStateUserTurn?.id !== currentUserTurn.id ||
    !stateTurn ||
    !sameTurn(stateTurn, currentUserTurn) ||
    surfaceSubjectRef === undefined
  ) {
    throw new Error('model_publication_authority_invalid');
  }
  const currentTurnRevision = await stateRevision(
    currentTurnBinding(currentUserTurn),
  );
  const unbranded = {
    schemaVersion: MODEL_PUBLICATION_AUTHORITY_SCHEMA_VERSION,
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: state.channel,
    currentTurnId: currentUserTurn.id,
    currentTurnRevision,
    currentTurnExternalUserId:
      currentUserTurn.externalUserId ?? null,
    surfaceSubjectRef,
    privateAccess: await privateAccessFor({
      accessContext: input.accessContext,
      guestCheckoutAuthority: input.guestCheckoutAuthority,
      verifiedGuestAuthority: input.verifiedGuestAuthority,
      runFence: input.runFence,
      confirmationResume: input.confirmationResume === true,
      state,
      currentUserTurn,
    }),
  };
  const authorityDigest = await stateRevision(authorityBinding(unbranded));
  const authority = Object.freeze({
    ...unbranded,
    authorityDigest,
  });
  issuedAuthorities.add(authority);
  return authority;
}

export function modelPublicationAuthorityIsLive(
  authority: ModelPublicationAuthority,
): boolean {
  return (
    issuedAuthorities.has(authority) &&
    (
      authority.privateAccess.state === 'none' ||
      Date.parse(
        authority.privateAccess.state === 'authenticated'
          ? authority.privateAccess.authenticationExpiresAt
          : authority.privateAccess.authorityExpiresAt,
      ) > Date.now()
    )
  );
}

export async function validateModelPublicationAuthority(input: {
  authority: ModelPublicationAuthority;
  state: AgentGraphState;
}): Promise<boolean> {
  const { authority, state } = input;
  if (
    !modelPublicationAuthorityIsLive(authority) ||
    authority.schemaVersion !== MODEL_PUBLICATION_AUTHORITY_SCHEMA_VERSION ||
    authority.sessionId !== state.sessionId ||
    authority.customerId !== state.customerId ||
    authority.channel !== state.channel
  ) {
    return false;
  }
  const currentTurn = state.recentTurns?.find(
    (turn) => turn.id === authority.currentTurnId,
  );
  const matchingTurnCount = state.recentTurns?.filter(
    (turn) => turn.id === authority.currentTurnId,
  ).length ?? 0;
  const currentStateUserTurn = state.recentTurns
    ?.filter((turn) => turn.role === 'user')
    .at(-1);
  if (
    !currentTurn ||
    matchingTurnCount !== 1 ||
    currentStateUserTurn?.id !== authority.currentTurnId ||
    currentTurn.role !== 'user' ||
    currentTurn.text !== state.latestUserMessage ||
    authority.currentTurnExternalUserId !==
      (currentTurn.externalUserId ?? null) ||
    authority.surfaceSubjectRef !==
      turnSurfaceSubjectRef(state.channel, currentTurn.externalUserId)
  ) {
    return false;
  }
  const currentTurnRevision = await stateRevision(
    currentTurnBinding(currentTurn),
  );
  if (currentTurnRevision !== authority.currentTurnRevision) return false;
  return authority.authorityDigest === await stateRevision(
    authorityBinding(authority),
  );
}

export async function validateModelPublicationAccessContext(input: {
  authority: ModelPublicationAuthority;
  accessContext: CustomerAccessContext | undefined;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  runFence?: RunCommitFence;
  confirmationResume?: boolean;
}): Promise<boolean> {
  const { accessContext, authority } = input;
  if (!modelPublicationAuthorityIsLive(authority)) return false;
  if (authority.privateAccess.state === 'none') {
    return (
      accessContext === undefined ||
      !accessClaimsCurrentCredential(accessContext)
    ) && input.guestCheckoutAuthority === undefined;
  }
  if (authority.privateAccess.state === 'guest_checkout') {
    if (
      accessContext !== undefined &&
      accessClaimsCurrentCredential(accessContext)
    ) {
      return false;
    }
    const verifiedGuest = input.verifiedGuestAuthority;
    if (
      input.confirmationResume === true &&
      verifiedGuest &&
      verifiedGuest.sessionId === authority.sessionId &&
      verifiedGuest.customerId === authority.customerId &&
      verifiedGuest.channel === authority.channel &&
      verifiedGuest.sessionGeneration ===
        authority.privateAccess.sessionAuthorityGeneration &&
      verifiedGuest.guestAuthorityDigest ===
        authority.privateAccess.guestAuthorityDigest &&
      verifiedGuest.expiresAt ===
        authority.privateAccess.authorityExpiresAt &&
      Date.parse(verifiedGuest.expiresAt) > Date.now()
    ) {
      return true;
    }
    const decision = authorizeGuestCheckout(
      input.guestCheckoutAuthority,
      {
        channel: authority.channel,
        sessionId: authority.sessionId,
        customerId: authority.customerId,
        externalMessageId: authority.privateAccess.externalMessageId,
        surfaceSubjectRef:
          authority.privateAccess.surfaceSubjectRef,
        runFence: input.runFence,
        confirmationResume: input.confirmationResume,
      },
    );
    const guest = input.guestCheckoutAuthority;
    return Boolean(
      decision.allowed &&
        guest &&
        guest.tenantScope === authority.privateAccess.tenantScope &&
        guest.externalThreadRef ===
          authority.privateAccess.externalThreadRef &&
        guest.ingressEvidenceRef ===
          authority.privateAccess.ingressEvidenceRef &&
        guest.ingressEvidenceDigest ===
          authority.privateAccess.ingressEvidenceDigest &&
        guest.sourceRunFenceDigest ===
          authority.privateAccess.sourceRunFenceDigest &&
        guest.sessionAuthorityGeneration ===
          authority.privateAccess.sessionAuthorityGeneration &&
        guest.authorityDigest ===
          authority.privateAccess.guestAuthorityDigest &&
        guest.expiresAt ===
          authority.privateAccess.authorityExpiresAt
    );
  }
  if (
    !accessContext ||
    !currentlyAuthenticatedAccess(accessContext) ||
    accessContext.tenantScope !== authority.privateAccess.tenantScope ||
    accessContext.customerSurface !==
      authority.privateAccess.customerSurface ||
    accessContext.sessionRef !== authority.sessionId ||
    accessContext.kfcSubjectRef !==
      authority.privateAccess.authenticatedSubject ||
    accessContext.surfaceSubjectRef !==
      authority.privateAccess.surfaceSubjectRef ||
    accessContext.membershipState !==
      authority.privateAccess.membershipState ||
    accessContext.channelAccountLinkState !==
      authority.privateAccess.channelAccountLinkState ||
    accessContext.authenticationEvidence.evidenceRef !==
      authority.privateAccess.authenticationEvidenceRef ||
    accessContext.authenticationEvidence.expiresAt !==
      authority.privateAccess.authenticationExpiresAt ||
    JSON.stringify([...accessContext.authorizedScopes].sort()) !==
      JSON.stringify(authority.privateAccess.authorizedScopes)
  ) {
    return false;
  }
  return await stateRevision(accessContext.authenticationEvidence) ===
    authority.privateAccess.authenticationEvidenceDigest;
}

export function authorityHasScopes(
  authority: ModelPublicationAuthority,
  scopes: readonly CustomerAccessScope[],
): boolean {
  if (!modelPublicationAuthorityIsLive(authority)) return false;
  if (scopes.length === 0) return true;
  if (authority.privateAccess.state !== 'authenticated') return false;
  const authorized = new Set(authority.privateAccess.authorizedScopes);
  return scopes.every((scope) => authorized.has(scope));
}

export function authorityAllowsCurrentSessionCheckoutEvidence(
  authority: ModelPublicationAuthority,
): boolean {
  return (
    modelPublicationAuthorityIsLive(authority) &&
    authority.privateAccess.state === 'guest_checkout'
  );
}

export function modelPublicationAuthorizedScopes(
  authority: ModelPublicationAuthority,
): CustomerAccessScope[] {
  return authority.privateAccess.state === 'authenticated' &&
      modelPublicationAuthorityIsLive(authority)
    ? [...authority.privateAccess.authorizedScopes]
    : [];
}
