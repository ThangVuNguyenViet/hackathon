import { describe, expect, it, vi } from 'vitest';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import {
  createKfcLangChainTools,
  type KfcCoreToolReceipt,
  type KfcPendingConfirmation,
} from '../../src/businesses/kfc/tools.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(): AgentGraphState {
  return {
    sessionId: 'kfc:tools',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'Tìm món',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

describe('KFC LangChain tools', () => {
  it('reuses every canonical commerce schema and delegates a validated read', async () => {
    const receipts: KfcCoreToolReceipt[] = [];
    const executeTool = vi.fn(async () => ({
      evidenceId: 'menu:verified',
      result: { ok: true, message: 'verified' },
    }));
    const tools = createKfcLangChainTools({
      state: state(),
      executeTool,
      receipts,
      setPendingConfirmation: vi.fn(),
    });
    const expected = new Map(
      commerceToolDefinitions().map(({ name, schema }) => [name, schema]),
    );

    for (const registered of tools) {
      expect(registered.schema).toEqual(expected.get(registered.name));
    }
    await tools
      .find(({ name }) => name === 'searchMenu')!
      .invoke({ scope: 'filtered', query: 'combo' });

    expect(executeTool).toHaveBeenCalledOnce();
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'searchMenu',
        effect: 'provider_read',
        status: 'success',
        evidenceId: 'menu:verified',
      }),
    ]);
  });

  it('does not dispatch an irreversible call before application confirmation', async () => {
    const receipts: KfcCoreToolReceipt[] = [];
    const pending: KfcPendingConfirmation[] = [];
    const executeTool = vi.fn();
    const tools = createKfcLangChainTools({
      state: state(),
      executeTool,
      receipts,
      setPendingConfirmation: (value) => pending.push(value),
    });

    await tools.find(({ name }) => name === 'placeOrder')!.invoke({});

    expect(executeTool).not.toHaveBeenCalled();
    expect(pending).toEqual([
      {
        action: expect.objectContaining({
          toolName: 'placeOrder',
          arguments: {},
        }),
      },
    ]);
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'placeOrder',
        effect: 'irreversible_mutation',
        status: 'confirmation_required',
      }),
    ]);
  });
});
