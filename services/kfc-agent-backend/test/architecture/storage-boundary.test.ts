import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaStatements } from '../../src/persistence/d1StoreSupport.js';

const backendRoot = process.cwd();

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.name.endsWith('.ts') ? [path] : [];
      }),
    )
  ).flat();
}

describe('production storage boundary', () => {
  it('has no Postgres implementation or dependency', async () => {
    const persistenceFiles = await readdir(resolve(backendRoot, 'src/persistence'));
    const packageJson = JSON.parse(
      await readFile(resolve(backendRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const source = (
      await Promise.all(
        (await sourceFiles(resolve(backendRoot, 'src'))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');

    expect(
      persistenceFiles.filter((file) => file.toLowerCase().includes('postgres')),
    ).toEqual([]);
    expect(packageJson.dependencies?.pg).toBeUndefined();
    expect(packageJson.devDependencies?.['@types/pg']).toBeUndefined();
    expect(source).not.toMatch(/from ['"]pg['"]/);
    await expect(
      readFile(resolve(backendRoot, 'src/persistence/schema.sql'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(resolve(backendRoot, 'Dockerfile'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(
        resolve(backendRoot, '../../scripts/deploy-backend-cloud-run.sh'),
        'utf8',
      ),
    ).rejects.toThrow();
  });

  it('has no generic conversation event schema, API, or production writes', async () => {
    const source = (
      await Promise.all(
        (await sourceFiles(resolve(backendRoot, 'src'))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    const migrations = (
      await Promise.all(
        (await readdir(resolve(backendRoot, 'migrations')))
          .filter((file) => file.endsWith('.sql'))
          .map((file) =>
            readFile(resolve(backendRoot, 'migrations', file), 'utf8'),
          ),
      )
    ).join('\n');
    const freshSchema = schemaStatements.join('\n');

    expect(source).not.toMatch(/\bappendEvent(?:IfRunCurrent)?\b/);
    expect(source).not.toMatch(/\blistEvents\b/);
    expect(source).not.toMatch(/\bStoredEvent\b/);
    expect(freshSchema).not.toMatch(/\bconversation_events\b/);
    expect(migrations).toMatch(/DROP TABLE IF EXISTS conversation_events/);
    expect(source).not.toContain('agent:verified_state');
  });

  it('retains explicit operational and product tables', async () => {
    const migrations = (
      await Promise.all(
        (await readdir(resolve(backendRoot, 'migrations')))
          .filter((file) => file.endsWith('.sql'))
          .map((file) =>
            readFile(resolve(backendRoot, 'migrations', file), 'utf8'),
          ),
      )
    ).join('\n');
    const declaredSchema = `${schemaStatements.join('\n')}\n${migrations}`;
    for (const table of [
      'conversation_turns',
      'conversation_summaries',
      'pack_state_projections',
      'catalog_pin_projections',
      'sandbox_proof_sessions',
      'dashboard_events',
      'webhook_deliveries',
      'pending_customer_turns',
      'agent_runs',
      'session_agent_state',
      'session_generations',
      'session_controls',
      'agent_run_text_deliveries',
      'agent_run_text_delivery_attempts',
      'non_agent_text_deliveries',
      'non_agent_text_delivery_attempts',
      'irreversible_operations',
      'verified_refs',
      'customer_runs',
      'customer_run_events',
      'commerce_lifecycle_instances',
      'commerce_lifecycle_events',
      'commerce_lifecycle_idempotency',
      'commerce_lifecycle_faults',
      'commerce_lifecycle_operation_occurrences',
      'commerce_lifecycle_command_claims',
    ]) {
      expect(declaredSchema).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
      );
    }
  });
});
