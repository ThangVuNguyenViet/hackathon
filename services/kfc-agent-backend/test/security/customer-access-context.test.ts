import { describe, expect, it } from 'vitest';
import {
  authorizeCustomerAccess,
  createUnverifiedCustomerAccessContext,
} from '../../src/security/customerAccessContext.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

const requirement = {
  channel: 'kfc' as const,
  sessionId: 'kfc:customer_1',
  customerId: 'customer_1',
  scope: 'membership:read' as const,
};

describe('customer access context', () => {
  it('fails closed for an unverified public-route context', () => {
    const context = createUnverifiedCustomerAccessContext({
      channel: 'kfc',
      sessionId: requirement.sessionId,
    });

    expect(authorizeCustomerAccess(context, requirement)).toMatchObject({
      allowed: false,
      errorCode: 'authentication_required',
    });
  });

  it('allows an exact, unexpired, explicitly scoped subject binding', () => {
    const context = controlledCustomerAccess({
      sessionId: requirement.sessionId,
      customerId: requirement.customerId,
    });

    expect(authorizeCustomerAccess(context, requirement)).toEqual({ allowed: true });
  });

  it('rejects expired evidence and subject mismatches', () => {
    const context = controlledCustomerAccess({
      sessionId: requirement.sessionId,
      customerId: requirement.customerId,
    });
    if (context.authenticationEvidence.state !== 'verified') {
      throw new Error('controlled context must include verified evidence');
    }

    expect(
      authorizeCustomerAccess(
        {
          ...context,
          authenticationEvidence: {
            ...context.authenticationEvidence,
            expiresAt: '2026-07-13T00:00:00.000Z',
          },
        },
        requirement,
        Date.parse('2026-07-14T00:00:00.000Z'),
      ),
    ).toMatchObject({ allowed: false, errorCode: 'authentication_required' });

    expect(
      authorizeCustomerAccess(
        { ...context, kfcSubjectRef: 'customer_2' },
        requirement,
      ),
    ).toMatchObject({ allowed: false, errorCode: 'access_context_mismatch' });
  });

  it('requires a verified channel link and the requested scope', () => {
    const messengerRequirement = {
      ...requirement,
      channel: 'messenger' as const,
    };
    const messengerContext = controlledCustomerAccess({
      sessionId: requirement.sessionId,
      customerId: requirement.customerId,
      channel: 'messenger',
    });

    expect(
      authorizeCustomerAccess(
        { ...messengerContext, channelAccountLinkState: 'unlinked' },
        messengerRequirement,
      ),
    ).toMatchObject({ allowed: false, errorCode: 'subject_binding_required' });

    expect(
      authorizeCustomerAccess(
        { ...messengerContext, authorizedScopes: ['customer:read'] },
        messengerRequirement,
      ),
    ).toMatchObject({ allowed: false, errorCode: 'authorization_required' });
  });
});
