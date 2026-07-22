import type {
  Channel,
  CustomerAccessContext,
  CustomerAccessScope,
} from '../domain/types.js';

const externalChannels = new Set<Channel>([
  'messenger',
  'zalo',
  'messenger_mock',
  'zalo_mock',
]);

export interface CustomerAccessRequirement {
  channel: Channel;
  sessionId: string;
  customerId: string;
  scope: CustomerAccessScope;
}

export type CustomerAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      errorCode:
        | 'authentication_required'
        | 'subject_binding_required'
        | 'access_context_mismatch'
        | 'authorization_required';
      message: string;
    };

export function createUnverifiedCustomerAccessContext(input: {
  channel: Channel;
  sessionId: string;
}): CustomerAccessContext {
  const customerSurface = input.channel.startsWith('messenger')
    ? 'messenger'
    : input.channel.startsWith('zalo')
      ? 'zalo'
      : 'kfc-app-chat';
  const external = externalChannels.has(input.channel);
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface,
    sessionRef: input.sessionId,
    surfaceSubjectRef: external ? 'unknown' : 'not-applicable',
    kfcSubjectRef: 'unknown',
    authenticationState: 'unauthenticated',
    membershipState: 'unknown',
    channelAccountLinkState: external ? 'unknown' : 'not-applicable',
    subjectBindingState: 'unverified',
    authenticationEvidence: { state: 'none' },
    authorizedScopes: [],
  };
}

export function authorizeCustomerAccess(
  context: CustomerAccessContext | undefined,
  requirement: CustomerAccessRequirement,
  now = Date.now(),
): CustomerAccessDecision {
  if (
    !context ||
    context.authenticationState !== 'authenticated' ||
    context.authenticationEvidence?.state !== 'verified'
  ) {
    return {
      allowed: false,
      errorCode: 'authentication_required',
      message: 'Current caller-bound KFC authentication is required',
    };
  }

  if (
    !Number.isFinite(Date.parse(context.authenticationEvidence.expiresAt)) ||
    Date.parse(context.authenticationEvidence.expiresAt) <= now
  ) {
    return {
      allowed: false,
      errorCode: 'authentication_required',
      message: 'Current caller-bound KFC authentication has expired',
    };
  }

  if (
    context.subjectBindingState !== 'verified' ||
    context.kfcSubjectRef === 'none' ||
    context.kfcSubjectRef === 'unknown'
  ) {
    return {
      allowed: false,
      errorCode: 'subject_binding_required',
      message: 'A verified KFC customer subject binding is required',
    };
  }

  if (
    context.sessionRef !== requirement.sessionId ||
    context.kfcSubjectRef !== requirement.customerId
  ) {
    return {
      allowed: false,
      errorCode: 'access_context_mismatch',
      message:
        'Customer access context does not match this session and customer',
    };
  }

  if (
    externalChannels.has(requirement.channel) &&
    (context.channelAccountLinkState !== 'linked' ||
      context.surfaceSubjectRef === 'unknown' ||
      context.surfaceSubjectRef === 'not-applicable')
  ) {
    return {
      allowed: false,
      errorCode: 'subject_binding_required',
      message: 'A verified KFC account link is required for this channel',
    };
  }

  if (!context.authorizedScopes.includes(requirement.scope)) {
    return {
      allowed: false,
      errorCode: 'authorization_required',
      message: `Customer access context does not grant ${requirement.scope}`,
    };
  }

  return { allowed: true };
}
