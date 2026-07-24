import { describe, expect, it, vi } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';

const externalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

describe('protected commerce tool authority', () => {
  it('fails closed when a caller supplies provider identity without trusted action authority', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const placeOrder = vi.fn(clients.oms.placeOrder);
    const cart = await clients.cart.createCart(
      'authority-test',
      externalCallContext,
    );
    if (!cart.ok || !cart.value) throw new Error('Expected test cart');
    const preview = {
      id: 'preview-authority-test',
      cart: cart.value,
      status: 'previewed' as const,
      paymentStatus: 'not_started' as const,
      assignedStoreId: 'store-1',
      createdAt: '2026-07-24T00:00:00.000Z',
    };

    const result = await executeToolCall(
      { ...clients, oms: { ...clients.oms, placeOrder } },
      { toolName: 'placeOrder', arguments: {} },
      {
        externalCallContext,
        orderPreview: preview,
        providerMutationIdentity: {
          idempotencyKey: 'provider-key',
          bindingFingerprint: 'a'.repeat(64),
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'trusted_action_authority_required',
    });
    expect(placeOrder).not.toHaveBeenCalled();

    const forged = await executeToolCall(
      { ...clients, oms: { ...clients.oms, placeOrder } },
      { toolName: 'placeOrder', arguments: {} },
      {
        externalCallContext,
        sessionId: 'authority-test',
        orderPreview: preview,
        trustedActionAuthority: {
          toolName: 'placeOrder',
          customerConfirmed: true,
        } as never,
        providerMutationIdentity: {
          idempotencyKey: 'forged-provider-key',
          bindingFingerprint: 'd'.repeat(64),
        },
      },
    );
    expect(forged).toMatchObject({
      ok: false,
      errorCode: 'trusted_action_authority_required',
    });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['placeOrder', {}],
    ['createPaymentLink', { methodId: 'payment-method-1' }],
    ['acquireVoucher', { rewardId: 'reward-1' }],
    ['redeemReward', { voucherId: 'voucher-1', channel: 'kfc' }],
    ['resolveHandoff', { escalationId: 'escalation-1' }],
  ] as const)(
    'checks trusted action authority before prerequisites for %s',
    async (toolName, arguments_) => {
      const clients = createMockClients(
        await loadGeneratedFixtures(process.cwd()),
      );
      const result = await executeToolCall(
        clients,
        { toolName, arguments: arguments_ },
        {
          externalCallContext,
          providerMutationIdentity: {
            idempotencyKey: 'provider-key',
            bindingFingerprint: 'b'.repeat(64),
          },
        },
      );

      expect(result).toMatchObject({
        ok: false,
        errorCode: 'trusted_action_authority_required',
      });
    },
  );

  it('does not treat a matching tool name as customer confirmation', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const result = await executeToolCall(
      clients,
      { toolName: 'placeOrder', arguments: {} },
      {
        externalCallContext,
        trustedActionAuthority: { toolName: 'placeOrder' } as never,
        providerMutationIdentity: {
          idempotencyKey: 'provider-key',
          bindingFingerprint: 'c'.repeat(64),
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'trusted_action_authority_required',
    });
  });
});
