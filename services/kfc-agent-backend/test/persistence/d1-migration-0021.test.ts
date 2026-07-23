import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { schemaStatements } from '../../src/persistence/d1StoreSupport.js';

interface ColumnRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function columns(database: DatabaseSync): ColumnRow[] {
  return database
    .prepare(`PRAGMA table_info(conversation_turns)`)
    .all() as unknown as ColumnRow[];
}

describe('D1 migration 0021', () => {
  it('upgrades existing turns to the exact non-null fresh ordinal schema', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      for (const migration of [
        '0001_worker_runtime.sql',
        '0002_conversation_profiles_and_metadata.sql',
        '0004_dashboard_read_indexes.sql',
      ]) {
        database.exec(
          await readFile(resolve('migrations', migration), 'utf8'),
        );
      }
      database.exec(`
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id,
          external_user_id, delivery_status, metadata, created_at
        ) VALUES
          ('turn-b', 'session-a', 'kfc', 'assistant', 'b', NULL, NULL, 'sent', NULL, '2026-07-01T00:00:00.000Z'),
          ('turn-a', 'session-a', 'kfc', 'user', 'a', NULL, NULL, 'received', NULL, '2026-07-01T00:00:00.000Z'),
          ('turn-c', 'session-b', 'kfc', 'user', 'c', NULL, NULL, 'received', NULL, '2026-07-02T00:00:00.000Z');
        CREATE TABLE turn_child (
          turn_id TEXT NOT NULL REFERENCES conversation_turns(id)
        );
        INSERT INTO turn_child (turn_id) VALUES ('turn-a');
      `);

      database.exec(
        await readFile(
          resolve('migrations/0021_conversation_context_state.sql'),
          'utf8',
        ),
      );

      const fresh = new DatabaseSync(':memory:');
      try {
        for (const statement of schemaStatements) fresh.exec(statement);
        expect(columns(database)).toEqual(columns(fresh));
        expect(
          fresh
            .prepare(`PRAGMA index_list(conversation_turns)`)
            .all()
            .map((row) => Reflect.get(row, 'name')),
        ).toContain('conversation_turns_session_ordinal_idx');
      } finally {
        fresh.close();
      }
      expect(
        database
          .prepare(
            `SELECT id, session_id AS sessionId, ordinal
             FROM conversation_turns ORDER BY session_id, ordinal`,
          )
          .all(),
      ).toEqual([
        { id: 'turn-a', sessionId: 'session-a', ordinal: 1 },
        { id: 'turn-b', sessionId: 'session-a', ordinal: 2 },
        { id: 'turn-c', sessionId: 'session-b', ordinal: 1 },
      ]);
      expect(
        database
          .prepare(`PRAGMA foreign_key_list(turn_child)`)
          .all()
          .map((row) => Reflect.get(row, 'table')),
      ).toEqual(['conversation_turns']);
      expect(database.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
      expect(() =>
        database.exec(`
          INSERT INTO conversation_turns (
            id, session_id, ordinal, channel, role, text,
            delivery_status, created_at
          ) VALUES ('turn-null', 'session-a', NULL, 'kfc', 'user', 'x',
                    'received', '2026-07-03T00:00:00.000Z')
        `),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});
