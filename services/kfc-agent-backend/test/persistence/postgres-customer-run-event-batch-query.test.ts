import { describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../src/persistence/postgresStore.js';

describe('PostgresStore customer-run event batches', () => {
  it('casts VALUES parameters to their destination column types', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          event_id: 'event_1',
          run_id: 'run_1',
          sequence: 1,
          schema_version: 1,
          type: 'run_started',
          occurred_at: '2026-07-23T00:00:00.000Z',
          payload: {},
        },
      ],
    });
    const store = new PostgresStore({ query } as never);

    await store.appendCustomerRunEvents([
      {
        eventId: 'event_1',
        runId: 'run_1',
        expectedSequence: 1,
        schemaVersion: 1,
        type: 'run_started',
        occurredAt: '2026-07-23T00:00:00.000Z',
        payload: {},
      },
    ]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('$7::integer');
    expect(sql).toContain('$8::integer');
    expect(sql).toContain('$10::timestamptz');
    expect(sql).toContain('$11::jsonb');
  });
});
