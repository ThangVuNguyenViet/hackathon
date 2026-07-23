import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { schemaStatements } from '../../src/persistence/d1StoreSupport.js';

function tableNames(database: DatabaseSync): string[] {
  return (
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name);
}

describe('D1 migration 0022', () => {
  it('drops the legacy event bag and creates explicit projections on upgrade', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE conversation_events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO conversation_events VALUES (
          'event-a', 'session-a', 'agent:verified_state', '{}',
          '2026-07-24T00:00:00.000Z'
        );
      `);
      database.exec(
        await readFile(
          resolve('migrations/0022_storage_boundary_cleanup.sql'),
          'utf8',
        ),
      );

      expect(tableNames(database)).not.toContain('conversation_events');
      expect(tableNames(database)).toEqual([
        'catalog_pin_projections',
        'sandbox_proof_sessions',
      ]);
    } finally {
      database.close();
    }
  });

  it('matches the fresh runtime schema for the explicit projection tables', async () => {
    const upgraded = new DatabaseSync(':memory:');
    const fresh = new DatabaseSync(':memory:');
    try {
      upgraded.exec(
        await readFile(
          resolve('migrations/0022_storage_boundary_cleanup.sql'),
          'utf8',
        ),
      );
      for (const statement of schemaStatements) fresh.exec(statement);

      for (const table of [
        'catalog_pin_projections',
        'sandbox_proof_sessions',
      ]) {
        expect(upgraded.prepare(`PRAGMA table_info(${table})`).all()).toEqual(
          fresh.prepare(`PRAGMA table_info(${table})`).all(),
        );
      }
    } finally {
      upgraded.close();
      fresh.close();
    }
  });
});
