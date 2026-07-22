import type {
  AuthenticatedCommerceApprovalPrincipal,
  CommerceApprovalPrincipal,
  GuestCheckoutCommerceApprovalPrincipal,
} from './types.js';
import type {
  GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';

export function isGuestCheckoutPrincipal(
  principal: CommerceApprovalPrincipal,
): principal is GuestCheckoutCommerceApprovalPrincipal {
  return principal.principalKind === 'guest_checkout';
}
export function isAuthenticatedCommerceApprovalPrincipal(
  principal: CommerceApprovalPrincipal,
): principal is AuthenticatedCommerceApprovalPrincipal {
  return !isGuestCheckoutPrincipal(principal);
}

export function authenticatedCommerceApprovalPrincipal(input: {
  sessionId: string;
  customerId: string;
  channel: AuthenticatedCommerceApprovalPrincipal['channel'];
  authenticatedSubject: string;
  authenticationEvidenceRef: string;
}): AuthenticatedCommerceApprovalPrincipal {
  return Object.freeze({
    principalKind: 'authenticated_customer',
    ...input,
  });
}

export function guestCheckoutCommerceApprovalPrincipal(
  authority: GuestCheckoutAuthority,
): GuestCheckoutCommerceApprovalPrincipal {
  return Object.freeze({
    principalKind: 'guest_checkout',
    sessionId: authority.sessionId,
    customerId: authority.customerId,
    channel: authority.channel,
    tenantScope: authority.tenantScope,
    surfaceSubjectRef: authority.surfaceSubjectRef,
    externalThreadRef: authority.externalThreadRef,
    externalMessageId: authority.externalMessageId,
    ingressEvidenceRef: authority.ingressEvidenceRef,
    ingressEvidenceDigest: authority.ingressEvidenceDigest,
    sourceRunKind: authority.sourceRunKind,
    sourceRunRef: authority.sourceRunRef,
    sourceRunGeneration: authority.sourceRunGeneration,
    sourceRunFenceDigest: authority.sourceRunFenceDigest,
    sessionAuthorityGeneration: authority.sessionAuthorityGeneration,
    issuedAt: authority.issuedAt,
    expiresAt: authority.expiresAt,
    guestAuthorityDigest: authority.authorityDigest,
  });
}

export function guestPrincipalMatchesAuthority(
  principal: GuestCheckoutCommerceApprovalPrincipal,
  authority: GuestCheckoutAuthority,
): boolean {
  return (
    principal.sessionId === authority.sessionId &&
    principal.customerId === authority.customerId &&
    principal.channel === authority.channel &&
    principal.tenantScope === authority.tenantScope &&
    principal.surfaceSubjectRef === authority.surfaceSubjectRef &&
    principal.externalThreadRef === authority.externalThreadRef &&
    principal.externalMessageId === authority.externalMessageId &&
    principal.ingressEvidenceRef === authority.ingressEvidenceRef &&
    principal.ingressEvidenceDigest === authority.ingressEvidenceDigest &&
    principal.sourceRunKind === authority.sourceRunKind &&
    principal.sourceRunRef === authority.sourceRunRef &&
    principal.sourceRunGeneration === authority.sourceRunGeneration &&
    principal.sourceRunFenceDigest === authority.sourceRunFenceDigest &&
    principal.sessionAuthorityGeneration ===
      authority.sessionAuthorityGeneration &&
    principal.issuedAt === authority.issuedAt &&
    principal.expiresAt === authority.expiresAt &&
    principal.guestAuthorityDigest === authority.authorityDigest
  );
}

export function commerceApprovalPrincipalStorageSubject(
  principal: CommerceApprovalPrincipal,
): string {
  return isGuestCheckoutPrincipal(principal)
    ? principal.surfaceSubjectRef
    : principal.authenticatedSubject;
}

export function commerceApprovalPrincipalStorageEvidenceRef(
  principal: CommerceApprovalPrincipal,
): string {
  return isGuestCheckoutPrincipal(principal)
    ? principal.ingressEvidenceRef
    : principal.authenticationEvidenceRef;
}

export function commerceApprovalPrincipalsMatch(
  left: CommerceApprovalPrincipal,
  right: CommerceApprovalPrincipal,
): boolean {
  if (
    left.sessionId !== right.sessionId ||
    left.customerId !== right.customerId ||
    left.channel !== right.channel ||
    isGuestCheckoutPrincipal(left) !== isGuestCheckoutPrincipal(right)
  ) {
    return false;
  }
  if (
    isGuestCheckoutPrincipal(left) &&
    isGuestCheckoutPrincipal(right)
  ) {
    return (
      left.tenantScope === right.tenantScope &&
      left.surfaceSubjectRef === right.surfaceSubjectRef &&
      left.externalThreadRef === right.externalThreadRef &&
      left.externalMessageId === right.externalMessageId &&
      left.ingressEvidenceRef === right.ingressEvidenceRef &&
      left.ingressEvidenceDigest === right.ingressEvidenceDigest &&
      left.sourceRunKind === right.sourceRunKind &&
      left.sourceRunRef === right.sourceRunRef &&
      left.sourceRunGeneration === right.sourceRunGeneration &&
      left.sourceRunFenceDigest === right.sourceRunFenceDigest &&
      left.sessionAuthorityGeneration ===
        right.sessionAuthorityGeneration &&
      left.issuedAt === right.issuedAt &&
      left.expiresAt === right.expiresAt &&
      left.guestAuthorityDigest === right.guestAuthorityDigest
    );
  }
  return (
    isAuthenticatedCommerceApprovalPrincipal(left) &&
    isAuthenticatedCommerceApprovalPrincipal(right) &&
    left.authenticatedSubject === right.authenticatedSubject &&
    left.authenticationEvidenceRef === right.authenticationEvidenceRef
  );
}
