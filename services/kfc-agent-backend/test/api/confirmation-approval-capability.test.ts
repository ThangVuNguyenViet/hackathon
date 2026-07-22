import { describe, expect, it } from 'vitest';
import {
  createConfirmationApprovalKeyRing,
  issueConfirmationApprovalCapability,
  verifyConfirmationApprovalCapability,
} from '../../src/api/confirmationApprovalCapability.js';
import type { CustomerAccessContext } from '../../src/domain/types.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import {
  guestCheckoutCommerceApprovalPrincipal,
  isAuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/commerceApprovalPrincipal.js';
import {
  confirmationPauseIdentityDigest,
  pendingConfirmationPause,
  type ConfirmationPauseStorageSnapshot,
} from '../../src/persistence/confirmationPause.js';
import type {
  CreateConfirmationPauseInput,
  RunCommitFence,
} from '../../src/persistence/contracts.js';
import {
  issueControlledMessengerMockGuestCheckoutAuthority,
} from '../../src/security/guestCheckoutAuthority.js';
import {
  verifiedGuestApprovalAuthorityIsIssued,
} from '../../src/security/verifiedGuestApprovalAuthority.js';

const now = new Date('2026-07-20T00:01:00.000Z');
const activeSecret =
  'confirmation-capability-active-secret-32-bytes';
const previousSecret =
  'confirmation-capability-previous-secret-32-bytes';

describe('confirmation approval capability', () => {
  it('binds a short-lived token to the exact principal, pause, checkpoint, and generation', async () => {
    const snapshot = await canonicalSnapshot();
    if (
      !isAuthenticatedCommerceApprovalPrincipal(
        snapshot.record.principal,
      )
    ) {
      throw new Error('test_authenticated_principal_required');
    }
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: '2026-07-active', secret: activeSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: trustedAccessContext(),
      keyRing,
      now,
    });

    expect(issued.approvalCapability).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(issued.approvalCapability).not.toContain(activeSecret);
    expect(issued.expiresAt).toBe(snapshot.record.expiresAt);
    await expect(verifyConfirmationApprovalCapability({
      approvalCapability: issued.approvalCapability,
      snapshot,
      keyRing,
      now,
    })).resolves.toMatchObject({
      ok: true,
      signingSecret: activeSecret,
      payload: {
        requestId: snapshot.record.requestId,
        sessionId: snapshot.record.sessionId,
        customerId: snapshot.record.customerId,
        channel: snapshot.record.channel,
        authenticatedSubject:
          snapshot.record.principal.authenticatedSubject,
        authenticationEvidenceRef:
          snapshot.record.principal.authenticationEvidenceRef,
        actionDigest: snapshot.record.actionDigest,
        approvalBindingDigest:
          snapshot.record.approvalBindingDigest,
        checkpointThreadId:
          snapshot.record.checkpointThreadId,
        checkpointNamespace:
          snapshot.record.checkpointNamespace,
        checkpointId: snapshot.record.checkpointId,
        sessionGeneration: snapshot.sessionGeneration,
        sessionAuthorityGeneration:
          snapshot.sessionAuthorityGeneration,
        pauseIdentityDigest: snapshot.identityDigest,
        expiresAt: snapshot.record.expiresAt,
      },
    });
  });

  it('supports key rotation while rejecting an unknown key or a tampered token', async () => {
    const snapshot = await canonicalSnapshot();
    const oldKeyRing = createConfirmationApprovalKeyRing({
      active: { keyId: '2026-06', secret: previousSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: trustedAccessContext(),
      keyRing: oldKeyRing,
      now,
    });
    const rotatedKeyRing = createConfirmationApprovalKeyRing({
      active: { keyId: '2026-07', secret: activeSecret },
      previous: [{ keyId: '2026-06', secret: previousSecret }],
    });
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability: issued.approvalCapability,
      snapshot,
      keyRing: rotatedKeyRing,
      now,
    })).toMatchObject({ ok: true, signingSecret: previousSecret });

    const activeOnly = createConfirmationApprovalKeyRing({
      active: { keyId: '2026-07', secret: activeSecret },
    });
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability: issued.approvalCapability,
      snapshot,
      keyRing: activeOnly,
      now,
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });

    const finalCharacter = issued.approvalCapability.endsWith('A')
      ? 'B'
      : 'A';
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability:
        issued.approvalCapability.slice(0, -1) + finalCharacter,
      snapshot,
      keyRing: rotatedKeyRing,
      now,
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });
  });

  it('rejects non-canonical base64url spellings for payloads and signatures', async () => {
    const snapshot = await canonicalSnapshot();
    let issued:
      | Awaited<ReturnType<typeof issueConfirmationApprovalCapability>>
      | undefined;
    let keyRing:
      | ReturnType<typeof createConfirmationApprovalKeyRing>
      | undefined;
    for (const keyId of ['a', 'ab', 'abc', 'abcd']) {
      const candidateKeyRing = createConfirmationApprovalKeyRing({
        active: { keyId, secret: activeSecret },
      });
      const candidate = await issueConfirmationApprovalCapability({
        snapshot,
        accessContext: trustedAccessContext(),
        keyRing: candidateKeyRing,
        now,
      });
      const [payload] = candidate.approvalCapability.split('.');
      if (payload && payload.length % 4 !== 0) {
        issued = candidate;
        keyRing = candidateKeyRing;
        break;
      }
    }
    if (!issued || !keyRing) {
      throw new Error('test capability payload is unexpectedly block-aligned');
    }
    const [payload, signature] = issued.approvalCapability.split('.');
    if (!payload || !signature) {
      throw new Error('test capability is malformed');
    }
    const nonCanonicalSignature =
      nonCanonicalBase64UrlEquivalent(signature);
    const nonCanonicalPayload =
      nonCanonicalBase64UrlEquivalent(payload);
    expect(nonCanonicalSignature).toBeDefined();
    expect(nonCanonicalPayload).toBeDefined();

    expect(await verifyConfirmationApprovalCapability({
      approvalCapability: `${payload}.${nonCanonicalSignature}`,
      snapshot,
      keyRing,
      now,
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });

    const signatureForNonCanonicalPayload = await testHmac(
      nonCanonicalPayload!,
      activeSecret,
    );
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability:
        `${nonCanonicalPayload}.${signatureForNonCanonicalPayload}`,
      snapshot,
      keyRing,
      now,
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });
  });

  it.each([
    [
      'request',
      {},
      { requestId: '00000000-0000-4000-8000-000000000002' },
    ],
    ['generation', { sessionGeneration: 8 }, {}],
    [
      'session authority generation',
      { sessionAuthorityGeneration: 8 },
      {},
    ],
    ['identity', { identityDigest: 'f'.repeat(64) }, {}],
  ])('rejects cross-pause %s replay', async (
    _label,
    snapshotPatch,
    recordPatch,
  ) => {
    const snapshot = await canonicalSnapshot();
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: 'active', secret: activeSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: trustedAccessContext(),
      keyRing,
      now,
    });
    const mismatched = {
      ...snapshot,
      ...snapshotPatch,
      record: {
        ...snapshot.record,
        ...recordPatch,
      },
    } as ConfirmationPauseStorageSnapshot;
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability: issued.approvalCapability,
      snapshot: mismatched,
      keyRing,
      now,
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });
  });

  it('rejects expired capabilities and refuses issuance for a mismatched principal', async () => {
    const snapshot = await canonicalSnapshot();
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: 'active', secret: activeSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: trustedAccessContext(),
      keyRing,
      now,
    });
    expect(await verifyConfirmationApprovalCapability({
      approvalCapability: issued.approvalCapability,
      snapshot,
      keyRing,
      now: new Date(snapshot.record.expiresAt),
    })).toEqual({
      ok: false,
      errorCode: 'approval_capability_expired',
    });
    await expect(issueConfirmationApprovalCapability({
      snapshot,
      accessContext: trustedAccessContext({
        kfcSubjectRef: 'different-customer',
      }),
      keyRing,
      now,
    })).rejects.toThrow(
      'confirmation_approval_capability_authority_invalid',
    );
  });

  it.each([
    ['placeOrder', {}],
    ['createPaymentLink', { methodId: 'payment-method-1' }],
  ] as const)(
    'issues a guest %s capability without authenticated account scope',
    async (toolName, arguments_) => {
      const { snapshot, authority } = await canonicalGuestSnapshot({
        toolName,
        arguments: arguments_,
      });
      const keyRing = createConfirmationApprovalKeyRing({
        active: { keyId: 'guest-active', secret: activeSecret },
      });
      const issued = await issueConfirmationApprovalCapability({
        snapshot,
        accessContext: undefined,
        guestCheckoutAuthority: authority,
        keyRing,
        now,
      });
      const verified = await verifyConfirmationApprovalCapability({
        approvalCapability: issued.approvalCapability,
        snapshot,
        keyRing,
        now,
      });

      expect(verified).toMatchObject({
        ok: true,
        payload: {
          principalKind: 'guest_checkout',
          sessionId: snapshot.record.sessionId,
          toolName,
          actionDigest: snapshot.record.actionDigest,
          approvalBindingDigest:
            snapshot.record.approvalBindingDigest,
          checkpointThreadId:
            snapshot.record.checkpointThreadId,
          checkpointId: snapshot.record.checkpointId,
          sessionGeneration: snapshot.sessionGeneration,
          pauseIdentityDigest: snapshot.identityDigest,
          guestAuthorityDigest: authority.authorityDigest,
          sourceRunFenceDigest:
            authority.sourceRunFenceDigest,
        },
        guestAuthority: {
          sessionId: snapshot.record.sessionId,
          sessionGeneration: snapshot.sessionGeneration,
        },
      });
      expect(JSON.stringify(verified)).not.toContain(
        'authenticatedSubject',
      );
      expect(JSON.stringify(verified)).not.toContain(
        'authenticationEvidenceRef',
      );
    },
  );

  it('rejects guest capability replay across session, run, turn, tool, action, and generation bindings', async () => {
    const original = await canonicalGuestSnapshot({
      toolName: 'placeOrder',
      arguments: {},
    });
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: 'guest-active', secret: activeSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot: original.snapshot,
      accessContext: undefined,
      guestCheckoutAuthority: original.authority,
      keyRing,
      now,
    });
    const mismatches = await Promise.all([
      canonicalGuestSnapshot({
        toolName: 'placeOrder',
        arguments: {},
        sessionId: 'messenger_mock:guest-cross-session',
      }),
      canonicalGuestSnapshot({
        toolName: 'placeOrder',
        arguments: {},
        runId: 'guest-cross-run',
      }),
      canonicalGuestSnapshot({
        toolName: 'placeOrder',
        arguments: {},
        externalMessageId: 'guest-cross-turn',
      }),
      canonicalGuestSnapshot({
        toolName: 'createPaymentLink',
        arguments: { methodId: 'payment-method-1' },
      }),
      canonicalGuestSnapshot({
        toolName: 'createPaymentLink',
        arguments: { methodId: 'payment-method-2' },
      }),
      canonicalGuestSnapshot({
        toolName: 'placeOrder',
        arguments: {},
        sessionAuthorityGeneration: 8,
      }),
    ]);
    for (const mismatch of mismatches) {
      await expect(verifyConfirmationApprovalCapability({
        approvalCapability: issued.approvalCapability,
        snapshot: mismatch.snapshot,
        keyRing,
        now,
      })).resolves.toEqual({
        ok: false,
        errorCode: 'approval_capability_invalid',
      });
    }

    const replacement = issued.approvalCapability.endsWith('A')
      ? 'B'
      : 'A';
    await expect(verifyConfirmationApprovalCapability({
      approvalCapability:
        issued.approvalCapability.slice(0, -1) + replacement,
      snapshot: original.snapshot,
      keyRing,
      now,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'approval_capability_invalid',
    });
  });

  it('mints a separately bound payment-link capability only for the verified guest checkpoint lineage', async () => {
    const original = await canonicalGuestSnapshot({
      toolName: 'placeOrder',
      arguments: {},
    });
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: 'guest-chain', secret: activeSecret },
    });
    const first = await issueConfirmationApprovalCapability({
      snapshot: original.snapshot,
      accessContext: undefined,
      guestCheckoutAuthority: original.authority,
      keyRing,
      now,
    });
    const verifiedFirst =
      await verifyConfirmationApprovalCapability({
        approvalCapability: first.approvalCapability,
        snapshot: original.snapshot,
        keyRing,
        now,
      });
    if (!verifiedFirst.ok || !verifiedFirst.guestAuthority) {
      throw new Error('test_guest_capability_verification_failed');
    }
    expect(
      verifiedGuestApprovalAuthorityIsIssued(
        verifiedFirst.guestAuthority,
      ),
    ).toBe(true);
    expect(
      verifiedGuestApprovalAuthorityIsIssued(
        structuredClone(verifiedFirst.guestAuthority),
      ),
    ).toBe(false);
    const payment =
      await continuationGuestSnapshot(original.snapshot, {
        checkpointId: 'checkpoint-createPaymentLink',
        checkpointThreadId:
          original.snapshot.record.checkpointThreadId,
      });
    await expect(issueConfirmationApprovalCapability({
      snapshot: payment,
      accessContext: undefined,
      verifiedGuestAuthority: verifiedFirst.guestAuthority,
      keyRing,
      now,
    })).rejects.toThrow(
      'confirmation_approval_capability_authority_invalid',
    );
    const second = await issueConfirmationApprovalCapability({
      snapshot: payment,
      accessContext: undefined,
      verifiedGuestContinuationAuthority:
        verifiedFirst.guestAuthority,
      keyRing,
      now,
    });
    await expect(verifyConfirmationApprovalCapability({
      approvalCapability: second.approvalCapability,
      snapshot: payment,
      keyRing,
      now,
    })).resolves.toMatchObject({
      ok: true,
      payload: {
        principalKind: 'guest_checkout',
        toolName: 'createPaymentLink',
        actionDigest: payment.record.actionDigest,
        checkpointId: 'checkpoint-createPaymentLink',
      },
    });

    const crossedThread =
      await continuationGuestSnapshot(original.snapshot, {
        checkpointId: 'checkpoint-crossed',
        checkpointThreadId:
          'agent:["messenger_mock:guest-capability","run:crossed"]',
      });
    await expect(issueConfirmationApprovalCapability({
      snapshot: crossedThread,
      accessContext: undefined,
      verifiedGuestContinuationAuthority:
        verifiedFirst.guestAuthority,
      keyRing,
      now,
    })).rejects.toThrow(
      'confirmation_approval_capability_authority_invalid',
    );

    const sameCheckpoint =
      await continuationGuestSnapshot(original.snapshot, {
        checkpointId: original.snapshot.record.checkpointId,
        checkpointThreadId:
          original.snapshot.record.checkpointThreadId,
      });
    await expect(issueConfirmationApprovalCapability({
      snapshot: sameCheckpoint,
      accessContext: undefined,
      verifiedGuestContinuationAuthority:
        verifiedFirst.guestAuthority,
      keyRing,
      now,
    })).resolves.toMatchObject({
      approvalCapability: expect.any(String),
    });
    const repeatedOrder =
      await continuationGuestSnapshot(original.snapshot, {
        checkpointId: 'checkpoint-repeated-order',
        checkpointThreadId:
          original.snapshot.record.checkpointThreadId,
        toolName: 'placeOrder',
      });
    const changedAuthorityGeneration = {
      ...payment,
      sessionAuthorityGeneration:
        payment.sessionAuthorityGeneration + 1,
    };
    const changedPrincipalSource =
      await canonicalGuestSnapshot({
        toolName: 'placeOrder',
        arguments: {},
        externalMessageId: 'different-guest-turn',
      });
    const changedPrincipal =
      await continuationGuestSnapshot(
        changedPrincipalSource.snapshot,
        {
          checkpointId: 'checkpoint-changed-principal',
          checkpointThreadId:
            original.snapshot.record.checkpointThreadId,
        },
      );
    for (const invalid of [
      repeatedOrder,
      changedAuthorityGeneration,
      changedPrincipal,
    ]) {
      await expect(issueConfirmationApprovalCapability({
        snapshot: invalid,
        accessContext: undefined,
        verifiedGuestContinuationAuthority:
          verifiedFirst.guestAuthority,
        keyRing,
        now,
      })).rejects.toThrow(
        'confirmation_approval_capability_authority_invalid',
      );
    }

    const paymentSource = await canonicalGuestSnapshot({
      toolName: 'createPaymentLink',
      arguments: { methodId: 'payment-method-1' },
    });
    const paymentSourceToken =
      await issueConfirmationApprovalCapability({
        snapshot: paymentSource.snapshot,
        accessContext: undefined,
        guestCheckoutAuthority: paymentSource.authority,
        keyRing,
        now,
      });
    const verifiedPaymentSource =
      await verifyConfirmationApprovalCapability({
        approvalCapability:
          paymentSourceToken.approvalCapability,
        snapshot: paymentSource.snapshot,
        keyRing,
        now,
      });
    if (
      !verifiedPaymentSource.ok ||
      !verifiedPaymentSource.guestAuthority
    ) {
      throw new Error('test_guest_payment_capability_missing');
    }
    const repeatedPayment =
      await continuationGuestSnapshot(
        paymentSource.snapshot,
        {
          checkpointId: 'checkpoint-repeated-payment',
          checkpointThreadId:
            paymentSource.snapshot.record.checkpointThreadId,
        },
      );
    await expect(issueConfirmationApprovalCapability({
      snapshot: repeatedPayment,
      accessContext: undefined,
      verifiedGuestContinuationAuthority:
        verifiedPaymentSource.guestAuthority,
      keyRing,
      now,
    })).rejects.toThrow(
      'confirmation_approval_capability_authority_invalid',
    );
  });
});

async function canonicalSnapshot(): Promise<ConfirmationPauseStorageSnapshot> {
  const principal: AuthenticatedCommerceApprovalPrincipal = {
    principalKind: 'authenticated_customer',
    sessionId: 'kfc:customer-1',
    customerId: 'customer-1',
    channel: 'kfc',
    authenticatedSubject: 'customer-1',
    authenticationEvidenceRef: 'access-token:jti-1',
  };
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
  });
  const input: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: '00000000-0000-4000-8000-000000000001',
    checkpointThreadId:
      'agent:["kfc:customer-1","run:confirmation:message-1"]',
    checkpointNamespace: '',
    checkpointId: 'checkpoint-paused-1',
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-20T00:10:00.000Z',
  };
  const record = pendingConfirmationPause(input);
  return {
    record,
    sessionGeneration: 7,
    sessionAuthorityGeneration: 7,
    identityDigest: await confirmationPauseIdentityDigest(record),
  };
}

async function canonicalGuestSnapshot(input: {
  toolName: 'placeOrder' | 'createPaymentLink';
  arguments: Record<string, unknown>;
  sessionId?: string;
  runId?: string;
  externalMessageId?: string;
  sessionAuthorityGeneration?: number;
}) {
  const sessionId =
    input.sessionId ?? 'messenger_mock:guest-capability';
  const customerId = 'guest-capability';
  const sessionAuthorityGeneration =
    input.sessionAuthorityGeneration ?? 7;
  const runFence: RunCommitFence = {
    kind: 'agent_run',
    runId: input.runId ?? 'guest-capability-run',
    generation: 3,
    sessionAuthorityGeneration,
    executionAttempt: 1,
    executionLeaseToken:
      '32bc3347-8080-4f5f-a653-3de7d0b9bade',
  };
  const authority =
    await issueControlledMessengerMockGuestCheckoutAuthority({
      sessionId,
      customerId,
      externalMessageId:
        input.externalMessageId ?? 'guest-capability-turn',
      runFence,
      issuedAt: new Date('2026-07-20T00:00:00.000Z'),
      ttlMs: 10 * 60_000,
    });
  const principal =
    guestCheckoutCommerceApprovalPrincipal(authority);
  const action = {
    toolName: input.toolName,
    arguments: input.arguments,
  };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: input.toolName,
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
    guestCheckout: {
      guestAuthorityDigest: authority.authorityDigest,
      orderPreviewRevision: await digestCommerceAction(null),
      invoiceRevision: await digestCommerceAction(null),
    },
  });
  const record = pendingConfirmationPause({
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: crypto.randomUUID(),
    checkpointThreadId:
      `agent:[${JSON.stringify(sessionId)},"run:guest:capability"]`,
    checkpointNamespace: '',
    checkpointId: `checkpoint-${input.toolName}`,
    sessionId,
    customerId,
    channel: 'messenger_mock',
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-20T00:10:00.000Z',
  });
  return {
    authority,
    snapshot: {
      record,
      sessionGeneration: sessionAuthorityGeneration,
      sessionAuthorityGeneration,
      identityDigest:
        await confirmationPauseIdentityDigest(record),
    },
  };
}

async function continuationGuestSnapshot(
  source: ConfirmationPauseStorageSnapshot,
  input: {
    checkpointId: string;
    checkpointThreadId: string;
    toolName?: 'placeOrder' | 'createPaymentLink';
  },
): Promise<ConfirmationPauseStorageSnapshot> {
  const action = input.toolName === 'placeOrder'
    ? { toolName: input.toolName, arguments: {} }
    : {
        toolName: 'createPaymentLink' as const,
        arguments: { methodId: 'payment-method-1' },
      };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal: source.record.principal,
    action,
    revisions: source.record.approvalBinding.revisions,
    guestCheckout: source.record.approvalBinding.guestCheckout,
  });
  const record = pendingConfirmationPause({
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: crypto.randomUUID(),
    checkpointThreadId: input.checkpointThreadId,
    checkpointNamespace: source.record.checkpointNamespace,
    checkpointId: input.checkpointId,
    sessionId: source.record.sessionId,
    customerId: source.record.customerId,
    channel: source.record.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal: source.record.principal,
    createdAt: source.record.createdAt,
    expiresAt: source.record.expiresAt,
  });
  return {
    record,
    sessionGeneration: source.sessionGeneration,
    sessionAuthorityGeneration: source.sessionAuthorityGeneration,
    identityDigest: await confirmationPauseIdentityDigest(record),
  };
}

function trustedAccessContext(
  overrides: Partial<CustomerAccessContext> = {},
): CustomerAccessContext {
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface: 'kfc-app-chat',
    sessionRef: 'kfc:customer-1',
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: 'customer-1',
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'kfc-access-token',
      issuer: 'kfc-vietnam',
      audience: 'kfc-app-chat',
      authenticatedAt: '2026-07-20T00:00:00.000Z',
      expiresAt: '2026-07-21T00:00:00.000Z',
      evidenceRef: 'access-token:jti-1',
    },
    authorizedScopes: ['order:write'],
    ...overrides,
  };
}

const base64UrlAlphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function nonCanonicalBase64UrlEquivalent(
  value: string,
): string | undefined {
  const remainder = value.length % 4;
  const unusedBitMask =
    remainder === 2
      ? 0b001111
      : remainder === 3
        ? 0b000011
        : 0;
  if (unusedBitMask === 0) return undefined;
  const last = base64UrlAlphabet.indexOf(value.at(-1) ?? '');
  if (last < 0) return undefined;
  const alternative = (last & ~unusedBitMask) | 1;
  return `${value.slice(0, -1)}${base64UrlAlphabet[alternative]}`;
}

async function testHmac(
  encodedPayload: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  ));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}
