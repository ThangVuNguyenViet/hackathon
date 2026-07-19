import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
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
});
