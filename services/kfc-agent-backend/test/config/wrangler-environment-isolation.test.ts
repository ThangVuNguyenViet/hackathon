import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('keeps sandbox and production Worker persistence configurations distinct', async () => {
  const [sandbox, production] = await Promise.all([
    readFile('wrangler.toml', 'utf8'),
    readFile('wrangler.production.toml.example', 'utf8'),
  ]);

  expect(sandbox).toContain('KFC_COMMERCE_ENVIRONMENT = "sandbox"');
  expect(production).toContain('KFC_COMMERCE_ENVIRONMENT = "production"');
  expect(production).toContain('database_id = "REPLACE_WITH_DISTINCT_PRODUCTION_D1_DATABASE_ID"');
  expect(production).not.toContain('fb36af59-58d0-42e1-932b-144dbd17e477');
  expect(production).toContain('queue = "kfc-messenger-webhook-jobs-production"');
});
