import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('D1 migration 0026', () => {
  it('seeds one non-overlapping deterministic customer authority per held-out narrative', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      for (const migration of [
        '0025_recommendation_demo_customer_history.sql',
        '0026_recommendation_qualification_customers.sql',
      ]) {
        database.exec(
          await readFile(resolve('migrations', migration), 'utf8'),
        );
      }

      const rows = database
        .prepare(
          `SELECT customer_ref, fixture_label, linked,
                  completed_orders_json, favorites_json
           FROM recommendation_demo_customer_history
           WHERE customer_ref LIKE 'demo-qualification-%'
           ORDER BY customer_ref`,
        )
        .all();

      expect(
        rows.map((row) => Reflect.get(row, 'customer_ref')),
      ).toEqual([
        'demo-qualification-01-returning',
        'demo-qualification-02-anonymous',
        'demo-qualification-03-modifier',
        'demo-qualification-04-modifier-empty',
        'demo-qualification-05-sanity-replacement',
        'demo-qualification-06-sanity-suppression',
        'demo-qualification-07-explicit-request',
        'demo-qualification-08-once-only',
      ]);
      expect(rows).toHaveLength(8);
      expect(Reflect.get(rows[1]!, 'linked')).toBe(0);
      for (const returningIndex of [0, 4]) {
        const completedOrders = JSON.parse(
          Reflect.get(
            rows[returningIndex]!,
            'completed_orders_json',
          ) as string,
        ) as Array<Record<string, unknown>>;
        expect(completedOrders).toHaveLength(1);
        expect(
          JSON.parse(
            Reflect.get(rows[returningIndex]!, 'favorites_json') as string,
          ),
        ).toEqual(['20751']);
      }
      for (const row of rows) {
        expect(
          String(Reflect.get(row, 'fixture_label')).toLowerCase(),
        ).toMatch(/mock|synthetic/);
      }
    } finally {
      database.close();
    }
  });
});
