import { describe, expect, it } from 'vitest';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import { authenticatedCommerceApprovalPrincipal } from '../../src/ordering/commerceApprovalPrincipal.js';
import {
  confirmationPauseIdentityDigest,
  parseCreateConfirmationPauseInput,
} from '../../src/persistence/confirmationPause.js';
import type { CreateConfirmationPauseInput } from '../../src/persistence/contracts.js';

async function canonicalPause(): Promise<CreateConfirmationPauseInput> {
  const action = {
    toolName: 'createPaymentLink' as const,
    arguments: { methodId: 'payment-method-1' },
  };
  const principal = authenticatedCommerceApprovalPrincipal({
    channel: 'kfc' as const,
    sessionId: 'kfc:confirmation_customer',
    customerId: 'confirmation_customer',
    authenticatedSubject: 'confirmation_customer',
    authenticationEvidenceRef: 'auth-evidence-1',
  });
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: 'createPaymentLink',
    principal,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
    action,
  });
  return {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: crypto.randomUUID(),
    sourceTurnId: 'turn-confirmation-1',
    actionScope: '',
    actionId: 'tool-call-create-payment-link-1',
    sessionId: 'kfc:confirmation_customer',
    customerId: 'confirmation_customer',
    channel: 'kfc',
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-08-12T00:00:00.000Z',
    expiresAt: '2026-08-12T00:15:00.000Z',
  };
}

describe('KFC application confirmation identity', () => {
  it('binds a pending action to the exact application turn without checkpoint state', async () => {
    const pause = await canonicalPause();

    const parsed = await parseCreateConfirmationPauseInput(pause);
    const digest = await confirmationPauseIdentityDigest(parsed);

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed).toMatchObject({
      sourceTurnId: 'turn-confirmation-1',
      actionId: 'tool-call-create-payment-link-1',
    });
    expect(JSON.stringify(parsed)).not.toMatch(/checkpoint/iu);
  });

  it('rejects changed canonical arguments with the stale action digest', async () => {
    const pause = await canonicalPause();
    await expect(
      parseCreateConfirmationPauseInput({
        ...pause,
        action: {
          ...pause.action,
          arguments: { methodId: 'payment-method-2' },
        },
      }),
    ).rejects.toThrow('confirmation_pause_action_digest_mismatch');
  });

  it('rejects a principal copied across sessions', async () => {
    const pause = await canonicalPause();
    await expect(
      parseCreateConfirmationPauseInput({
        ...pause,
        sessionId: 'kfc:other_customer',
        customerId: 'other_customer',
      }),
    ).rejects.toThrow('principal');
  });

  it('changes identity for a different source turn or action id', async () => {
    const pause = await parseCreateConfirmationPauseInput(
      await canonicalPause(),
    );
    const digest = await confirmationPauseIdentityDigest(pause);
    const changedTurn = await confirmationPauseIdentityDigest({
      ...pause,
      sourceTurnId: 'turn-confirmation-2',
    });
    const changedAction = await confirmationPauseIdentityDigest({
      ...pause,
      actionId: 'tool-call-create-payment-link-2',
    });
    expect(changedTurn).not.toBe(digest);
    expect(changedAction).not.toBe(digest);
  });
});
