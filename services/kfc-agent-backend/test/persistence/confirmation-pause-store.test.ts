import { describe, expect, it } from 'vitest';
import {
  buildCommerceApprovalBinding,
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
  CommerceApprovalReceipt,
  GuestCheckoutCommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import {
  isAuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/commerceApprovalPrincipal.js';
import type {
  ConfirmationPauseRecord,
  ConversationStore,
  CreateConfirmationPauseInput,
  ReserveConfirmationResumeOperationInput,
} from '../../src/persistence/contracts.js';
import {
  confirmationPauseIdentityDigest,
  confirmationResumeOperationBindingFingerprint,
  confirmationResumeProviderIdempotencyKey,
} from '../../src/persistence/confirmationPause.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const signingSecret = 'confirmation-pause-test-secret-32-bytes-minimum';
const createdAt = '2026-07-20T00:00:00.000Z';
const expiresAt = '2026-07-20T00:10:00.000Z';
const rejectedAt = '2026-07-20T00:05:00.000Z';

interface StoreHarness {
  name: string;
  create(): Promise<{
    store: ConversationStore;
    corrupt(requestId: string): void;
  }>;
}

const harnesses: StoreHarness[] = [
  {
    name: 'MemoryStore',
    async create() {
      const store = new MemoryStore();
      return {
        store,
        corrupt(requestId) {
          const records = (
            store as unknown as {
              confirmationPauses: Map<string, unknown>;
            }
          ).confirmationPauses;
          const record = records.get(requestId) as ConfirmationPauseRecord;
          records.set(requestId, {
            ...record,
            authenticatedSubject: 'forged-subject',
          });
        },
      };
    },
  },
  {
    name: 'D1Store',
    async create() {
      const db = new FakeD1Database();
      const store = new D1Store(db);
      await store.initialize();
      return {
        store,
        corrupt(requestId) {
          const row = db.tables.confirmation_pauses.find(
            (candidate) => candidate.request_id === requestId,
          );
          if (!row) throw new Error('test_confirmation_pause_missing');
          row.authenticated_subject = 'forged-subject';
        },
      };
    },
  },
  {
    name: 'PostgresStore',
    async create() {
      const db = new FakeConfirmationPausePostgres();
      return {
        store: new PostgresStore(db as never),
        corrupt(requestId) {
          const row = db.rows.get(requestId);
          if (!row) throw new Error('test_confirmation_pause_missing');
          row.authenticated_subject = 'forged-subject';
        },
      };
    },
  },
];

for (const harness of harnesses) {
  describe(harness.name, () => {
    it('creates once, replays exact input, and rejects request-id collision', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      if (!isAuthenticatedCommerceApprovalPrincipal(input.principal)) {
        throw new Error('test_authenticated_principal_required');
      }

      await expect(store.createConfirmationPause(input)).resolves.toMatchObject({
        status: 'created',
        record: { requestId: input.requestId, status: 'pending' },
      });
      await expect(store.createConfirmationPause(input)).resolves.toMatchObject({
        status: 'replay',
      });
      await expect(
        store.createConfirmationPause({
          ...input,
          actionScope: 'forged-namespace',
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(
        store.createConfirmationPause({
          ...input,
          actionId: 'checkpoint-advanced',
        }),
      ).resolves.toEqual({ status: 'conflict' });
      const otherSession = await pauseInput(
        { requestId: input.requestId },
        {
          sessionId: 'kfc:customer-2',
          customerId: 'customer-2',
          authenticatedSubject: 'customer:customer-2',
          authenticationEvidenceRef: 'access-token:jti-2',
        },
      );
      await expect(store.createConfirmationPause(otherSession)).resolves
        .toEqual({ status: 'conflict' });
    });

    it('rejects non-canonical timestamps before writing a row', async () => {
      const { store } = await harness.create();
      const input = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000020',
        createdAt: '2026-07-20T00:00:00Z',
      });

      await expect(store.createConfirmationPause(input)).rejects.toThrow(
        'Timestamp must use canonical UTC millisecond precision',
      );
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toBeUndefined();
    });

    it('atomically claims one exact rejection and only replays that receipt', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      if (!isAuthenticatedCommerceApprovalPrincipal(input.principal)) {
        throw new Error('test_authenticated_principal_required');
      }
      await store.createConfirmationPause(input);
      const first = await rejectionReceipt(input, {
        receiptId: '00000000-0000-4000-8000-000000000002',
      });
      const competing = await rejectionReceipt(input, {
        receiptId: '00000000-0000-4000-8000-000000000003',
      });
      const claim = (receipt: CommerceApprovalReceipt) =>
        store.claimConfirmationRejection({
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          approvalBindingDigest: input.approvalBindingDigest,
          principal: input.principal,
          receipt,
          rejectedAt,
        });

      const concurrent = await Promise.all([claim(first), claim(competing)]);
      expect(concurrent.map((result) => result.status).sort()).toEqual([
        'claimed',
        'conflict',
      ]);
      const winner = concurrent[0]?.status === 'claimed' ? first : competing;
      const loser = winner === first ? competing : first;
      await expect(claim(winner)).resolves.toMatchObject({ status: 'replay' });
      await expect(claim(loser)).resolves.toEqual({ status: 'conflict' });
    });

    it('fails closed for a different principal and for an expired pause', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      if (!isAuthenticatedCommerceApprovalPrincipal(input.principal)) {
        throw new Error('test_authenticated_principal_required');
      }
      await store.createConfirmationPause(input);
      const receipt = await rejectionReceipt(input);
      await expect(
        store.claimConfirmationRejection({
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          approvalBindingDigest: input.approvalBindingDigest,
          principal: {
            ...input.principal,
            authenticatedSubject: 'customer:other',
          },
          receipt,
          rejectedAt,
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(
        store.claimConfirmationRejection({
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          approvalBindingDigest: input.approvalBindingDigest,
          principal: {
            ...input.principal,
            authenticatedSubject: 'customer:other',
          },
          receipt,
          rejectedAt: '2026-07-20T00:11:00.000Z',
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({ status: 'pending' });

      const expired = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000004',
      });
      await store.createConfirmationPause(expired);
      const lateRejectedAt = '2026-07-20T00:11:00.000Z';
      const lateReceipt = await rejectionReceipt(expired, {
        issuedAt: new Date(lateRejectedAt),
      });
      await expect(
        store.claimConfirmationRejection({
          requestId: expired.requestId,
          actionDigest: expired.actionDigest,
          approvalBindingDigest: expired.approvalBindingDigest,
          principal: expired.principal,
          receipt: lateReceipt,
          rejectedAt: lateRejectedAt,
        }),
      ).resolves.toEqual({ status: 'expired' });
      await expect(store.getConfirmationPause(expired.requestId)).resolves
        .toMatchObject({ status: 'expired' });
    });

    it('does not mutate storage for an early rejection', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      await store.createConfirmationPause(input);
      const earlyRejectedAt = '2026-07-19T23:59:00.000Z';
      const receipt = await rejectionReceipt(input, {
        issuedAt: new Date('2026-07-19T23:58:00.000Z'),
      });

      await expect(
        store.claimConfirmationRejection({
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          approvalBindingDigest: input.approvalBindingDigest,
          principal: input.principal,
          receipt,
          rejectedAt: earlyRejectedAt,
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({ status: 'pending', rejectionReceipt: null });
    });

    it('rejects a signed receipt issued before this pause', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      await store.createConfirmationPause(input);
      const priorReceipt = await rejectionReceipt(input, {
        issuedAt: new Date('2026-07-19T23:59:00.000Z'),
      });

      await expect(
        store.claimConfirmationRejection({
          requestId: input.requestId,
          actionDigest: input.actionDigest,
          approvalBindingDigest: input.approvalBindingDigest,
          principal: input.principal,
          receipt: priorReceipt,
          rejectedAt,
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({ status: 'pending', rejectionReceipt: null });
    });

    it('completes a claimed rejection exactly once and replays the outcome', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      await store.createConfirmationPause(input);
      const receipt = await rejectionReceipt(input);
      await store.claimConfirmationRejection({
        requestId: input.requestId,
        actionDigest: input.actionDigest,
        approvalBindingDigest: input.approvalBindingDigest,
        principal: input.principal,
        receipt,
        rejectedAt,
      });
      const completion = {
        requestId: input.requestId,
        receiptId: receipt.receiptId,
        completedAt: '2026-07-20T00:06:00.000Z',
        completion: {
          status: 'completed' as const,
          result: { responseText: 'Cancelled by customer.' },
        },
      };

      await expect(
        store.completeConfirmationResume({
          ...completion,
          completion: {
            status: 'completed',
            result: { unsupported: undefined },
          },
        }),
      ).rejects.toThrow();
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({ completionStatus: 'pending', completedAt: null });
      await expect(
        store.completeConfirmationResume({
          ...completion,
          completedAt: '2026-07-20T00:04:59.000Z',
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({ completionStatus: 'pending', completedAt: null });
      await expect(store.completeConfirmationResume(completion)).resolves
        .toMatchObject({ status: 'completed' });
      await expect(
        store.completeConfirmationResume({
          ...completion,
          completedAt: '2026-07-20T00:06:01.000Z',
        }),
      ).resolves.toMatchObject({ status: 'replay' });
      await expect(
        store.completeConfirmationResume({
          ...completion,
          completion: {
            status: 'completed',
            result: { responseText: 'Different result' },
          },
        }),
      ).resolves.toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toMatchObject({
          completionStatus: 'completed',
          completedAt: completion.completedAt,
        });
    });

    it('rejects a malformed stored record instead of trusting redundant columns', async () => {
      const { store, corrupt } = await harness.create();
      const input = await pauseInput();
      await store.createConfirmationPause(input);
      corrupt(input.requestId);

      await expect(store.getConfirmationPause(input.requestId)).rejects
        .toThrow();
    });

    it('removes confirmation authority when its session is reset', async () => {
      const { store } = await harness.create();
      const input = await pauseInput();
      await store.createConfirmationPause(input);

      await store.resetSession(input.sessionId);

      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toBeUndefined();
    });

    it('invalidates a pause across every ownership transition, including returning to AI', async () => {
      const { store } = await harness.create();
      const input = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000032',
      });
      await expect(store.createConfirmationPause(input)).resolves
        .toMatchObject({ status: 'created' });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toMatchObject({
        sessionGeneration: 0,
        sessionAuthorityGeneration: 0,
      });

      await expect(store.transitionSessionAuthority({
        sessionId: input.sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'agent-1',
      })).resolves.toMatchObject({
        status: 'transitioned',
        control: { sessionAuthorityGeneration: 1 },
      });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toBeUndefined();

      await expect(store.transitionSessionAuthority({
        sessionId: input.sessionId,
        expectedGeneration: 1,
        agentMode: 'ai_active',
        assignedAgentId: null,
      })).resolves.toMatchObject({
        status: 'transitioned',
        control: { sessionAuthorityGeneration: 2 },
      });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toBeUndefined();
      await expect(store.claimConfirmationRejection({
        requestId: input.requestId,
        actionDigest: input.actionDigest,
        approvalBindingDigest: input.approvalBindingDigest,
        principal: input.principal,
        receipt: await rejectionReceipt(input),
        rejectedAt,
      })).resolves.toEqual({ status: 'not_found' });
      await expect(
        store.reserveConfirmationResumeOperation(
          await reserveResumeInput(input),
        ),
      ).resolves.toEqual({ status: 'not_found' });
      await expect(store.createConfirmationPause(input)).resolves.toEqual({
        status: 'conflict',
      });
    });

    it('invalidates a guest pause across an AI-to-human-to-AI ownership cycle', async () => {
      const { store } = await harness.create();
      const input = await guestPauseInput({
        requestId: '00000000-0000-4000-8000-000000000034',
      });
      await expect(store.createConfirmationPause(input)).resolves
        .toMatchObject({ status: 'created' });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toMatchObject({
        record: {
          principal: { principalKind: 'guest_checkout' },
        },
        sessionAuthorityGeneration: 0,
      });

      await expect(store.transitionSessionAuthority({
        sessionId: input.sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'agent-guest',
      })).resolves.toMatchObject({
        status: 'transitioned',
        control: { sessionAuthorityGeneration: 1 },
      });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toBeUndefined();

      await expect(store.transitionSessionAuthority({
        sessionId: input.sessionId,
        expectedGeneration: 1,
        agentMode: 'ai_active',
        assignedAgentId: null,
      })).resolves.toMatchObject({
        status: 'transitioned',
        control: { sessionAuthorityGeneration: 2 },
      });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toBeUndefined();
      await expect(store.claimConfirmationRejection({
        requestId: input.requestId,
        actionDigest: input.actionDigest,
        approvalBindingDigest: input.approvalBindingDigest,
        principal: input.principal,
        receipt: await rejectionReceipt(input),
        rejectedAt,
      })).resolves.toEqual({ status: 'not_found' });
      await expect(
        store.reserveConfirmationResumeOperation(
          await reserveResumeInput(input),
        ),
      ).resolves.toEqual({ status: 'not_found' });
      await expect(store.createConfirmationPause(input)).resolves.toEqual({
        status: 'conflict',
      });
    });

    it('cannot complete an authenticated rejected pause after an ownership cycle', async () => {
      const { store } = await harness.create();
      await expectRejectedPauseInvalidatedAfterOwnershipCycle(
        store,
        await pauseInput({
          requestId: '00000000-0000-4000-8000-000000000035',
        }),
      );
    });

    it('cannot complete a guest rejected pause after an ownership cycle', async () => {
      const { store } = await harness.create();
      await expectRejectedPauseInvalidatedAfterOwnershipCycle(
        store,
        await guestPauseInput({
          requestId: '00000000-0000-4000-8000-000000000036',
        }),
      );
    });

    it('fences authenticated and guest reserve races when ownership transitions first', async () => {
      const inputs = [
        await pauseInput({
          requestId: '00000000-0000-4000-8000-000000000037',
        }),
        await guestPauseInput({
          requestId: '00000000-0000-4000-8000-000000000038',
        }),
      ];
      for (const input of inputs) {
        const { store } = await harness.create();
        await expect(store.createConfirmationPause(input)).resolves
          .toMatchObject({ status: 'created' });
        const reserve = store.reserveConfirmationResumeOperation(
          await reserveResumeInput(input),
        );
        const transition = store.transitionSessionAuthority({
          sessionId: input.sessionId,
          expectedGeneration: 0,
          agentMode: 'human_paused',
          assignedAgentId: 'agent-reserve-race',
        });

        await expect(transition).resolves.toMatchObject({
          status: 'transitioned',
          control: { sessionAuthorityGeneration: 1 },
        });
        const raced = await reserve;
        expect(['conflict', 'not_found']).toContain(raced.status);
        await expect(store.transitionSessionAuthority({
          sessionId: input.sessionId,
          expectedGeneration: 1,
          agentMode: 'ai_active',
          assignedAgentId: null,
        })).resolves.toMatchObject({
          status: 'transitioned',
          control: { sessionAuthorityGeneration: 2 },
        });
        await expect(
          store.reserveConfirmationResumeOperation(
            await reserveResumeInput(input),
          ),
        ).resolves.toEqual({ status: 'not_found' });
      }
    });

    it('fences a create that races an ownership transition', async () => {
      const { store } = await harness.create();
      const input = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000033',
      });

      const [created, transition] = await Promise.all([
        store.createConfirmationPause(input),
        store.transitionSessionAuthority({
          sessionId: input.sessionId,
          expectedGeneration: 0,
          agentMode: 'human_paused',
          assignedAgentId: 'agent-race',
        }),
      ]);

      expect(transition).toMatchObject({ status: 'transitioned' });
      expect(created).toEqual({ status: 'conflict' });
      await expect(
        store.getConfirmationPauseStorageSnapshot(input.requestId),
      ).resolves.toBeUndefined();
    });

    it('fences a create that began before the session reset', async () => {
      const { store } = await harness.create();
      const input = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000030',
      });

      const [created] = await Promise.all([
        store.createConfirmationPause(input),
        store.resetSession(input.sessionId),
      ]);

      expect(created).toEqual({ status: 'conflict' });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toBeUndefined();
    });

    it('resets malformed confirmation authority without parsing it', async () => {
      const { store, corrupt } = await harness.create();
      const input = await pauseInput({
        requestId: '00000000-0000-4000-8000-000000000031',
      });
      await store.createConfirmationPause(input);
      corrupt(input.requestId);

      await expect(store.resetSession(input.sessionId)).resolves.toMatchObject({
        sessionId: input.sessionId,
      });
      await expect(store.getConfirmationPause(input.requestId)).resolves
        .toBeUndefined();
    });
  });
}

async function pauseInput(
  overrides: Partial<CreateConfirmationPauseInput> = {},
  principalOverrides:
    Partial<AuthenticatedCommerceApprovalPrincipal> = {},
): Promise<CreateConfirmationPauseInput> {
  const principal: AuthenticatedCommerceApprovalPrincipal = {
    principalKind: 'authenticated_customer',
    sessionId: 'kfc:customer-1',
    customerId: 'customer-1',
    channel: 'kfc',
    authenticatedSubject: 'customer:customer-1',
    authenticationEvidenceRef: 'access-token:jti-1',
    ...principalOverrides,
  };
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: 'placeOrder',
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
    sourceTurnId: `agent:${JSON.stringify([
      principal.sessionId,
      'run:confirmation:message-1',
    ])}`,
    actionScope: '',
    actionId: 'checkpoint-paused-1',
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt,
    expiresAt,
  };
  return { ...input, ...overrides };
}

async function guestPauseInput(
  overrides: Partial<CreateConfirmationPauseInput> = {},
): Promise<CreateConfirmationPauseInput> {
  const guestAuthorityDigest = 'a'.repeat(64);
  const principal: GuestCheckoutCommerceApprovalPrincipal = {
    principalKind: 'guest_checkout',
    sessionId: 'messenger_mock:guest-1',
    customerId: 'guest-1',
    channel: 'messenger_mock',
    tenantScope: 'kfc-vietnam',
    surfaceSubjectRef: 'messenger_mock:guest-subject-1',
    externalThreadRef: 'guest-thread-1',
    externalMessageId: 'guest-message-1',
    ingressEvidenceRef: 'messenger_mock:webhook:guest-message-1',
    ingressEvidenceDigest: 'b'.repeat(64),
    sourceRunKind: 'agent_run',
    sourceRunRef: 'run:guest-confirmation-1',
    sourceRunGeneration: 1,
    sourceRunFenceDigest: 'c'.repeat(64),
    sessionAuthorityGeneration: 0,
    issuedAt: createdAt,
    expiresAt,
    guestAuthorityDigest,
  };
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: 'placeOrder',
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
      guestAuthorityDigest,
      orderPreviewRevision: 'd'.repeat(64),
      invoiceRevision: 'e'.repeat(64),
    },
  });
  const input: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: '00000000-0000-4000-8000-000000000034',
    sourceTurnId: `agent:${JSON.stringify([
      principal.sessionId,
      principal.sourceRunRef,
    ])}`,
    actionScope: '',
    actionId: 'checkpoint-guest-paused-1',
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt,
    expiresAt,
  };
  return { ...input, ...overrides };
}

async function rejectionReceipt(
  input: CreateConfirmationPauseInput,
  overrides: {
    receiptId?: string;
    issuedAt?: Date;
  } = {},
): Promise<CommerceApprovalReceipt> {
  return createCommerceApprovalReceipt({
    binding: input.approvalBinding,
    secret: signingSecret,
    decision: 'reject',
    receiptId:
      overrides.receiptId ?? '00000000-0000-4000-8000-000000000010',
    issuedAt: overrides.issuedAt ?? new Date('2026-07-20T00:04:00.000Z'),
    ttlMs: 15 * 60_000,
  });
}

async function reserveResumeInput(
  input: CreateConfirmationPauseInput,
): Promise<ReserveConfirmationResumeOperationInput> {
  const receipt = await createCommerceApprovalReceipt({
    binding: input.approvalBinding,
    secret: signingSecret,
    decision: 'approve',
    receiptId: input.requestId,
    issuedAt: new Date(input.createdAt),
    ttlMs: Date.parse(input.expiresAt) - Date.parse(input.createdAt),
  });
  const expectedSessionGeneration = 0;
  const pauseIdentityDigest = await confirmationPauseIdentityDigest(input);
  const providerIdempotencyKey =
    confirmationResumeProviderIdempotencyKey(input);
  const bindingFingerprint =
    await confirmationResumeOperationBindingFingerprint({
      pause: input,
      expectedSessionGeneration,
      pauseIdentityDigest,
      decision: 'approve',
      receipt,
      providerIdempotencyKey,
    });
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    operation: 'confirmation_resume',
    bindingFingerprint,
    expectedPause: input,
    expectedSessionGeneration,
    pauseIdentityDigest,
    decision: 'approve',
    receipt,
    providerIdempotencyKey,
    claimedAt: '2026-07-20T00:05:00.000Z',
    leaseTtlMs: 15_000,
  };
}

async function expectRejectedPauseInvalidatedAfterOwnershipCycle(
  store: ConversationStore,
  input: CreateConfirmationPauseInput,
): Promise<void> {
  const receipt = await rejectionReceipt(input);
  await expect(store.createConfirmationPause(input)).resolves
    .toMatchObject({ status: 'created' });
  await expect(store.claimConfirmationRejection({
    requestId: input.requestId,
    actionDigest: input.actionDigest,
    approvalBindingDigest: input.approvalBindingDigest,
    principal: input.principal,
    receipt,
    rejectedAt,
  })).resolves.toMatchObject({ status: 'claimed' });
  await expect(store.transitionSessionAuthority({
    sessionId: input.sessionId,
    expectedGeneration: 0,
    agentMode: 'human_paused',
    assignedAgentId: 'agent-completion-fence',
  })).resolves.toMatchObject({ status: 'transitioned' });
  await expect(store.transitionSessionAuthority({
    sessionId: input.sessionId,
    expectedGeneration: 1,
    agentMode: 'ai_active',
    assignedAgentId: null,
  })).resolves.toMatchObject({ status: 'transitioned' });
  await expect(store.completeConfirmationResume({
    requestId: input.requestId,
    receiptId: receipt.receiptId,
    completedAt: '2026-07-20T00:06:00.000Z',
    completion: {
      status: 'completed',
      result: { responseText: 'must not persist' },
    },
  })).resolves.toEqual({ status: 'lost' });
  await expect(store.getConfirmationPause(input.requestId)).resolves
    .toBeUndefined();
}

type PauseRow = Record<string, unknown>;

class FakeConfirmationPausePostgres {
  readonly rows = new Map<string, PauseRow>();
  readonly generations = new Map<string, number>();
  readonly sessionControls = new Map<string, PauseRow>();
  preserveConfirmationPausesOnNextReset = false;
  beforeConfirmationPauseUpdate?: (
    kind: 'expire' | 'reject' | 'complete',
  ) => void | Promise<void>;

  async connect() {
    return {
      query: this.query.bind(this),
      release() {
        return undefined;
      },
    };
  }

  async query(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: PauseRow[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    if (
      normalized === 'BEGIN' ||
      normalized === 'COMMIT' ||
      normalized === 'ROLLBACK'
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (
      normalized.startsWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      )
    ) {
      return { rows: [], rowCount: 1 };
    }
    if (
      normalized.startsWith(
        'SELECT * FROM session_controls',
      )
    ) {
      const control = this.sessionControls.get(String(values[0]));
      return {
        rows: control ? [control] : [],
        rowCount: control ? 1 : 0,
      };
    }
    if (
      normalized.startsWith(
        'SELECT COALESCE(control.session_authority_generation, 0)',
      )
    ) {
      const control = this.sessionControls.get(String(values[0]));
      const active =
        !control || control.agent_mode === 'ai_active'
          ? {
              session_authority_generation:
                control?.session_authority_generation ?? 0,
            }
          : undefined;
      return {
        rows: active ? [active] : [],
        rowCount: active ? 1 : 0,
      };
    }
    if (
      normalized.startsWith(
        'SELECT generation FROM confirmation_pause_sessions',
      )
    ) {
      const generation = this.generations.get(String(values[0]));
      return {
        rows:
          generation === undefined ? [] : [{ generation }],
        rowCount: generation === undefined ? 0 : 1,
      };
    }
    if (normalized.startsWith('INSERT INTO session_controls')) {
      const sessionId = String(values[0]);
      const isTransition = normalized.includes(
        'VALUES ($1, $2, $3, $4, $5)',
      );
      const control: PauseRow = {
        session_id: sessionId,
        agent_mode: isTransition ? values[1] : 'ai_active',
        assigned_agent_id: isTransition ? values[2] : null,
        session_authority_generation: Number(
          isTransition ? values[3] : values[1],
        ),
        updated_at: String(isTransition ? values[4] : values[2]),
      };
      this.sessionControls.set(sessionId, control);
      return { rows: [control], rowCount: 1 };
    }
    if (
      normalized.startsWith(
        'WITH advanced_confirmation_pause_generation AS',
      )
    ) {
      const sessionId = String(values[0]);
      this.generations.set(
        sessionId,
        (this.generations.get(sessionId) ?? 0) + 1,
      );
      this.preserveConfirmationPausesOnNextReset = false;
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('INSERT INTO confirmation_pause_sessions')) {
      const sessionId = String(values[0]);
      const generation = this.generations.get(sessionId) ?? 0;
      this.generations.set(sessionId, generation);
      return { rows: [{ generation }], rowCount: 1 };
    }
    if (
      normalized.startsWith(
        'SELECT generation FROM confirmation_pause_sessions',
      )
    ) {
      const generation = this.generations.get(String(values[0]));
      return {
        rows: generation === undefined ? [] : [{ generation }],
        rowCount: generation === undefined ? 0 : 1,
      };
    }
    if (
      normalized.startsWith(
        'SELECT ( EXISTS ( SELECT 1 FROM irreversible_operations',
      )
    ) {
      return { rows: [{ unresolved: false }], rowCount: 1 };
    }
    if (
      normalized.startsWith('UPDATE non_agent_text_deliveries') &&
      (
        normalized.includes("SET status = 'outcome_unknown'") ||
        normalized.includes("SET status = 'confirmed_not_sent'")
      )
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('UPDATE confirmation_pause_sessions')) {
      const sessionId = String(values[0]);
      this.generations.set(
        sessionId,
        (this.generations.get(sessionId) ?? 0) + 1,
      );
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith('WITH session_customer_runs AS')) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('DELETE FROM confirmation_pauses AS pause')) {
      const row = this.rows.get(String(values[0]));
      if (
        row &&
        row.session_id === values[1] &&
        row.session_generation !== values[2] &&
        this.generations.get(String(row.session_id)) === values[2]
      ) {
        this.rows.delete(String(values[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('INSERT INTO confirmation_pauses')) {
      const requestId = String(values[1]);
      const row = rowFromValues(values);
      const existing = this.rows.get(requestId);
      if (existing) return { rows: [], rowCount: 0 };
      this.rows.set(requestId, row);
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT pause.* FROM confirmation_pauses')) {
      const row = this.rows.get(String(values[0]));
      const current = row &&
        this.generations.get(String(row.session_id)) ===
          row.session_generation &&
        this.confirmationPauseAuthorityIsCurrent(row)
        ? row
        : undefined;
      return {
        rows: current ? [current] : [],
        rowCount: current ? 1 : 0,
      };
    }
    if (
      normalized.startsWith('UPDATE confirmation_pauses') &&
      normalized.includes("SET status = 'expired'")
    ) {
      await this.runBeforeConfirmationPauseUpdate('expire');
      const row = this.rows.get(String(values[0]));
      if (
        !row ||
        row.status !== 'pending' ||
        String(row.expires_at) > String(values[1]) ||
        row.checkpoint_thread_id !== values[2] ||
        row.checkpoint_namespace !== values[3] ||
        row.checkpoint_id !== values[4] ||
        row.created_at !== values[5] ||
        row.expires_at !== values[6] ||
        row.action_digest !== values[7] ||
        row.approval_binding_digest !== values[8] ||
        row.session_id !== values[9] ||
        row.customer_id !== values[10] ||
        row.channel !== values[11] ||
        row.authenticated_subject !== values[12] ||
        row.authentication_evidence_ref !== values[13] ||
        row.session_generation !== values[14] ||
        row.pause_identity_digest !== values[15] ||
        !this.confirmationPauseGenerationIsCurrent(row) ||
        !this.confirmationPauseAuthorityIsCurrent(row)
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'expired';
      return { rows: [row], rowCount: 1 };
    }
    if (
      normalized.startsWith('UPDATE confirmation_pauses') &&
      normalized.includes("SET status = 'rejected'")
    ) {
      await this.runBeforeConfirmationPauseUpdate('reject');
      const row = this.rows.get(String(values[0]));
      if (
        !row ||
        row.status !== 'pending' ||
        String(row.expires_at) <= String(values[3]) ||
        row.action_digest !== values[4] ||
        row.approval_binding_digest !== values[5] ||
        row.session_id !== values[6] ||
        row.customer_id !== values[7] ||
        row.channel !== values[8] ||
        row.authenticated_subject !== values[9] ||
        row.authentication_evidence_ref !== values[10] ||
        row.checkpoint_thread_id !== values[11] ||
        row.checkpoint_namespace !== values[12] ||
        row.checkpoint_id !== values[13] ||
        row.created_at !== values[14] ||
        row.expires_at !== values[15] ||
        row.session_generation !== values[16] ||
        row.pause_identity_digest !== values[17] ||
        !this.confirmationPauseGenerationIsCurrent(row) ||
        !this.confirmationPauseAuthorityIsCurrent(row)
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'rejected';
      row.rejection_receipt_id = values[1];
      row.rejection_receipt_json = postgresJsonValue(values[2]);
      row.rejected_at = values[3];
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith('UPDATE confirmation_pauses')) {
      await this.runBeforeConfirmationPauseUpdate('complete');
      const row = this.rows.get(String(values[0]));
      if (
        !row ||
        row.status !== 'rejected' ||
        row.completion_status !== 'pending' ||
        row.rejection_receipt_id !== values[5] ||
        row.checkpoint_thread_id !== values[6] ||
        row.checkpoint_namespace !== values[7] ||
        row.checkpoint_id !== values[8] ||
        row.created_at !== values[9] ||
        row.expires_at !== values[10] ||
        row.action_digest !== values[11] ||
        row.approval_binding_digest !== values[12] ||
        row.session_id !== values[13] ||
        row.customer_id !== values[14] ||
        row.channel !== values[15] ||
        row.authenticated_subject !== values[16] ||
        row.authentication_evidence_ref !== values[17] ||
        row.session_generation !== values[18] ||
        row.pause_identity_digest !== values[19] ||
        !this.confirmationPauseGenerationIsCurrent(row) ||
        !this.confirmationPauseAuthorityIsCurrent(row)
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.completion_status = values[1];
      row.result_json = postgresJsonValue(values[2]);
      row.completion_error = values[3];
      row.completed_at = values[4];
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`Unsupported confirmation pause SQL: ${normalized}`);
  }

  private async runBeforeConfirmationPauseUpdate(
    kind: 'expire' | 'reject' | 'complete',
  ): Promise<void> {
    const hook = this.beforeConfirmationPauseUpdate;
    this.beforeConfirmationPauseUpdate = undefined;
    await hook?.(kind);
  }

  private confirmationPauseGenerationIsCurrent(row: PauseRow): boolean {
    return this.generations.get(String(row.session_id)) ===
      row.session_generation;
  }

  private confirmationPauseAuthorityIsCurrent(row: PauseRow): boolean {
    const control = this.sessionControls.get(String(row.session_id));
    return control
      ? (
          control.agent_mode === 'ai_active' &&
          Number(control.session_authority_generation) ===
            Number(row.session_authority_generation)
        )
      : Number(row.session_authority_generation) === 0;
  }
}

function rowFromValues(values: unknown[]): PauseRow {
  const columns = [
    'schema_version',
    'request_id',
    'checkpoint_thread_id',
    'checkpoint_namespace',
    'checkpoint_id',
    'session_id',
    'session_generation',
    'session_authority_generation',
    'pause_identity_digest',
    'customer_id',
    'channel',
    'action_json',
    'action_digest',
    'approval_binding_json',
    'approval_binding_digest',
    'principal_json',
    'authenticated_subject',
    'authentication_evidence_ref',
    'created_at',
    'expires_at',
    'status',
    'rejection_receipt_id',
    'rejection_receipt_json',
    'rejected_at',
    'completion_status',
    'result_json',
    'completion_error',
    'completed_at',
  ];
  return Object.fromEntries(
    columns.map((column, index) => [
      column,
      column.endsWith('_json')
        ? postgresJsonValue(values[index])
        : values[index],
    ]),
  );
}

function postgresJsonValue(value: unknown): unknown {
  return typeof value === 'string'
    ? JSON.parse(value) as unknown
    : value;
}

type ConfirmationMutation = 'expire' | 'reject' | 'complete';

interface SqlRaceHarness {
  name: string;
  supportsAfterUpdate: boolean;
  create(): Promise<{
    store: ConversationStore;
    beforeUpdate(
      expected: ConfirmationMutation,
      hook: () => Promise<void>,
    ): void;
    afterUpdate(
      expected: ConfirmationMutation,
      hook: () => Promise<void>,
    ): void;
  }>;
}

const sqlRaceHarnesses: SqlRaceHarness[] = [
  {
    name: 'D1Store',
    supportsAfterUpdate: true,
    async create() {
      const db = new FakeD1Database();
      const store = new D1Store(db);
      await store.initialize();
      return {
        store,
        beforeUpdate(expected, hook) {
          db.beforeConfirmationPauseUpdate = async (actual) => {
            expect(actual).toBe(expected);
            await hook();
          };
        },
        afterUpdate(expected, hook) {
          db.afterConfirmationPauseUpdate = async (actual) => {
            expect(actual).toBe(expected);
            await hook();
          };
        },
      };
    },
  },
  {
    name: 'PostgresStore',
    supportsAfterUpdate: false,
    async create() {
      const db = new FakeConfirmationPausePostgres();
      return {
        store: new PostgresStore(db as never),
        beforeUpdate(expected, hook) {
          db.beforeConfirmationPauseUpdate = async (actual) => {
            expect(actual).toBe(expected);
            await hook();
          };
        },
        afterUpdate() {
          throw new Error('postgres_confirmation_update_is_atomic');
        },
      };
    },
  },
];

for (const harness of sqlRaceHarnesses) {
  describe(`${harness.name} confirmation pause ABA fencing`, () => {
    for (const mutation of [
      'expire',
      'reject',
      'complete',
    ] as const satisfies readonly ConfirmationMutation[]) {
      it(`rejects reset/recreate before ${mutation} CAS`, async () => {
        const race = await harness.create();
        await expectResetRecreateConflict(race, mutation, 'before');
      });

      if (harness.supportsAfterUpdate) {
        it(`rejects reset/recreate after ${mutation} update`, async () => {
          const race = await harness.create();
          await expectResetRecreateConflict(race, mutation, 'after');
        });
      }
    }
  });
}

describe('Postgres confirmation pause reset snapshot fencing', () => {
  it('hides a stale row and never reuses its request id', async () => {
    const db = new FakeConfirmationPausePostgres();
    const store = new PostgresStore(db as never);
    const original = await pauseInput({
      requestId: '00000000-0000-4000-8000-000000000050',
    });
    await store.createConfirmationPause(original);
    db.preserveConfirmationPausesOnNextReset = true;

    await store.resetSession(original.sessionId);

    expect(db.rows.has(original.requestId)).toBe(true);
    await expect(store.getConfirmationPause(original.requestId)).resolves
      .toBeUndefined();
    const receipt = await rejectionReceipt(original);
    await expect(
      store.claimConfirmationRejection({
        requestId: original.requestId,
        actionDigest: original.actionDigest,
        approvalBindingDigest: original.approvalBindingDigest,
        principal: original.principal,
        receipt,
        rejectedAt,
      }),
    ).resolves.toEqual({ status: 'not_found' });

    const replacement = {
      ...original,
      actionId: 'checkpoint-after-reset',
    };
    await expect(store.createConfirmationPause(replacement)).resolves
      .toEqual({ status: 'conflict' });
    await expect(store.getConfirmationPause(original.requestId)).resolves
      .toBeUndefined();
  });
});

async function expectResetRecreateConflict(
  race: Awaited<ReturnType<SqlRaceHarness['create']>>,
  mutation: ConfirmationMutation,
  timing: 'before' | 'after',
): Promise<void> {
  const original = await pauseInput({
    requestId:
      mutation === 'expire'
        ? '00000000-0000-4000-8000-000000000040'
        : mutation === 'reject'
          ? '00000000-0000-4000-8000-000000000041'
          : '00000000-0000-4000-8000-000000000042',
  });
  const replacement = {
    ...original,
    actionId: `checkpoint-replacement-${mutation}`,
  };
  await race.store.createConfirmationPause(original);
  const receipt = await rejectionReceipt(original);
  if (mutation === 'complete') {
    await race.store.claimConfirmationRejection({
      requestId: original.requestId,
      actionDigest: original.actionDigest,
      approvalBindingDigest: original.approvalBindingDigest,
      principal: original.principal,
      receipt,
      rejectedAt,
    });
  }
  const swap = async (): Promise<void> => {
    await race.store.resetSession(original.sessionId);
    await expect(race.store.createConfirmationPause(replacement)).resolves
      .toEqual({ status: 'conflict' });
  };
  race[timing === 'before' ? 'beforeUpdate' : 'afterUpdate'](mutation, swap);

  const result =
    mutation === 'complete'
      ? await race.store.completeConfirmationResume({
          requestId: original.requestId,
          receiptId: receipt.receiptId,
          completedAt: '2026-07-20T00:06:00.000Z',
          completion: {
            status: 'completed',
            result: { responseText: 'Cancelled by customer.' },
          },
        })
      : await race.store.claimConfirmationRejection({
          requestId: original.requestId,
          actionDigest: original.actionDigest,
          approvalBindingDigest: original.approvalBindingDigest,
          principal: original.principal,
          receipt:
            mutation === 'expire'
              ? await rejectionReceipt(original, {
                  issuedAt: new Date('2026-07-20T00:11:00.000Z'),
                })
              : receipt,
          rejectedAt:
            mutation === 'expire'
              ? '2026-07-20T00:11:00.000Z'
              : rejectedAt,
        });

  expect(result).toEqual({
    status: mutation === 'complete' ? 'lost' : 'not_found',
  });
  await expect(race.store.getConfirmationPause(original.requestId)).resolves
    .toBeUndefined();
}
