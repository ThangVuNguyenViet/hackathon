import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { describe, expect, it } from 'vitest';
import { createRouteCommerceRuntime } from '../../src/api/routeCommerceRuntime.js';
import { kfcVietnamPack } from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

const externalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    typeof value.content === 'string'
  ) {
    return value.content;
  }
  throw new Error('Unexpected tool output');
}

describe('first-party demo happy path', () => {
  it('accepts any complete delivery address and preserves what the customer entered', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );

    const result = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: 'Thắng',
          line1: '54/2 Nguyễn Hồng Đào',
          district: 'Phường Tân Bình',
          city: 'Thành phố Hồ Chí Minh',
        },
        method: 'delivery',
        itemCodes: ['20221'],
      },
      externalCallContext,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        resolvedAddress: {
          label: 'Thắng',
          line1: '54/2 Nguyễn Hồng Đào',
          district: 'Phường Tân Bình',
          city: 'Thành phố Hồ Chí Minh',
        },
        availability: { ok: true },
      },
    });
  });

  it('does not let public fixture stock exclusions block an ordinary demo order', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );

    await expect(
      clients.inventory.checkInventory(
        'KFCVN0002',
        ['20221'],
        'delivery',
        externalCallContext,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { '20221': true },
    });
  });

  it('only offers payment methods that the mock checkout can complete', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );

    const methods = await clients.payment.listMethods(
      {},
      externalCallContext,
    );

    expect(methods.ok).toBe(true);
    expect(methods.value).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportStatus: 'not_listed_in_policy' }),
      ]),
    );
  });

  it('completes the default mock online-payment status check', async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );

    await expect(
      clients.payment.checkPaymentStatus(
        'KFC-MOCK-1001',
        externalCallContext,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'paid' },
    });
  });

  it('gives first-party demo chat a customer-bound access context without setup controls', async () => {
    const runtime = createRouteCommerceRuntime({
      options: {},
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    });

    await expect(
      runtime.kfcProofAccessContext('kfc:customer-1', 'customer-1'),
    ).resolves.toMatchObject({
      tenantScope: 'kfc-vietnam',
      customerSurface: 'kfc-app-chat',
      sessionRef: 'kfc:customer-1',
      kfcSubjectRef: 'customer-1',
      authenticationState: 'authenticated',
      subjectBindingState: 'verified',
    });
  });

  it('lets the agent quote an address before the customer has chosen an item', async () => {
    const store = new MemoryStore();
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );

    await kfcVietnamPack.run(
      {
        sessionId: 'session-address-only-quote',
        customerId: 'customer-1',
        channel: 'kfc',
        text: 'Kiểm tra giao hàng giúp tôi',
        clients,
        store,
        dashboard: new DashboardEventBus(),
        agentModelBinding: configuredTestAgent({} as BaseChatModel),
      },
      async ({ tools }) => {
        const quote = tools.find(
          (candidate) => candidate.name === 'quoteFulfillment',
        );
        if (!quote) throw new Error('Missing quoteFulfillment');
        const result = JSON.parse(
          toolOutputText(
            await quote.invoke({
              type: 'tool_call',
              name: 'quoteFulfillment',
              args: {
                address: {
                  label: 'Thắng',
                  line1: '54/2 Nguyễn Hồng Đào',
                  district: 'Phường Tân Bình',
                  city: 'Thành phố Hồ Chí Minh',
                },
                method: 'delivery',
              },
              id: 'quote-address-only',
            }),
          ),
        ) as { ok: boolean; value?: { feeVnd?: number } };

        expect(result).toMatchObject({
          ok: true,
          value: { feeVnd: expect.any(Number) },
        });
        return 'Địa chỉ này giao được.';
      },
    );
  });
});
