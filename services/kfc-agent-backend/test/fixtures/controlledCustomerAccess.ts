import type { Channel, CustomerAccessContext } from '../../src/domain/types.js';

export function controlledCustomerAccess(input: {
  sessionId: string;
  customerId: string;
  channel?: Channel;
}): CustomerAccessContext {
  const channel = input.channel ?? 'kfc';
  const customerSurface = channel.startsWith('messenger')
    ? 'messenger'
    : channel.startsWith('zalo')
      ? 'zalo'
      : 'kfc-app-chat';
  const external = customerSurface !== 'kfc-app-chat';
  return {
    tenantScope: 'kfc-controlled-test',
    customerSurface,
    sessionRef: input.sessionId,
    surfaceSubjectRef: external ? `controlled:${input.customerId}` : 'not-applicable',
    kfcSubjectRef: input.customerId,
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: external ? 'linked' : 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'controlled-test',
      issuer: 'controlled-test',
      audience: 'kfc-agent-backend',
      authenticatedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      evidenceRef: `controlled-test:${input.customerId}`,
    },
    authorizedScopes: [
      'customer:read',
      'membership:read',
      'membership:write',
      'order:read',
      'order:write',
      'payment:read',
      'payment:write',
    ],
  };
}
