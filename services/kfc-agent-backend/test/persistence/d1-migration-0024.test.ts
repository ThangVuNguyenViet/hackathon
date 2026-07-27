import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const digest = 'a'.repeat(64);

describe('D1 migration 0024', () => {
  it('creates the durable recommendation reservation, decision, and event schema', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        await readFile(
          resolve('migrations/0024_recommendation_events.sql'),
          'utf8',
        ),
      );

      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name LIKE 'recommendation_%'
             ORDER BY name`,
          )
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual([
        'recommendation_decisions',
        'recommendation_events',
        'recommendation_request_reservations',
      ]);
      expect(
        database
          .prepare(`PRAGMA table_info(recommendation_request_reservations)`)
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual([
        'session_id',
        'idempotency_key',
        'request_id',
        'request_fingerprint',
        'status',
        'owner_token',
        'response_json',
        'technical_json',
        'recommendation_id',
        'created_at',
        'completed_at',
      ]);
      expect(
        database
          .prepare(`PRAGMA table_info(recommendation_decisions)`)
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual([
        'recommendation_id',
        'request_id',
        'order_flow_id',
        'session_id',
        'placement',
        'response_json',
        'technical_json',
        'action_digest',
        'request_fingerprint',
        'state_revision_before',
        'state_revision_after',
        'recorded_at',
      ]);
      expect(
        database
          .prepare(`PRAGMA table_info(recommendation_events)`)
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual([
        'event_id',
        'event_fingerprint',
        'schema_version',
        'event_type',
        'recommendation_id',
        'request_id',
        'order_flow_id',
        'session_id',
        'placement',
        'occurred_at',
        'recorded_at',
        'actor',
        'action_id',
        'cart_revision',
        'version_bindings_json',
        'payload_json',
      ]);
    } finally {
      database.close();
    }
  });

  it('enforces accepted indexes and strict durable-row constraints', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        await readFile(
          resolve('migrations/0024_recommendation_events.sql'),
          'utf8',
        ),
      );

      const indexes = database
        .prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'recommendation_events'
           ORDER BY name`,
        )
        .all();
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sql: expect.stringContaining(
              '(order_flow_id, occurred_at, event_id)',
            ),
          }),
          expect.objectContaining({
            sql: expect.stringContaining(
              '(recommendation_id, occurred_at, event_id)',
            ),
          }),
          expect.objectContaining({
            sql: expect.stringContaining(
              '(session_id, occurred_at, event_id)',
            ),
          }),
        ]),
      );

      const insertReservation = database.prepare(
        `INSERT INTO recommendation_request_reservations (
           session_id, idempotency_key, request_id, request_fingerprint,
           status, owner_token, response_json, technical_json,
           recommendation_id, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      );
      expect(() =>
        insertReservation.run(
          'session-a',
          'idempotency-a',
          'request-a',
          digest.toUpperCase(),
          'pending',
          'owner-a',
          '2026-07-27T09:00:00Z',
        ),
      ).toThrow();
      expect(() =>
        insertReservation.run(
          'session-a',
          'idempotency-a',
          'request-a',
          digest,
          'unknown',
          'owner-a',
          '2026-07-27T09:00:00Z',
        ),
      ).toThrow();

      expect(() =>
        database
          .prepare(
            `INSERT INTO recommendation_decisions (
               recommendation_id, request_id, order_flow_id, session_id,
               placement, response_json, technical_json, action_digest,
               request_fingerprint, state_revision_before,
               state_revision_after, recorded_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'recommendation-a',
            'request-a',
            'order-flow-a',
            'session-a',
            'for_you',
            '{}',
            '{}',
            digest,
            digest,
            2,
            2,
            '2026-07-27T09:00:00Z',
          ),
      ).toThrow();

      expect(() =>
        database
          .prepare(
            `INSERT INTO recommendation_events (
               event_id, event_fingerprint, schema_version, event_type,
               recommendation_id, request_id, order_flow_id, session_id,
               placement, occurred_at, recorded_at, actor, action_id,
               cart_revision, version_bindings_json, payload_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'event-a',
            digest,
            'wrong-version',
            'decision_completed',
            'recommendation-a',
            'request-a',
            'order-flow-a',
            'session-a',
            'for_you',
            '2026-07-27T09:00:00Z',
            '2026-07-27T09:00:01Z',
            'system',
            null,
            'cart-revision-a',
            '{}',
            '{}',
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
