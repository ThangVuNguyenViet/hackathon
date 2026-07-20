import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createConfirmationApprovalKeyRing,
  issueConfirmationApprovalCapability,
} from '../../src/api/confirmationApprovalCapability.js';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  loadPriorVerifiedState,
} from '../../src/graph/verifiedState.js';
import {
  mockInventoryProviderRevision,
} from '../../src/mock/mockInventoryAuthority.js';
import {
  exactCartAvailabilityRevision,
} from '../../src/ordering/exactCartAvailabilityAuthority.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  CustomerAccessContext,
} from '../../src/domain/types.js';

const signingSecret =
  'test-confirmation-signing-secret-with-more-than-32-bytes';
const publicPauseResponseSchema = z.object({
  pause: z.object({
    capability: z.literal('placeOrder'),
    requestId: z.string().uuid(),
    approvalCapability: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).strict(),
}).passthrough();

function sandboxIdentityLifecycle() {
  const unavailable = async (): Promise<never> => {
    throw new Error('Lifecycle mutation is not used by confirmation tests');
  };
  return {
    environment: 'sandbox' as const,
    controls: {
      create: unavailable,
      get: unavailable,
      transition: unavailable,
    },
    createInput: unavailable,
    binding: unavailable,
  };
}

function orderConfirmationModel() {
  return fakeModel()
    .respondWithTools([{
      name: 'placeOrder',
      args: {},
    }])
    .respond(groundedResponseModelReply({
      customerText: 'The verified order was created.',
    }));
}

async function authenticatedServer(input: {
  sessionId: string;
  customerId: string;
}) {
  const store = new MemoryStore();
  const completeOperations = vi.spyOn(
    store,
    'completeIrreversibleOperation',
  );
  const dashboard = new DashboardEventBus();
  const checkpointer = new MemorySaver();
  const keyRing = createConfirmationApprovalKeyRing({
    active: { keyId: 'test-primary', secret: signingSecret },
  });
  const fixtures = createTestFixtures();
  const cart = {
    id: 'cart-confirmation-resume',
    items: [{
      itemCode: '20751',
      name: 'Combo Hợp Gu 99K',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 117_000,
    voucherCode: null,
  };
  const observedAt = new Date();
  const inventoryProviderRevision =
    await mockInventoryProviderRevision({
      fixtures,
      profile: {},
    });
  const authenticationExpiresAt =
    new Date(Date.now() + 15 * 60_000).toISOString();
  const proofEvent = await store.appendEvent(
    input.sessionId,
    'proof:kfc_preconditions',
    {
      customerId: input.customerId,
      authenticated: true,
      expiresAt: authenticationExpiresAt,
      orderId: null,
      providerProfile: null,
    },
  );
  const accessContext: CustomerAccessContext = {
    tenantScope: 'kfc-vietnam',
    customerSurface: 'kfc-app-chat',
    sessionRef: input.sessionId,
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: input.customerId,
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'sandbox-proof-control',
      issuer: 'kfc-agent-backend',
      audience: 'kfc-agent-backend',
      authenticatedAt: proofEvent.createdAt,
      expiresAt: authenticationExpiresAt,
      evidenceRef: proofEvent.id,
    },
    authorizedScopes: [
      'customer:read',
      'membership:read',
      'membership:write',
      'order:read',
      'order:write',
      'payment:read',
      'payment:write',
      'handoff:write',
    ],
  };
  await store.appendEvent(input.sessionId, 'graph:verified_state', {
    verifiedState: {
      cart,
      address: {
        label: 'Big C Đồng Nai',
        line1: 'Big C Đồng Nai',
        district: 'Biên Hòa',
        city: 'Đồng Nai',
      },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC BIG C ĐỒNG NAI',
        feeVnd: 18_000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'test_only',
            sourceFile: 'confirmation-resume.test.ts',
          },
        },
      },
      orderPreview: {
        id: 'KFC-MOCK-PREVIEW',
        cart,
        status: 'previewed',
        paymentStatus: 'not_started',
        assignedStoreId: 'KFCVN0002',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
      exactCartAvailabilityObservation: {
        schemaVersion: 'kfc-exact-cart-availability-observation-v2',
        observationId: 'availability-confirmation-resume',
        cartRevision: await exactCartAvailabilityRevision(cart),
        storeId: 'KFCVN0002',
        disposition: 'delivery',
        inventoryProviderRevision: {
          authority: 'inventory_availability',
          revision: inventoryProviderRevision,
        },
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(
          observedAt.getTime() + 5 * 60_000,
        ).toISOString(),
        complete: true,
        rows: [{
          itemCode: '20751',
          quantity: 1,
          status: 'available',
        }],
      },
      toolTrace: [],
    },
  });
  const server = buildServer({
    store,
    dashboard,
    checkpointer,
    fixtures,
    lifecycle: sandboxIdentityLifecycle(),
    confirmationApprovalKeyRing: keyRing,
    mockClientOptions: {
      mockedUpstreamApiProvider: () => ({}),
      fulfillmentQuoteProvider: async (
        quote: { storeId: string },
      ) => ({
        ok: true as const,
        value: {
          storeId: quote.storeId,
          feeVnd: 18_000,
          etaMinutes: 25,
        },
        message: 'quoted',
      }),
    },
    ...testAgent(orderConfirmationModel()),
  });
  return {
    store,
    checkpointer,
    server,
    keyRing,
    accessContext,
    completeOperations,
  };
}

async function requestOrderApproval(input: {
  sessionId: string;
  customerId: string;
}) {
  const runtime = await authenticatedServer(input);
  const paused = await runtime.server.inject({
    method: 'POST',
    url: '/chat/kfc/message',
    payload: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      clientMessageId: 'confirm-order',
      text: 'Xác nhận đặt đơn theo giỏ hàng và giao hàng đã kiểm tra',
    },
  });
  if (paused.statusCode !== 200) {
    throw new Error(
      `approval request failed: ${paused.statusCode} ${paused.body}`,
    );
  }
  const body = publicPauseResponseSchema.parse(paused.json());
  expect(body.pause).toEqual({
    capability: 'placeOrder',
    requestId: expect.any(String),
    approvalCapability: expect.any(String),
    expiresAt: expect.any(String),
  });
  expect(body.pause).not.toHaveProperty('action');
  expect(body.pause).not.toHaveProperty('checkpoint');
  expect(body.pause).not.toHaveProperty('principal');
  const completedAtRest = JSON.stringify(
    runtime.completeOperations.mock.calls,
  );
  expect(completedAtRest).not.toContain('approvalCapability');
  expect(completedAtRest).not.toContain(
    body.pause.approvalCapability,
  );
  expect(completedAtRest).toContain(body.pause.requestId);
  return {
    ...runtime,
    pause: body.pause,
  };
}

describe('signed confirmation resume route', () => {
  it('requires the one-shot approval capability in the strict HTTP body', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: {
        requestId: crypto.randomUUID(),
        decision: 'approve',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errorCode: 'invalid_confirmation_resume',
    });
  });

  it('executes exactly once, returns a bounded result, and rejects token replay', async () => {
    const sessionId = 'kfc:resume_customer';
    const prepared = await requestOrderApproval({
      sessionId,
      customerId: 'resume_customer',
    });
    const request = {
      requestId: prepared.pause.requestId,
      decision: 'approve',
      approvalCapability: prepared.pause.approvalCapability,
    };
    const duplicates = await Promise.all([
      prepared.server.inject({
        method: 'POST',
        url: '/chat/kfc/confirmations/resume',
        payload: request,
      }),
      prepared.server.inject({
        method: 'POST',
        url: '/chat/kfc/confirmations/resume',
        payload: request,
      }),
    ]);
    const statuses = duplicates
      .map(({ statusCode }) => statusCode)
      .sort((left, right) => left - right);
    expect(
      statuses,
      JSON.stringify(
        duplicates.map(({ statusCode, body }) => ({
          statusCode,
          body,
        })),
      ),
    ).toEqual([200, 409]);
    const completed = duplicates.find(
      ({ statusCode }) => statusCode === 200,
    )?.json();
    expect(completed).toEqual({
      status: 'completed',
      result: {
        actionOutcome: 'succeeded',
        continuation: 'turn_completed',
        requestId: prepared.pause.requestId,
        responseText: expect.any(String),
        orderId: expect.any(String),
      },
    });
    expect(JSON.stringify(completed)).not.toContain('checkpoint');
    expect(JSON.stringify(completed)).not.toContain('signing');
    expect(JSON.stringify(completed)).not.toContain('toolTrace');

    const replay = await prepared.server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: request,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({
      errorCode: 'approval_capability_replayed',
    });

    const verified = await loadPriorVerifiedState(
      prepared.store,
      sessionId,
    );
    expect(
      verified.toolTrace?.filter(
        ({ toolName }) => toolName === 'placeOrder',
      ),
    ).toHaveLength(1);

    const snapshot =
      await prepared.store.getConfirmationPauseStorageSnapshot(
        prepared.pause.requestId,
      );
    const checkpoint = snapshot
      ? await prepared.checkpointer.getTuple({
          configurable: {
            thread_id: snapshot.record.checkpointThreadId,
            checkpoint_ns: snapshot.record.checkpointNamespace,
            checkpoint_id: snapshot.record.checkpointId,
          },
        })
      : undefined;
    const durableData = JSON.stringify({
      events: await prepared.store.listEvents(sessionId),
      snapshot,
      checkpoint,
    });
    expect(durableData).not.toContain(
      prepared.pause.approvalCapability,
    );
    expect(durableData).not.toContain(signingSecret);
  });

  it('rejects a tampered or cross-request capability before claiming', async () => {
    const first = await requestOrderApproval({
      sessionId: 'kfc:capability_a',
      customerId: 'capability_a',
    });
    const replacement = first.pause.approvalCapability.endsWith('x')
      ? 'y'
      : 'x';
    const tampered =
      `${first.pause.approvalCapability.slice(0, -1)}${replacement}`;
    const invalid = await first.server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: {
        requestId: first.pause.requestId,
        decision: 'approve',
        approvalCapability: tampered,
      },
    });
    expect(invalid.statusCode).toBe(403);
    expect(invalid.json()).toEqual({
      errorCode: 'approval_capability_invalid',
    });

    const otherRequest = crypto.randomUUID();
    const crossed = await first.server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: {
        requestId: otherRequest,
        decision: 'approve',
        approvalCapability: first.pause.approvalCapability,
      },
    });
    expect(crossed.statusCode).toBe(404);
    expect(crossed.json()).toEqual({
      errorCode: 'confirmation_not_found',
    });
  });

  it('rejects an expired capability before any irreversible execution', async () => {
    const prepared = await requestOrderApproval({
      sessionId: 'kfc:expired_capability',
      customerId: 'expired_capability',
    });
    const snapshot =
      await prepared.store.getConfirmationPauseStorageSnapshot(
        prepared.pause.requestId,
      );
    if (!snapshot) throw new Error('confirmation pause snapshot missing');
    const shortLived = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: prepared.accessContext,
      keyRing: prepared.keyRing,
      ttlMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const expired = await prepared.server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: {
        requestId: prepared.pause.requestId,
        decision: 'approve',
        approvalCapability: shortLived.approvalCapability,
      },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toEqual({
      errorCode: 'approval_capability_expired',
    });
    const verified = await loadPriorVerifiedState(
      prepared.store,
      'kfc:expired_capability',
    );
    expect(
      verified.toolTrace?.filter(
        ({ toolName }) => toolName === 'placeOrder',
      ),
    ).toEqual([]);
  });
});
