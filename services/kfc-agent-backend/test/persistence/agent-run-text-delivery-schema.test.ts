import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AgentRun text-delivery durable schema', () => {
  it('defines a constrained head row and globally unique attempt tokens', () => {
    for (const path of [
      'migrations/0017_agent_run_text_deliveries.sql',
      'src/persistence/schema.sql',
      'src/persistence/d1StoreSupport.ts',
      'src/persistence/postgresStoreCore.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('agent_run_text_deliveries');
      expect(source).toContain('agent_run_text_delivery_attempts');
      expect(source).toContain('kfc-agent-run-text-delivery-v1');
      expect(source).toContain('delivery_outcome_unknown');
      expect(source).toContain('run_execution_origin_attempt');
      expect(source).toContain('run_execution_lease_token_digest');
      expect(source).toContain('last_delivery_run_execution_attempt');
      expect(
        source.match(
          /last_delivery_run_execution_attempt\s+IS\s+NOT\s+NULL/giu,
        )?.length ?? 0,
      ).toBeGreaterThanOrEqual(4);
      expect(source).toMatch(/delivery_attempt\s+BETWEEN\s+0\s+AND\s+3/iu);
      expect(source).toMatch(
        /UNIQUE\s*\(\s*delivery_attempt_token\s*\)/iu,
      );
      expect(source).not.toMatch(
        /UNIQUE\s*\(\s*run_id\s*,\s*delivery_attempt_token\s*\)/iu,
      );
      expect(source).not.toMatch(/\brecipient_id\b/iu);
      expect(source).not.toMatch(/\bpresentation_text\b/iu);
    }
  });

  it('keeps rebind lineage as digest-only data', () => {
    const migration = readFileSync(
      'migrations/0017_agent_run_text_deliveries.sql',
      'utf8',
    );
    expect(migration).toContain(
      'prior_run_execution_lease_token_digests',
    );
    expect(migration).toMatch(
      /json_array_length\([\s\S]*prior_run_execution_lease_token_digests[\s\S]*\)\s*=\s*run_execution_attempt\s*-\s*run_execution_origin_attempt/iu,
    );
    expect(migration).not.toContain('prior_run_execution_lease_tokens');
    expect(migration).toMatch(
      /recipient_binding_digest[\s\S]+presentation_binding_digest[\s\S]+delivery_binding_digest/iu,
    );
  });

  it('keeps the PostgreSQL bootstrap foreign keys and bounded identifiers', () => {
    const source = readFileSync(
      'src/persistence/schema.sql',
      'utf8',
    );
    expect(source).toMatch(
      /run_id\s+TEXT\s+PRIMARY KEY\s+REFERENCES\s+agent_runs\s*\(\s*id\s*\)\s+ON DELETE CASCADE/iu,
    );
    for (const [column, maximum] of [
      ['run_id', 512],
      ['run_execution_lease_token', 512],
      ['assistant_turn_id', 512],
      ['delivery_attempt_token', 512],
      ['provider_message_id', 512],
      ['outcome_code', 256],
    ] as const) {
      expect(source).toMatch(new RegExp(
        `${column}[\\s\\S]{0,240}length\\(${column}\\) BETWEEN 1 AND ${maximum}[\\s\\S]{0,120}${column} = btrim\\(${column}\\)`,
        'iu',
      ));
    }
  });

  it('rejects null dispatch lineage in every non-pending PostgreSQL state', () => {
    for (const path of [
      'src/persistence/schema.sql',
      'src/persistence/postgresStoreCore.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      for (const status of [
        'sending',
        'confirmed_not_sent',
        'confirmed_sent',
        'delivery_outcome_unknown',
      ]) {
        expect(source).toMatch(new RegExp(
          `status = '${status}'[\\s\\S]{0,360}` +
            'last_delivery_run_execution_attempt IS NOT NULL',
          'u',
        ));
      }
    }
  });

  it('cascades session reset through AgentRun delivery and attempt rows', () => {
    const schema = readFileSync(
      'src/persistence/schema.sql',
      'utf8',
    );
    const reset = readFileSync(
      'src/persistence/postgresStoreSessionReset.ts',
      'utf8',
    );
    expect(schema.indexOf('CREATE TABLE IF NOT EXISTS agent_runs'))
      .toBeLessThan(
        schema.indexOf(
          'CREATE TABLE IF NOT EXISTS agent_run_text_deliveries',
        ),
      );
    expect(schema).toMatch(
      /run_id\s+TEXT\s+PRIMARY KEY\s+REFERENCES\s+agent_runs\s*\(\s*id\s*\)\s+ON DELETE CASCADE/iu,
    );
    expect(schema).toMatch(
      /REFERENCES\s+agent_run_text_deliveries\s*\(\s*run_id\s*\)\s+ON DELETE CASCADE/iu,
    );
    expect(reset).toContain(
      'DELETE FROM agent_runs WHERE session_id = $1',
    );
  });
});
