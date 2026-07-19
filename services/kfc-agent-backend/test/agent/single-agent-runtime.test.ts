import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { AppendConversationTurnInput } from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function turnInput(model: ReturnType<typeof fakeModel>, sessionId: string) {
  return {
    sessionId,
    customerId: 'single-agent-customer',
    channel: 'kfc' as const,
    text: 'Help with my KFC order',
    externalMessageId: `${sessionId}-message`,
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    checkpointer: new MemorySaver(),
    agentModel: model,
  };
}

class InterleavingMemoryStore extends MemoryStore {
  private releaseFirstPersisted!: () => void;
  private releaseSecondPersisted!: () => void;
  private readonly firstPersisted = new Promise<void>((resolve) => {
    this.releaseFirstPersisted = resolve;
  });
  private readonly secondPersisted = new Promise<void>((resolve) => {
    this.releaseSecondPersisted = resolve;
  });

  override async appendTurn(input: AppendConversationTurnInput) {
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-second'
    ) {
      await this.firstPersisted;
    }
    const turn = await super.appendTurn(input);
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-first'
    ) {
      this.releaseFirstPersisted();
      await this.secondPersisted;
    }
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-second'
    ) {
      this.releaseSecondPersisted();
    }
    return turn;
  }
}

function recordedPrompt(model: ReturnType<typeof fakeModel>): string {
  return model.calls[0]?.messages.map((message) => message.text).join('\n') ?? '';
}

describe('single maintained KFC agent runtime', () => {
  it('uses one provider call for a tool-less turn', async () => {
    const model = fakeModel().respond(new AIMessage('I can help with that.'));

    const output = await runAgentTurn(turnInput(model, 'single-agent-one-call'));

    expect(output.responseText).toBe('I can help with that.');
    expect(model.callCount).toBe(1);
  });

  it('normally uses two provider calls when one tool is needed', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { query: 'combo' },
      }])
      .respond(new AIMessage('I found verified menu options.'));

    const output = await runAgentTurn(turnInput(model, 'single-agent-two-call'));

    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
    expect(output.responseText).toBe('I found verified menu options.');
    expect(model.callCount).toBe(2);
  });

  it('allows one semantic correction and then continues', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'getItemDetails',
        args: { code: '' },
      }])
      .respondWithTools([{
        name: 'searchMenu',
        args: { query: 'burger' },
      }])
      .respond(new AIMessage('I corrected the lookup using verified results.'));

    const output = await runAgentTurn(
      turnInput(model, 'single-agent-one-correction'),
    );

    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
    expect(model.callCount).toBe(3);
  });

  it('fails closed on a second semantic correction', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'getItemDetails',
        args: { code: '' },
      }])
      .respondWithTools([{
        name: 'getModifierOptions',
        args: { code: '' },
      }]);

    await expect(
      runAgentTurn(turnInput(model, 'single-agent-two-corrections')),
    ).rejects.toThrow('agent_semantic_correction_limit_exceeded');
    expect(model.callCount).toBe(2);
  });

  it('never makes a seventh provider call', async () => {
    const model = fakeModel();
    for (let call = 0; call < 7; call += 1) {
      model.respondWithTools([{
        name: 'searchMenu',
        args: { query: `query-${call}` },
      }]);
    }

    await expect(
      runAgentTurn(turnInput(model, 'single-agent-six-call-limit')),
    ).rejects.toThrow(/model call limit/i);
    expect(model.callCount).toBe(6);
  });

  it('uses maintained HITL and emits an exact action/revision binding', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);
    const input = turnInput(model, 'single-agent-hitl');

    const output = await runAgentTurn(input);

    expect(output).toMatchObject({
      status: 'paused',
      pause: {
        capability: 'placeOrder',
        requestId: expect.any(String),
        action: { toolName: 'placeOrder', arguments: {} },
        approvalBinding: {
          sessionId: input.sessionId,
          customerId: input.customerId,
          channel: input.channel,
          actionDigest: expect.any(String),
          verifiedStateRevision: expect.any(String),
          providerBinding: {
            requestId: expect.any(String),
            cartRevision: expect.any(String),
            fulfillmentRevision: expect.any(String),
            paymentRevision: expect.any(String),
            providerRevision: expect.any(String),
          },
          providerRevision: expect.any(String),
          expiresAt: expect.any(String),
        },
      },
    });
    expect(model.callCount).toBe(1);
  });

  it('rejects legacy boolean approval in the maintained runtime', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);
    const input = turnInput(model, 'single-agent-legacy-approval');
    const paused = await runAgentTurn(input);

    await expect(runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: paused.pause!.requestId,
        approved: true,
      },
    })).rejects.toThrow('authenticated_agent_approval_receipt_required');
    expect(model.callCount).toBe(1);
  });

  it('fails closed instead of approving a multi-action interrupt bundle', async () => {
    const model = fakeModel().respondWithTools([
      { name: 'placeOrder', args: {} },
      { name: 'createPaymentLink', args: { method: 'momo' } },
    ]);

    await expect(
      runAgentTurn(turnInput(model, 'single-agent-multi-action-hitl')),
    ).rejects.toThrow('agent_approval_interrupt_invalid');
    expect(model.callCount).toBe(1);
  });

  it('keeps concurrent approval checkpoints isolated by request', async () => {
    const sessionId = 'single-agent-concurrent-approvals';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const dashboard = new DashboardEventBus();
    const orderModel = fakeModel()
      .respondWithTools([{ name: 'placeOrder', args: {} }])
      .respond(new AIMessage('Order creation cancelled.'));
    const handoffModel = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(new AIMessage('Human handoff cancelled.'));
    const orderInput = {
      ...turnInput(orderModel, sessionId),
      text: 'Submit my order',
      externalMessageId: 'concurrent-order',
      store,
      checkpointer,
      clients,
      dashboard,
    };
    const handoffInput = {
      ...turnInput(handoffModel, sessionId),
      text: 'Please connect me to support',
      externalMessageId: 'concurrent-handoff',
      store,
      checkpointer,
      clients,
      dashboard,
    };

    const [orderPause, handoffPause] = await Promise.all([
      runAgentTurn(orderInput),
      runAgentTurn(handoffInput),
    ]);
    expect(orderPause.pause?.capability).toBe('placeOrder');
    expect(handoffPause.pause?.capability).toBe('handoff');
    expect(orderPause.pause?.requestId).not.toBe(handoffPause.pause?.requestId);

    const resumeRejected = async (
      input: typeof orderInput,
      binding: NonNullable<typeof orderPause.pause>['approvalBinding'],
    ) => runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: binding!.requestId,
        approved: false,
        receipt: {
          ...binding!,
          principalId: 'authenticated-customer',
          decision: 'reject',
        },
      },
    });
    const orderOutput = await resumeRejected(
      orderInput,
      orderPause.pause!.approvalBinding,
    );
    const handoffOutput = await resumeRejected(
      handoffInput,
      handoffPause.pause!.approvalBinding,
    );
    expect(orderOutput.responseText).toBe('Order creation cancelled.');
    expect(handoffOutput.responseText).toBe('Human handoff cancelled.');
  });

  it('revalidates the exact provider binding before a rejection resume', async () => {
    const model = fakeModel()
      .respondWithTools([{ name: 'placeOrder', args: {} }])
      .respond(new AIMessage('I left the order unsubmitted.'));
    const input = turnInput(model, 'single-agent-reject-revalidation');
    const paused = await runAgentTurn(input);
    const binding = paused.pause!.approvalBinding!;
    const authority = input.clients.confirmationAuthority!;
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    input.clients.confirmationAuthority = { ...authority, revalidate };

    const output = await runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: binding.requestId,
        approved: false,
        receipt: {
          ...binding,
          principalId: 'authenticated-customer',
          decision: 'reject',
        },
      },
    });

    expect(output.responseText).toBe('I left the order unsubmitted.');
    expect(revalidate).toHaveBeenCalledExactlyOnceWith(
      binding.providerBinding,
    );
    expect(model.callCount).toBe(2);
  });

  it('rejects a stale provider binding before either approval decision resumes', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);
    const input = turnInput(model, 'single-agent-stale-provider-binding');
    const paused = await runAgentTurn(input);
    const binding = paused.pause!.approvalBinding!;
    const authority = input.clients.confirmationAuthority!;
    const revalidate = vi.fn(async () => ({
      ok: false,
      reason: 'provider changed',
    }));
    input.clients.confirmationAuthority = { ...authority, revalidate };

    await expect(runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: binding.requestId,
        approved: false,
        receipt: {
          ...binding,
          principalId: 'authenticated-customer',
          decision: 'reject',
        },
      },
    })).rejects.toThrow('agent_approval_receipt_binding_mismatch');
    expect(revalidate).toHaveBeenCalledExactlyOnceWith(
      binding.providerBinding,
    );
    expect(model.callCount).toBe(1);
  });

  it('rejects a receipt with a non-date expiry before resuming the model', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);
    const input = turnInput(model, 'single-agent-invalid-receipt-expiry');
    const paused = await runAgentTurn(input);
    const binding = paused.pause!.approvalBinding!;

    await expect(runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: binding.requestId,
        approved: true,
        receipt: {
          ...binding,
          principalId: 'authenticated-customer',
          decision: 'approve',
          expiresAt: 'not-a-date',
        },
      },
    })).rejects.toThrow('agent_approval_receipt_binding_mismatch');
    expect(model.callCount).toBe(1);
  });

  it('does not send trusted structured UI actions back through the model', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));

    await expect(runAgentTurn({
      ...turnInput(model, 'single-agent-structured-action'),
      metadata: {
        customerCommand: { kind: 'confirm_order' },
      },
    })).rejects.toThrow('authenticated_structured_action_executor_required');
    expect(model.callCount).toBe(0);
  });

  it('isolates each concurrent prompt at its exact persisted customer turn', async () => {
    const sessionId = 'single-agent-concurrent-history';
    const store = new InterleavingMemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const dashboard = new DashboardEventBus();
    const firstModel = fakeModel().respond(new AIMessage('first response'));
    const secondModel = fakeModel().respond(new AIMessage('second response'));
    const firstMarker = 'FIRST_EXACT_MESSAGE_49';
    const secondMarker = 'SECOND_EXACT_MESSAGE_49';

    await Promise.all([
      runAgentTurn({
        ...turnInput(firstModel, sessionId),
        text: firstMarker,
        externalMessageId: 'concurrent-first',
        store,
        checkpointer,
        clients,
        dashboard,
      }),
      runAgentTurn({
        ...turnInput(secondModel, sessionId),
        text: secondMarker,
        externalMessageId: 'concurrent-second',
        store,
        checkpointer,
        clients,
        dashboard,
      }),
    ]);

    const firstPrompt = recordedPrompt(firstModel);
    const secondPrompt = recordedPrompt(secondModel);
    expect(firstPrompt.match(new RegExp(firstMarker, 'g'))).toHaveLength(1);
    expect(firstPrompt).not.toContain(secondMarker);
    expect(secondPrompt.match(new RegExp(firstMarker, 'g'))).toHaveLength(1);
    expect(secondPrompt.match(new RegExp(secondMarker, 'g'))).toHaveLength(1);
  });
});
