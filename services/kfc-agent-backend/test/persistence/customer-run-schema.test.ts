import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('customer run persistence schema', () => {
  it('defines durable run and sequenced event constraints without rollout assignment state', () => {
    for (const path of [
      'src/persistence/schema.sql',
      'src/persistence/d1StoreSupport.ts',
      'src/persistence/postgresStoreCore.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('customer_streaming_assignments');
      expect(source).not.toContain('rollout_policy_revision');
      expect(source).toContain('customer_runs');
      expect(source).toContain('customer_run_events');
      expect(source).toMatch(/UNIQUE\s*\(session_id,\s*client_message_id\)/i);
      expect(source).toMatch(/PRIMARY KEY\s*\(run_id,\s*sequence\)/i);
    }
    const cleanup = readFileSync('migrations/0006_remove_customer_streaming_rollout.sql', 'utf8');
    expect(cleanup).toContain('DROP TABLE IF EXISTS customer_streaming_assignments');
    expect(cleanup).toContain('DROP COLUMN rollout_policy_revision');
  });
});
