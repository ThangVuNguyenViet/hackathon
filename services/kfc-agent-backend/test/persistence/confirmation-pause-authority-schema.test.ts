import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { schemaStatements } from '../../src/persistence/d1StoreSupport.js';

describe('confirmation pause session-authority schema', () => {
  it('persists an explicit nonnegative authority generation in D1', () => {
    const confirmationPauseSchema = schemaStatements.find((statement) =>
      statement.includes('CREATE TABLE IF NOT EXISTS confirmation_pauses')
    );

    expect(confirmationPauseSchema).toMatch(
      /session_authority_generation INTEGER NOT NULL[\s\S]+CHECK \(session_authority_generation >= 0\)/u,
    );
  });

  it('ships the Postgres and deployed-D1 migration', async () => {
    const migration = await readFile(
      new URL(
        '../../migrations/0019_confirmation_pause_session_authority.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toMatch(
      /ALTER TABLE confirmation_pauses[\s\S]+ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0/u,
    );
    expect(migration).toMatch(
      /CHECK \(session_authority_generation >= 0\)/u,
    );
  });
});
