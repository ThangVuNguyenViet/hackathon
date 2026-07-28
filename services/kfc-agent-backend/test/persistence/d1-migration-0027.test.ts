import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { kfcVietnamPack } from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { schemaStatements } from '../../src/persistence/d1StoreSupport.js';
import { validatePackStateEnvelope } from '../../src/runtime/businessPack.js';

const sessionId = 'kfc:demo-qualification-06-sanity-suppression';

async function expectVerifiedStoreAuthority(database: DatabaseSync) {
  const row = database
    .prepare(
      `SELECT envelope_json
       FROM pack_state_projections
       WHERE session_id = ?
         AND pack_id = ?
         AND pack_version = ?`,
    )
    .get(sessionId, kfcVietnamPack.ref.packId, kfcVietnamPack.ref.version);
  expect(row).toBeDefined();
  const state = await validatePackStateEnvelope(
    JSON.parse(Reflect.get(row!, 'envelope_json') as string),
    {
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      parseState: (value) => kfcVietnamPack.parseState(value),
    },
  );
  expect(state.fulfillment).toMatchObject({
    method: 'pickup',
    disposition: 'pickup',
    storeId: 'KFCVN0036',
    storeName: 'KFC CO.OPMART BIÊN HÒA',
  });
  expect(state.fulfillment?.availability.source).toMatchObject({
    fixtureMode: 'public_crawl_seed',
    sourceFile:
      'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-store-availability-by-store-vi.raw.json',
  });
}

describe('D1 migration 0027', () => {
  it('idempotently seeds scenario 06 with verified KFCVN0036 fulfillment authority', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        `CREATE TABLE pack_state_projections (
          session_id TEXT NOT NULL,
          pack_id TEXT NOT NULL,
          pack_version TEXT NOT NULL,
          envelope_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id, pack_id, pack_version)
        )`,
      );
      const migration = await readFile(
        resolve(
          'migrations',
          '0027_recommendation_qualification_store_authority.sql',
        ),
        'utf8',
      );
      database.exec(migration);
      database.exec(migration);

      await expectVerifiedStoreAuthority(database);
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM pack_state_projections
             WHERE session_id = ?`,
          )
          .get(sessionId),
      ).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('keeps the local D1 bootstrap equivalent to deployed migrations', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      for (const statement of schemaStatements) database.exec(statement);
      await expectVerifiedStoreAuthority(database);
    } finally {
      database.close();
    }
  });
});
