import type {
  VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';

const issuedVerifiedGuestApprovalAuthorities = new WeakSet<object>();

export function markVerifiedGuestApprovalAuthorityIssued(
  authority: VerifiedGuestApprovalResumeAuthority,
): VerifiedGuestApprovalResumeAuthority {
  issuedVerifiedGuestApprovalAuthorities.add(authority);
  return authority;
}

export function verifiedGuestApprovalAuthorityIsIssued(
  authority: VerifiedGuestApprovalResumeAuthority | undefined,
): authority is VerifiedGuestApprovalResumeAuthority {
  return (
    authority !== undefined &&
    issuedVerifiedGuestApprovalAuthorities.has(authority)
  );
}
