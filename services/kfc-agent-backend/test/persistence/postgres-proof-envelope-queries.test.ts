import { describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../src/persistence/postgresStore.js';

describe('Postgres Messenger proof queries', () => {
  it('reads session-scoped webhook deliveries and checkpoint identifiers', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        channel: 'messenger', external_event_id: 'mid-1', external_thread_id: 'thread-1', external_user_id: 'psid-1',
        session_id: 'messenger:psid-1', status: 'processed', payload: {}, received_at: '2026-07-15T00:00:00Z',
        processed_at: '2026-07-15T00:00:01Z', failed_at: null, last_error: null,
        created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:01Z',
      }] })
      .mockResolvedValueOnce({ rows: [{
        thread_id: 'messenger:psid-1',
        checkpoint_ns: '',
        checkpoint_id: 'checkpoint-1',
        parent_checkpoint_id: null,
      }] });
    const store = new PostgresStore({ query } as never);

    await expect(store.listWebhookDeliveries('messenger:psid-1')).resolves.toMatchObject([{ externalEventId: 'mid-1', status: 'processed' }]);
    await expect(store.listCheckpointIdentifiers('messenger:psid-1')).resolves.toEqual([{
      checkpointThreadId: 'messenger:psid-1',
      checkpointNamespace: '',
      checkpointId: 'checkpoint-1',
      parentCheckpointId: null,
    }]);
    expect(query.mock.calls.map(([, values]) => values)).toEqual([
      ['messenger:psid-1'],
      [
        'messenger:psid-1',
        'agent:["messenger:psid-1",',
      ],
    ]);
  });
});
