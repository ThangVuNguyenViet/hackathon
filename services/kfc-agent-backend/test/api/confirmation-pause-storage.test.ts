import { describe, expect, it, vi } from 'vitest';
import type { CustomerAccessContext } from '../../src/domain/types.js';
import type { AgentTurnOutput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import {
  isAuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/commerceApprovalPrincipal.js';
import {
  confirmationPauseForPublicResponse,
  confirmationPausePointerForDurableEvent,
  persistCanonicalConfirmationPause,
  type ConfirmationCheckpointReader,
} from '../../src/api/confirmationPausePersistence.js';
import {
  createConfirmationApprovalKeyRing,
} from '../../src/api/confirmationApprovalCapability.js';
import type { CreateConfirmationPauseInput } from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('canonical confirmation pause persistence', () => {
  it('projects only a signed public capability from an authenticated pause', async () => {
    const record = await canonicalRecord();
    if (!isAuthenticatedCommerceApprovalPrincipal(record.principal)) {
      throw new Error('test_authenticated_principal_required');
    }
    const store = new MemoryStore();
    await store.createConfirmationPause(record);
    const pointer = await confirmationPausePointerForDurableEvent({
      pause: pauseWithRecord(record),
      store,
    });
    const projected = await confirmationPauseForPublicResponse({
      pause: pointer,
      store,
      accessContext: trustedAccessContext(),
      keyRing: createConfirmationApprovalKeyRing({
        active: {
          keyId: 'test-active',
          secret: 'confirmation-pause-public-test-secret-32-bytes',
        },
      }),
      now: new Date('2026-07-20T00:01:00.000Z'),
    });

    expect(projected).toMatchObject({
      capability: 'placeOrder',
      requestId: record.requestId,
    });
    expect(Date.parse(projected.expiresAt)).toBeLessThanOrEqual(
      Date.parse(record.expiresAt),
    );
    expect(projected.approvalCapability).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(JSON.stringify(projected)).not.toContain(
      record.principal.authenticationEvidenceRef,
    );
    expect(JSON.stringify(projected)).not.toContain(record.checkpointId);

    await expect(
      confirmationPauseForPublicResponse({
        pause: {
          ...pointer,
          expiresAt: '2026-07-20T00:09:59.000Z',
        },
        store,
        accessContext: trustedAccessContext(),
        keyRing: createConfirmationApprovalKeyRing({
          active: {
            keyId: 'test-active',
            secret:
              'confirmation-pause-public-test-secret-32-bytes',
          },
        }),
        now: new Date('2026-07-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow(
      'confirmation_pause_public_authority_missing',
    );
  });

  it('rejects the legacy pause shape without creating authorization state', async () => {
    const store = new MemoryStore();
    const create = vi.spyOn(store, 'createConfirmationPause');

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
        channel: 'kfc',
        pause: {
          capability: 'placeOrder',
          requestId: '00000000-0000-4000-8000-000000000001',
          action: { toolName: 'placeOrder', arguments: {} },
        },
        accessContext: trustedAccessContext(),
        checkpointer: exactCheckpointReader(),
        now: new Date('2026-07-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('confirmation_pause_canonical_record_missing');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a caller-shaped enumerable confirmation record', async () => {
    const store = new MemoryStore();
    const record = await canonicalRecord();
    const create = vi.spyOn(store, 'createConfirmationPause');
    const pause = {
      capability: record.action.toolName,
      requestId: record.requestId,
      action: record.action,
      confirmationRecord: record,
    } as NonNullable<AgentTurnOutput['pause']>;

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId: record.sessionId,
        customerId: record.customerId,
        channel: record.channel,
        pause,
        accessContext: trustedAccessContext(),
        checkpointer: exactCheckpointReader(),
      }),
    ).rejects.toThrow('confirmation_pause_canonical_record_missing');
    expect(create).not.toHaveBeenCalled();
  });

  it('persists the exact canonical record before writing its audit event', async () => {
    const store = new MemoryStore();
    const record = await canonicalRecord();
    const create = vi.spyOn(store, 'createConfirmationPause');
    const audit = vi.spyOn(store, 'appendEvent');

    await persistCanonicalConfirmationPause({
      store,
      sessionId: record.sessionId,
      customerId: record.customerId,
      channel: record.channel,
      pause: pauseWithRecord(record),
      accessContext: trustedAccessContext(),
      checkpointer: exactCheckpointReader(),
      now: new Date('2026-07-20T00:01:00.000Z'),
    });

    await expect(store.getConfirmationPause(record.requestId)).resolves
      .toMatchObject(record);
    expect(create).toHaveBeenCalledWith(record);
    expect(audit).toHaveBeenCalledWith(
      record.sessionId,
      'confirmation_pause_created',
      expect.objectContaining({
        requestId: record.requestId,
        actionDigest: record.actionDigest,
        approvalBindingDigest: record.approvalBindingDigest,
        status: 'pending',
      }),
    );
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      audit.mock.invocationCallOrder[0]!,
    );
  });

  it('atomically commits guarded pause state without legacy partial writes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T00:01:00.000Z');
    try {
      const store = new MemoryStore();
      const record = await canonicalRecord();
      const runId = 'confirmation-pause-atomic-run';
      await seedPauseCustomerRun(store, record, runId);
      const create = vi.spyOn(store, 'createConfirmationPause');
      const append = vi.spyOn(store, 'appendEvent');

      await persistCanonicalConfirmationPause({
        store,
        sessionId: record.sessionId,
        customerId: record.customerId,
        channel: record.channel,
        pause: pauseWithRecord(record),
        accessContext: trustedAccessContext(),
        checkpointer: exactCheckpointReader(),
        runCommit: {
          fence: {
            kind: 'customer_run',
            runId,
            sessionAuthorityGeneration: 0,
          },
          state: pauseState(record),
        },
        now: new Date(),
      });

      expect(create).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled();
      await expect(store.getConfirmationPause(record.requestId)).resolves
        .toMatchObject(record);
      const events = await store.listEvents(record.sessionId);
      expect(events.map(({ sourceType }) => sourceType)).toEqual([
        'graph:verified_state',
        'confirmation_pause_created',
      ]);
      expect(events[1]?.payload).not.toHaveProperty('action');
      expect(events[1]?.payload).not.toHaveProperty('principal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no pause or state event when guarded ownership is stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T00:01:00.000Z');
    try {
      const store = new MemoryStore();
      const record = await canonicalRecord();
      const runId = 'confirmation-pause-stale-run';
      await seedPauseCustomerRun(store, record, runId);
      await store.updateCustomerRun(runId, {
        status: 'superseded',
        terminalAt: '2026-07-20T00:00:30.000Z',
      });

      await expect(
        persistCanonicalConfirmationPause({
          store,
          sessionId: record.sessionId,
          customerId: record.customerId,
          channel: record.channel,
          pause: pauseWithRecord(record),
          accessContext: trustedAccessContext(),
          checkpointer: exactCheckpointReader(),
          runCommit: {
            fence: {
              kind: 'customer_run',
              runId,
              sessionAuthorityGeneration: 0,
            },
            state: pauseState(record),
          },
          now: new Date(),
        }),
      ).rejects.toThrow('customer_run_cancelled');
      await expect(store.getConfirmationPause(record.requestId)).resolves
        .toBeUndefined();
      expect(await store.listEvents(record.sessionId)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists a trusted non-KFC channel without rewriting its identity', async () => {
    const store = new MemoryStore();
    const base = await canonicalRecord();
    const principal = {
      ...base.principal,
      channel: 'messenger_mock' as const,
    };
    const approvalBinding = await buildCommerceApprovalBinding({
      capability: base.approvalBinding.capability,
      principal,
      action: base.action,
      revisions: base.approvalBinding.revisions,
    });
    const record: CreateConfirmationPauseInput = {
      ...base,
      channel: principal.channel,
      principal,
      approvalBinding,
      approvalBindingDigest: await digestCommerceAction(approvalBinding),
    };

    await persistCanonicalConfirmationPause({
      store,
      sessionId: record.sessionId,
      customerId: record.customerId,
      channel: record.channel,
      pause: pauseWithRecord(record),
      accessContext: trustedAccessContext({
        customerSurface: 'messenger',
        surfaceSubjectRef: 'messenger-user-1',
        channelAccountLinkState: 'linked',
      }),
      checkpointer: exactCheckpointReader(),
      now: new Date('2026-07-20T00:01:00.000Z'),
    });

    await expect(store.getConfirmationPause(record.requestId)).resolves
      .toMatchObject({ channel: 'messenger_mock' });
  });

  it('keeps a fresh request identity on the immutable customer-turn thread', async () => {
    const store = new MemoryStore();
    const base = await canonicalRecord();
    const record: CreateConfirmationPauseInput = {
      ...base,
      requestId: '00000000-0000-4000-8000-000000000099',
    };

    await persistCanonicalConfirmationPause({
      store,
      sessionId: record.sessionId,
      customerId: record.customerId,
      channel: record.channel,
      pause: pauseWithRecord(record),
      accessContext: trustedAccessContext(),
      checkpointer: exactCheckpointReader(),
      now: new Date('2026-07-20T00:01:00.000Z'),
    });

    await expect(store.getConfirmationPause(record.requestId)).resolves
      .toMatchObject({
        requestId: record.requestId,
        checkpointThreadId: base.checkpointThreadId,
        checkpointId: base.checkpointId,
      });
  });

  it('rejects a coherently rehashed false membership pause before persistence', async () => {
    const store = new MemoryStore();
    const base = await canonicalRecord();
    const action = {
      toolName: 'acquireVoucher' as const,
      arguments: {
        rewardId: 'reward-discount-10k',
        confirmed: false,
      },
    };
    const approvalBinding = await buildCommerceApprovalBinding({
      capability: action.toolName,
      principal: base.principal,
      action: {
        toolName: action.toolName,
        rewardId: action.arguments.rewardId,
        confirmed: action.arguments.confirmed,
      },
      revisions: base.approvalBinding.revisions,
    });
    const record: CreateConfirmationPauseInput = {
      ...base,
      action,
      actionDigest: await digestCommerceAction(action),
      approvalBinding,
      approvalBindingDigest:
        await digestCommerceAction(approvalBinding),
    };
    const create = vi.spyOn(store, 'createConfirmationPause');

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId: record.sessionId,
        customerId: record.customerId,
        channel: record.channel,
        pause: pauseWithRecord(record),
        accessContext: trustedAccessContext(),
        checkpointer: exactCheckpointReader(),
        now: new Date('2026-07-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('confirmation_pause_canonical_record_mismatch');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['session identity', { sessionId: 'kfc:other' }],
    ['checkpoint identity', { checkpointThreadId: 'agent:forged' }],
    ['checkpoint namespace', { checkpointNamespace: 'forged' }],
    ['exact checkpoint identity', { checkpointId: 'checkpoint-forged' }],
    ['stale expiry', { expiresAt: '2026-07-20T00:00:30.000Z' }],
    ['unbounded expiry', { expiresAt: '2026-07-20T01:00:00.000Z' }],
  ])('fails closed for mismatched %s', async (_label, patch) => {
    const store = new MemoryStore();
    const record = { ...(await canonicalRecord()), ...patch };
    const create = vi.spyOn(store, 'createConfirmationPause');

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
        channel: 'kfc',
        pause: pauseWithRecord(record),
        accessContext: trustedAccessContext(),
        checkpointer: exactCheckpointReader(),
        now: new Date('2026-07-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing access', undefined],
    [
      'forged subject',
      trustedAccessContext({ kfcSubjectRef: 'customer-2' }),
    ],
    [
      'forged evidence',
      trustedAccessContext({
        authenticationEvidence: {
          ...verifiedEvidence(),
          evidenceRef: 'access-token:forged',
        },
      }),
    ],
  ])('fails closed for %s', async (_label, accessContext) => {
    const store = new MemoryStore();
    const record = await canonicalRecord();
    const create = vi.spyOn(store, 'createConfirmationPause');

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId: record.sessionId,
        customerId: record.customerId,
        channel: record.channel,
        pause: pauseWithRecord(record),
        accessContext,
        checkpointer: exactCheckpointReader(),
        now: new Date('2026-07-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('confirmation_pause_canonical_record_mismatch');
    expect(create).not.toHaveBeenCalled();
  });
});

function pauseWithRecord(
  confirmationRecord: CreateConfirmationPauseInput,
): NonNullable<AgentTurnOutput['pause']> {
  const pause: NonNullable<AgentTurnOutput['pause']> = {
    capability: confirmationRecord.action.toolName,
    requestId: confirmationRecord.requestId,
    action: confirmationRecord.action,
  };
  Object.defineProperty(pause, 'confirmationRecord', {
    configurable: false,
    enumerable: false,
    value: confirmationRecord,
    writable: false,
  });
  return pause;
}

function pauseState(
  record: CreateConfirmationPauseInput,
): AgentGraphState {
  return {
    sessionId: record.sessionId,
    customerId: record.customerId,
    channel: record.channel,
    latestUserMessage: 'Please place the verified order.',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

async function seedPauseCustomerRun(
  store: MemoryStore,
  record: CreateConfirmationPauseInput,
  runId: string,
): Promise<void> {
  await store.createCustomerRun({
    id: runId,
    schemaVersion: 1,
    sessionId: record.sessionId,
    customerId: record.customerId,
    clientMessageId: `${runId}-message`,
    requestFingerprint: `${runId}-fingerprint`,
    generation: 1,
    status: 'running',
    phase: 'planning',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
}

async function canonicalRecord(): Promise<CreateConfirmationPauseInput> {
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
  return {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: '00000000-0000-4000-8000-000000000001',
    checkpointThreadId:
      'agent:["kfc:customer-1","run:confirmation:00000000-0000-4000-8000-000000000001"]',
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
}

function verifiedEvidence(): Extract<
  CustomerAccessContext['authenticationEvidence'],
  { state: 'verified' }
> {
  return {
    state: 'verified',
    method: 'kfc-access-token',
    issuer: 'kfc-vietnam',
    audience: 'kfc-app-chat',
    authenticatedAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-21T00:00:00.000Z',
    evidenceRef: 'access-token:jti-1',
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
    authenticationEvidence: verifiedEvidence(),
    authorizedScopes: ['order:write'],
    ...overrides,
  };
}

function exactCheckpointReader(): ConfirmationCheckpointReader {
  return {
    async getTuple(config) {
      const configurable = config.configurable;
      if (
        configurable?.thread_id !==
          'agent:["kfc:customer-1","run:confirmation:00000000-0000-4000-8000-000000000001"]' ||
        configurable.checkpoint_ns !== '' ||
        configurable.checkpoint_id !== 'checkpoint-paused-1'
      ) {
        return undefined;
      }
      return {
        config: {
          ...config,
          configurable: {
            ...configurable,
            checkpoint_id: 'checkpoint-paused-1',
          },
        },
        checkpoint: { id: 'checkpoint-paused-1' },
      };
    },
  };
}
