import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from 'node:sqlite';
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1Result,
} from '../../src/persistence/d1StoreSupport.js';

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.database, this.query, values);
  }

  async run(): Promise<D1Result> {
    const statement = this.statement();
    const result = statement.run(...this.sqliteValues());
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement().get(...this.sqliteValues()) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      results: this.statement().all(...this.sqliteValues()) as T[],
      success: true,
      meta: { changes: 0 },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }

  private sqliteValues(): SQLInputValue[] {
    return this.values.map((value) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        value instanceof Uint8Array
      ) {
        return value;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      throw new Error('sqlite_d1_test_binding_unsupported');
    });
  }
}

export class SqliteD1Database implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(':memory:');

  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.sqlite, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
