import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
  type MessengerHistoryClient,
} from '../../src/channels/messengerHistory.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('Messenger history sync admin API', () => {
  it('runs a manual sync and exposes status without sending agent replies', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const client: MessengerHistoryClient = {
      async fetchConversations(options) {
        expect(options).toEqual({ limitConversations: 1, since: '2026-07-01T00:00:00.000Z' });
        return [
          {
            id: 'conv_1',
            participantIds: ['page_1', 'psid_1'],
            updatedTime: null,
            messages: [
              {
                id: 'mid_1',
                text: 'Lịch sử trước đó',
                fromId: 'psid_1',
                toIds: ['page_1'],
                createdTime: '2026-07-08T08:00:00.000Z',
                raw: { id: 'mid_1' },
              },
            ],
          },
        ];
      },
    };
    const messengerHistorySync = new MessengerHistorySyncCoordinator(
      new MessengerHistorySyncService({ pageId: 'page_1', store, dashboard, client }),
    );
    const server = buildServer({ store, dashboard, messengerHistorySync });

    const syncResponse = await server.inject({
      method: 'POST',
      url: '/admin/messenger/sync-history',
      payload: { limitConversations: 1, since: '2026-07-01T00:00:00.000Z' },
    });
    expect(syncResponse.statusCode).toBe(200);
    expect(syncResponse.json()).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
      messagesSkipped: 0,
    });

    const statusResponse = await server.inject({ method: 'GET', url: '/admin/messenger/sync-history/status' });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      running: false,
      lastError: null,
      lastResult: {
        conversationsScanned: 1,
        messagesImported: 1,
        messagesSkipped: 0,
      },
    });

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/messenger:psid_1/turns' });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Lịch sử trước đó',
        externalMessageId: 'mid_1',
      }),
    ]);
  });
});
