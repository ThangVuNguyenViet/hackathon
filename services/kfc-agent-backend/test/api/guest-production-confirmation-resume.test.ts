import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createConfirmationApprovalKeyRing,
} from '../../src/api/confirmationApprovalCapability.js';
import {
  confirmationPauseForPublicResponse,
  persistCanonicalConfirmationPause,
} from '../../src/api/confirmationPausePersistence.js';
import {
  createProductionConfirmationResumeHandler,
} from '../../src/api/productionConfirmationResume.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import {
  mockInventoryProviderRevision,
} from '../../src/mock/mockInventoryAuthority.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  agentRunExecutionFence,
} from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  exactCartAvailabilityRevision,
} from '../../src/ordering/exactCartAvailabilityAuthority.js';
import {
  issueVerifiedMessengerGuestCheckoutAuthority,
  verifyMessengerGuestCheckoutIngress,
} from '../../src/security/guestCheckoutAuthority.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const keyRing = createConfirmationApprovalKeyRing({
  active: {
    keyId: 'guest-production-resume',
    secret: 'guest-production-resume-secret-at-least-32-bytes',
  },
});

describe('guest production confirmation resume', () => {
  it('executes the exact guest order and payment continuation once', async () => {
    const now = new Date();
    const sessionId = 'messenger:guest-production-resume';
    const customerId = 'guest-production-resume';
    const externalMessageId = 'guest-production-resume-message';
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const checkpointer = new MemorySaver();
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    await expect(store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'guest-production-human',
    })).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 1 },
    });
    await expect(store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 1,
      agentMode: 'ai_active',
      assignedAgentId: null,
    })).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 2 },
    });
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const createPaymentLink = vi.spyOn(
      clients.payment,
      'createPaymentLink',
    );
    const methodId = fixtures.paymentMethods.find(
      (method) =>
        method.supported &&
        method.supportStatus === 'listed_supported' &&
        method.category !== 'cash_on_delivery',
    )?.methodId;
    if (!methodId) throw new Error('test_payment_method_missing');

    const scheduled = await store.createAgentRun({
      id: 'guest-production-resume-run',
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId: customerId,
      status: 'scheduled',
      coalescedInputText: 'Place this order and let me pay online.',
      deliveryStatus: 'pending',
      scheduledAt: now.toISOString(),
    });
    expect(scheduled.sessionAuthorityGeneration).toBe(2);
    await store.setSessionAgentState({
      sessionId,
      currentRunId: scheduled.id,
      generation: scheduled.generation,
      debounceDeadlineAt: null,
    });
    const claimed = await store.claimAgentRunExecution({
      runId: scheduled.id,
      sessionId,
      generation: scheduled.generation,
      sessionAuthorityGeneration:
        scheduled.sessionAuthorityGeneration,
      claimedAt: now.toISOString(),
      executionLeaseToken:
        'guest-production-resume-execution-lease-token-0001',
      executionLeaseExpiresAt:
        new Date(now.getTime() + 5 * 60_000).toISOString(),
    });
    if (claimed.status !== 'claimed') {
      throw new Error('test_agent_run_claim_failed');
    }
    const runFence = agentRunExecutionFence(claimed.run);
    const ingressBody = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'guest-production-page',
        time: now.getTime(),
        messaging: [{
          sender: { id: customerId },
          recipient: { id: 'guest-production-page' },
          timestamp: now.getTime(),
          message: {
            mid: externalMessageId,
            text: 'Place this order and let me pay online.',
          },
        }],
      }],
    });
    const ingress = await verifyMessengerGuestCheckoutIngress({
      rawBody: new TextEncoder().encode(ingressBody),
      signatureHeader: `sha256=${
        createHmac('sha256', 'guest-production-app-secret')
          .update(ingressBody)
          .digest('hex')
      }`,
      appSecret: 'guest-production-app-secret',
      pageId: 'guest-production-page',
    });
    if (!ingress[0]) throw new Error('test_verified_ingress_missing');
    const guestCheckoutAuthority =
      await issueVerifiedMessengerGuestCheckoutAuthority({
        ingress: ingress[0],
        runFence,
        issuedAt: now,
        ttlMs: 10 * 60_000,
      });

    await seedCheckoutState({
      store,
      sessionId,
      customerId,
      fixtures,
      now,
    });
    const model = fakeModel()
      .respondWithTools([{ name: 'placeOrder', args: {} }])
      .respondWithTools([{
        name: 'listPaymentMethods',
        args: { query: null, paymentSurface: null },
      }])
      .respondWithTools([{
        name: 'createPaymentLink',
        args: { methodId },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The verified payment link is ready.',
      }));
    const responseVerifierModel = groundedResponseVerifierModel();
    const isInitialRunCurrent = () =>
      store.isRunCommitFenceCurrent({
        sessionId,
        fence: runFence,
        notAfter: guestCheckoutAuthority.expiresAt,
      });
    const initial = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'messenger',
      text: 'Place this order and let me pay online.',
      externalMessageId,
      clients,
      store,
      dashboard,
      checkpointer,
      agentModel: model,
      responseVerifierModel,
      guestCheckoutAuthority,
      runGuard: {
        isCurrent: isInitialRunCurrent,
        commitFence: runFence,
      },
    });
    expect(initial.status).toBe('paused');
    expect(initial.pause?.capability).toBe('placeOrder');
    if (
      !initial.pause ||
      initial.pause.capability !== 'placeOrder'
    ) {
      throw new Error('test_order_pause_missing');
    }
    await persistCanonicalConfirmationPause({
      store,
      sessionId,
      customerId,
      channel: 'messenger',
      pause: initial.pause,
      accessContext: undefined,
      guestCheckoutAuthority,
      checkpointer,
      runCommit: {
        fence: runFence,
        state: initial.state,
      },
    });
    const publicOrderPause =
      await confirmationPauseForPublicResponse({
        pause: {
          capability: initial.pause.capability,
          requestId: initial.pause.requestId,
          expiresAt: (
            await requiredPauseSnapshot(
              store,
              initial.pause.requestId,
            )
          ).record.expiresAt,
        },
        store,
        accessContext: undefined,
        guestCheckoutAuthority,
        keyRing,
      });

    const handler = createProductionConfirmationResumeHandler({
      store,
      dashboard,
      keyRing,
      checkpointer,
      agentModel: model,
      responseVerifierModel,
      accessContext: async () => undefined,
      createClients: async () => clients,
    });
    const providerCallsBeforeResume = model.callCount;
    const tamperedCapability =
      publicOrderPause.approvalCapability.slice(0, -1) +
      (publicOrderPause.approvalCapability.endsWith('A')
        ? 'B'
        : 'A');
    await expect(handler({
      requestId: publicOrderPause.requestId,
      decision: 'approve',
      approvalCapability: tamperedCapability,
    })).resolves.toMatchObject({
      status: 403,
      body: { errorCode: 'approval_capability_invalid' },
    });
    await expect(handler({
      requestId: 'cross-session-run-turn-request',
      decision: 'approve',
      approvalCapability: publicOrderPause.approvalCapability,
    })).resolves.toMatchObject({
      status: 404,
      body: { errorCode: 'confirmation_not_found' },
    });
    expect(model.callCount).toBe(providerCallsBeforeResume);
    expect(placeOrder).not.toHaveBeenCalled();
    expect(createPaymentLink).not.toHaveBeenCalled();

    const orderResume = await handler({
      requestId: publicOrderPause.requestId,
      decision: 'approve',
      approvalCapability: publicOrderPause.approvalCapability,
    });
    expect(orderResume).toMatchObject({
      status: 200,
      body: {
        status: 'completed',
        result: {
          actionOutcome: 'succeeded',
          continuation: 'approval_required',
          capability: 'createPaymentLink',
          requestId: expect.any(String),
          approvalCapability: expect.any(String),
        },
      },
    });
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).not.toHaveBeenCalled();
    const orderBody = orderResume.body as {
      result: {
        requestId: string;
        approvalCapability: string;
      };
    };

    const providerCallsBeforeCrossedContinuation =
      model.callCount;
    await expect(handler({
      requestId: orderBody.result.requestId,
      decision: 'approve',
      approvalCapability: publicOrderPause.approvalCapability,
    })).resolves.toMatchObject({
      status: 403,
      body: { errorCode: 'approval_capability_invalid' },
    });
    expect(model.callCount).toBe(
      providerCallsBeforeCrossedContinuation,
    );
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).not.toHaveBeenCalled();

    const paymentResume = await handler({
      requestId: orderBody.result.requestId,
      decision: 'approve',
      approvalCapability: orderBody.result.approvalCapability,
    });
    expect(paymentResume).toMatchObject({
      status: 200,
      body: {
        status: 'completed',
        result: {
          actionOutcome: 'succeeded',
          continuation: 'turn_completed',
          responseText: expect.any(String),
          orderId: expect.any(String),
        },
      },
    });
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);
    expect(createPaymentLink.mock.calls[0]?.[1]).toBe(methodId);

    const providerCallsBeforeReplay = model.callCount;
    await expect(handler({
      requestId: publicOrderPause.requestId,
      decision: 'approve',
      approvalCapability: publicOrderPause.approvalCapability,
    })).resolves.toMatchObject({
      status: 409,
      body: { errorCode: 'approval_capability_replayed' },
    });
    await expect(handler({
      requestId: orderBody.result.requestId,
      decision: 'approve',
      approvalCapability: orderBody.result.approvalCapability,
    })).resolves.toMatchObject({
      status: 409,
      body: { errorCode: 'approval_capability_replayed' },
    });
    expect(model.callCount).toBe(providerCallsBeforeReplay);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);

    const providerCallsBeforeExpiry = model.callCount;
    vi.useFakeTimers({
      now: new Date(
        Date.parse(publicOrderPause.expiresAt) + 1,
      ),
    });
    try {
      await expect(handler({
        requestId: publicOrderPause.requestId,
        decision: 'approve',
        approvalCapability: publicOrderPause.approvalCapability,
      })).resolves.toMatchObject({
        status: 410,
        body: { errorCode: 'approval_capability_expired' },
      });
    } finally {
      vi.useRealTimers();
    }
    expect(model.callCount).toBe(providerCallsBeforeExpiry);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);

    await expect(store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 2,
      agentMode: 'human_paused',
      assignedAgentId: 'guest-production-human',
    })).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 3 },
    });
    await expect(store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 3,
      agentMode: 'ai_active',
      assignedAgentId: null,
    })).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 4 },
    });
    const providerCallsBeforeOldCapabilities = model.callCount;
    for (const oldCapability of [
      {
        requestId: publicOrderPause.requestId,
        approvalCapability:
          publicOrderPause.approvalCapability,
      },
      {
        requestId: orderBody.result.requestId,
        approvalCapability:
          orderBody.result.approvalCapability,
      },
    ]) {
      await expect(handler({
        ...oldCapability,
        decision: 'approve',
      })).resolves.toMatchObject({
        status: 404,
        body: { errorCode: 'confirmation_not_found' },
      });
    }
    expect(model.callCount).toBe(providerCallsBeforeOldCapabilities);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);
  });
});

async function requiredPauseSnapshot(
  store: MemoryStore,
  requestId: string,
) {
  const snapshot =
    await store.getConfirmationPauseStorageSnapshot(requestId);
  if (!snapshot) throw new Error('test_confirmation_pause_missing');
  return snapshot;
}

async function seedCheckoutState(input: {
  store: MemoryStore;
  sessionId: string;
  customerId: string;
  fixtures: ReturnType<typeof createTestFixtures>;
  now: Date;
}): Promise<void> {
  const cart = {
    id: 'guest-production-cart',
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
  await input.store.appendEvent(
    input.sessionId,
    'graph:verified_state',
    {
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
              sourceFile:
                'guest-production-confirmation-resume.test.ts',
            },
          },
        },
        orderPreview: {
          id: 'KFC-MOCK-GUEST-PREVIEW',
          cart,
          status: 'previewed',
          paymentStatus: 'not_started',
          assignedStoreId: 'KFCVN0002',
          createdAt: input.now.toISOString(),
        },
        exactCartAvailabilityObservation: {
          schemaVersion:
            'kfc-exact-cart-availability-observation-v2',
          observationId: 'guest-production-availability',
          cartRevision: await exactCartAvailabilityRevision(cart),
          storeId: 'KFCVN0002',
          disposition: 'delivery',
          inventoryProviderRevision: {
            authority: 'inventory_availability',
            revision: await mockInventoryProviderRevision({
              fixtures: input.fixtures,
              profile: {},
            }),
          },
          observedAt: input.now.toISOString(),
          expiresAt:
            new Date(input.now.getTime() + 5 * 60_000).toISOString(),
          complete: true,
          rows: [{
            itemCode: '20751',
            quantity: 1,
            status: 'available',
          }],
        },
        toolTrace: [],
      },
    },
  );
}
