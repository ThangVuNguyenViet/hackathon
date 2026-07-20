import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createConfirmationResumeCoordinator,
  type ConfirmationResumeResponse,
} from '../../src/api/confirmationResumeAuthority.js';
import {
  persistCanonicalConfirmationPause,
} from '../../src/api/confirmationPausePersistence.js';
import {
  createConversationStoreConfirmationResumeRepository,
} from '../../src/api/confirmationResumeRepository.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  runAgentTurn,
  type AgentTurnInput,
} from '../fixtures/runAgentTurn.js';
import type {
  AgentTurnOutput,
} from '../../src/graph/agentTurnState.js';
import { toolExecutionContext } from '../../src/graph/turnSupport.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  buildCurrentAgentApprovalBinding,
} from '../../src/ordering/agentToolExecutor.js';
import { D1CheckpointSaver } from '../../src/persistence/d1CheckpointSaver.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import type { RunCommitFence } from '../../src/persistence/contracts.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const confirmationSigningSecret =
  'native-confirmation-test-secret-at-least-32-bytes';

function orderConfirmationModel() {
  const model = fakeModel()
    .respondWithTools([
      {
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'Combo Hợp Gu 99K',
        },
      },
      {
        name: 'findStores',
        args: {
          query: 'Big C Đồng Nai',
          city: 'Đồng Nai',
          district: 'Biên Hòa',
        },
      },
    ])
    .respondWithTools([{
      name: 'updateCart',
      args: {
        changes: [{
          itemCode: '20751',
          quantity: 1,
          modifiers: [],
        }],
      },
    }])
    .respondWithTools([{
      name: 'quoteFulfillment',
      args: {
        method: 'delivery',
        address: {
          label: 'Big C Đồng Nai',
          line1: 'Big C Đồng Nai',
          district: 'Biên Hòa',
          city: 'Đồng Nai',
        },
      },
    }])
    .respondWithTools([{
      name: 'checkStoreAvailability',
      args: {
        storeId: 'KFCVN0002',
        disposition: 'delivery',
      },
    }])
    .respond(groundedResponseModelReply({
      customerText: 'The verified cart and delivery details are ready.',
    }))
    .respondWithTools([{
      name: 'previewOrder',
      args: {},
    }])
    .respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);

  // A reclaimed execution can finish before the stale execution returns.
  // Give each resumed graph its own model-authored final response.
  for (let index = 0; index < 3; index += 1) {
    model.respond(groundedResponseModelReply({
      customerText: 'The verified order was created.',
    }));
  }
  return model;
}

interface ResumeResult {
  response: ConfirmationResumeResponse;
  output?: AgentTurnOutput;
}

async function readyConfirmation(
  profile: { unavailableItemCodes?: string[] } = {},
) {
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const dashboard = new DashboardEventBus();
  const clients = createMockClients(createTestFixtures(), {
    mockedUpstreamApiProvider: () => profile,
    fulfillmentQuoteProvider: async (input) => ({
      ok: true,
      value: {
        storeId: input.storeId,
        feeVnd: 18_000,
        etaMinutes: 25,
      },
      message: 'quoted',
    }),
  });
  let placeOrderCalls = 0;
  const placeOrder = clients.oms.placeOrder.bind(clients.oms);
  clients.oms.placeOrder = async (...args) => {
    placeOrderCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return placeOrder(...args);
  };

  const sessionId = 'native-confirmation';
  const customerId = 'customer-1';
  const accessContext = controlledCustomerAccess({
    sessionId,
    customerId,
  });
  const checkpointer = new D1CheckpointSaver(db);
  const model = orderConfirmationModel();
  const common = {
    sessionId,
    customerId,
    channel: 'kfc' as const,
    clients,
    store,
    dashboard,
    checkpointer,
    accessContext,
    agentModel: model,
    responseVerifierModel: groundedResponseVerifierModel(),
  };
  await runAgentTurn({
    ...common,
    text:
      'Cho mình Combo Hợp Gu 99K giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
    externalMessageId: 'prepare-1',
  });

  const base: AgentTurnInput = {
    ...common,
    text: 'Xác nhận đơn',
    externalMessageId: 'confirm-1',
    metadata: { customerCommand: { kind: 'confirm_order' } },
  };
  const paused = await runAgentTurn(base);
  expect(paused).toMatchObject({
    status: 'paused',
    pause: {
      capability: 'placeOrder',
      requestId: expect.any(String),
      action: { toolName: 'placeOrder', arguments: {} },
    },
  });
  expect(paused.state.userConfirmedOrder).toBe(false);
  expect(placeOrderCalls).toBe(0);
  await persistCanonicalConfirmationPause({
    store,
    sessionId,
    customerId,
    channel: 'kfc',
    pause: paused.pause!,
    accessContext,
    checkpointer,
  });

  const repository =
    createConversationStoreConfirmationResumeRepository(store, {
      pollIntervalMs: 1,
    });
  const resume = async (): Promise<ResumeResult> => {
    let output: AgentTurnOutput | undefined;
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret: confirmationSigningSecret,
      accessContext: async () => accessContext,
      revalidate: async (expectedPause, externalCallContext) => {
        const binding = await buildCurrentAgentApprovalBinding(
          clients,
          expectedPause.action,
          {
            ...toolExecutionContext(base),
            approval: { principal: expectedPause.principal },
            externalCallContext,
            state: paused.state,
            cart: paused.state.cart,
            address: paused.state.address,
            order: paused.state.order,
            orderPreview: paused.state.orderPreview,
          },
        );
        return {
          ok:
            !('ok' in binding) &&
            await digestCommerceAction(binding) ===
              expectedPause.approvalBindingDigest,
        };
      },
      execute: async (execution) => {
        const resumeFence: RunCommitFence = {
          kind: 'operation_lease',
          requestId: execution.pause.requestId,
          operation: 'confirmation_resume',
          bindingFingerprint:
            execution.executionFence.bindingFingerprint,
          attempt: execution.attempt,
          leaseToken: execution.executionFence.leaseToken,
          sessionAuthorityGeneration:
            execution.executionFence.sessionAuthorityGeneration,
        };
        const isCurrent = () =>
          store.isRunCommitFenceCurrent({
            sessionId,
            fence: resumeFence,
            notAfter: execution.pause.expiresAt,
          });
        output = await runAgentTurn({
          ...base,
          checkpointer: new D1CheckpointSaver(db),
          runGuard: {
            isCurrent,
            commitFence: resumeFence,
          },
          confirmationResume: {
            requestId: execution.pause.requestId,
            approved: execution.receipt.decision === 'approve',
            action: execution.pause.action,
            checkpoint: execution.checkpoint,
            commerceReceipt: execution.receipt,
            executionFence: execution.executionFence,
            signingSecret: execution.signingSecret,
            externalCallContext: execution.externalCallContext,
            abortExternalCalls: execution.abortExternalCalls,
          },
        });
        return {
          actionOutcome: output.state.order ? 'succeeded' : 'failed',
          continuation: 'turn_completed',
          requestId: execution.pause.requestId,
          responseText: output.responseText,
          orderId: output.state.order?.id ?? null,
        };
      },
      pendingWaitMs: 1_000,
    });
    const response = await coordinator({
      requestId: paused.pause!.requestId,
      decision: 'approve',
    });
    return { response, output };
  };

  return {
    base,
    db,
    paused,
    profile,
    resume,
    store,
    placeOrderCalls: () => placeOrderCalls,
  };
}

describe('native confirm_order interrupt', () => {
  it('resumes from a new graph instance and replays one result for concurrent duplicate resumes', async () => {
    const fixture = await readyConfirmation();
    const [left, right] = await Promise.all([
      fixture.resume(),
      fixture.resume(),
    ]);

    expect(fixture.placeOrderCalls()).toBe(1);
    expect(left.response).toEqual(right.response);
    expect(left.response).toMatchObject({
      status: 200,
      body: {
        status: 'completed',
        result: {
          actionOutcome: 'succeeded',
          orderId: expect.any(String),
        },
      },
    });
    const executed = left.output ?? right.output;
    expect(executed?.state.order).toMatchObject({ status: 'created' });
  });

  it('reclaims an expired long call without applying its late stale result', async () => {
    const fixture = await readyConfirmation();
    let providerCalls = 0;
    let enteredFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    fixture.base.clients.oms.placeOrder = async (
      input,
      _externalCallContext,
      _mutationIdentity,
    ) => {
      providerCalls += 1;
      const call = providerCalls;
      if (call === 1) {
        enteredFirst();
        await firstRelease;
      }
      return {
        ok: true,
        value: {
          ...input.preview,
          id: `ORDER-${call}`,
          status: 'created',
        },
        message: `placed-${call}`,
      };
    };

    const first = fixture.resume();
    await firstEntered;
    const row = fixture.db.tables.irreversible_operations.find(
      (candidate) =>
        candidate.request_id === fixture.paused.pause!.requestId,
    )!;
    row.lease_expires_at = '2000-01-01T00:00:00.000Z';
    const second = await fixture.resume();
    releaseFirst();
    const late = await first;

    expect(second.response.status).toBe(200);
    expect(providerCalls).toBe(2);
    expect(second.output?.state.order?.id).toBe('ORDER-2');
    expect(late.output).toBeUndefined();
    expect(late.response).toEqual(second.response);
    expect(row.status).toBe('completed');
    expect(JSON.parse(String(row.result_json)).orderId).toBe('ORDER-2');
  });

  it('reconciles an unknown provider outcome with the same downstream idempotency identity', async () => {
    const fixture = await readyConfirmation();
    const delegate = fixture.base.clients.oms.placeOrder.bind(
      fixture.base.clients.oms,
    );
    const downstreamRequestIds: string[] = [];
    let disconnect = true;
    fixture.base.clients.oms.placeOrder = async (...args) => {
      downstreamRequestIds.push(args[2].idempotencyKey);
      if (disconnect) {
        disconnect = false;
        throw new Error('connection_lost_after_submit');
      }
      return delegate(...args);
    };

    const unknown = await fixture.resume();
    expect(unknown.response).toEqual({
      status: 503,
      body: { errorCode: 'confirmation_outcome_unknown' },
    });
    const recovered = await fixture.resume();

    expect(recovered.response.status).toBe(200);
    expect(recovered.output?.state.order).toMatchObject({
      status: 'created',
    });
    expect(downstreamRequestIds).toHaveLength(2);
    expect(downstreamRequestIds[0]).toBe(downstreamRequestIds[1]);
  });

  it('fails closed before placeOrder when the provider binding changes while paused', async () => {
    const profile: { unavailableItemCodes?: string[] } = {};
    const fixture = await readyConfirmation(profile);
    profile.unavailableItemCodes = ['20751'];
    const result = await fixture.resume();

    expect(result.response).toEqual({
      status: 409,
      body: { errorCode: 'confirmation_binding_stale' },
    });
    expect(result.output).toBeUndefined();
    expect(fixture.placeOrderCalls()).toBe(0);
  });

  it('fails closed when trusted environment or scenario authority no longer matches the checkpoint', async () => {
    const fixture = await readyConfirmation();
    fixture.base.clients.confirmationAuthority!.scenarioId =
      'other-scenario';
    const result = await fixture.resume();

    expect(result.response).toEqual({
      status: 409,
      body: { errorCode: 'confirmation_binding_stale' },
    });
    expect(result.output).toBeUndefined();
    expect(fixture.placeOrderCalls()).toBe(0);
  });
});
