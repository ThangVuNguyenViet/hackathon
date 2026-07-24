import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('D1 migration 0023', () => {
  it('adds a nullable binding so legacy sessions pin on their next turn', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE session_agent_state (
          session_id TEXT PRIMARY KEY,
          current_run_id TEXT,
          generation INTEGER NOT NULL,
          debounce_deadline_at TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO session_agent_state (
          session_id, current_run_id, generation, debounce_deadline_at,
          updated_at
        ) VALUES (
          'legacy-session', NULL, 4, NULL, '2026-07-24T00:00:00.000Z'
        );
      `);

      database.exec(
        await readFile(
          resolve('migrations/0023_session_agent_model_binding.sql'),
          'utf8',
        ),
      );

      expect(
        database
          .prepare(
            `SELECT generation, agent_model_binding_json AS binding
             FROM session_agent_state WHERE session_id = 'legacy-session'`,
          )
          .get(),
      ).toEqual({ generation: 4, binding: null });
      expect(
        database
          .prepare(`PRAGMA table_info(session_agent_state)`)
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toContain('agent_model_binding_json');
    } finally {
      database.close();
    }
  });
});
