import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('D1 migration 0025', () => {
  it('creates only the explicit mock/synthetic POC customer-history table', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        await readFile(
          resolve('migrations/0025_recommendation_demo_customer_history.sql'),
          'utf8',
        ),
      );

      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name LIKE 'recommendation_%'
             ORDER BY name`,
          )
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual(['recommendation_demo_customer_history']);
      expect(
        database
          .prepare(`PRAGMA table_info(recommendation_demo_customer_history)`)
          .all()
          .map((row) => Reflect.get(row, 'name')),
      ).toEqual([
        'customer_ref',
        'fixture_label',
        'linked',
        'completed_orders_json',
        'favorites_json',
        'updated_at',
      ]);
    } finally {
      database.close();
    }
  });

  it('seeds the three labelled synthetic POC journeys with real item 20751 only on the returning fixture', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        await readFile(
          resolve('migrations/0025_recommendation_demo_customer_history.sql'),
          'utf8',
        ),
      );

      const rows = database
        .prepare(
          `SELECT customer_ref, fixture_label, linked,
                  completed_orders_json, favorites_json
           FROM recommendation_demo_customer_history
           ORDER BY customer_ref`,
        )
        .all();
      expect(rows).toHaveLength(3);
      expect(
        rows.map((row) => Reflect.get(row, 'customer_ref')),
      ).toEqual([
        'demo-anonymous-unlinked',
        'demo-linked-zero-history',
        'demo-returning-linked',
      ]);
      for (const row of rows) {
        expect(
          String(Reflect.get(row, 'fixture_label')).toLowerCase(),
        ).toMatch(/mock|synthetic/);
      }

      const returning = rows.find(
        (row) => Reflect.get(row, 'customer_ref') === 'demo-returning-linked',
      )!;
      expect(Reflect.get(returning, 'linked')).toBe(1);
      expect(
        JSON.parse(Reflect.get(returning, 'completed_orders_json') as string),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lines: expect.arrayContaining([
              expect.objectContaining({
                sellableItemId: '20751',
                categoryId: '20000',
              }),
            ]),
          }),
        ]),
      );
      expect(
        JSON.parse(Reflect.get(returning, 'favorites_json') as string),
      ).toContain('20751');
    } finally {
      database.close();
    }
  });
});
