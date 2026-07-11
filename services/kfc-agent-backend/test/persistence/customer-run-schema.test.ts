import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('customer run persistence schema', () => {
  it('defines durable assignment, run, and sequenced event constraints in every SQL path', () => {
    for (const path of [
      'migrations/0005_customer_run_streaming.sql',
      'src/persistence/schema.sql',
      'src/persistence/d1Store.ts',
      'src/persistence/postgresStore.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('customer_streaming_assignments');
      expect(source).toContain('customer_runs');
      expect(source).toContain('customer_run_events');
      expect(source).toMatch(/UNIQUE\s*\(session_id,\s*client_message_id\)/i);
      expect(source).toMatch(/PRIMARY KEY\s*\(run_id,\s*sequence\)/i);
    }
  });
});
