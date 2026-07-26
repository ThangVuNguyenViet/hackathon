import { user, type AgentInputItem } from '@kfc/openai-agents-runtime';
import type { QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ConversationStoreAgentSession } from '../../src/agent/conversationStoreAgentSession.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'kfc:agent-sdk-session';

function items(): AgentInputItem[] {
  return [user('first'), user('second'), user('third')];
}

describe('ConversationStoreAgentSession', () => {
  it('implements all five Session operations with recent limits in chronological order', async () => {
    const store = new MemoryStore();
    const session = new ConversationStoreAgentSession(store, sessionId);

    await expect(session.getSessionId()).resolves.toBe(sessionId);
    await session.addItems(items());
    await expect(session.getItems(2)).resolves.toEqual(items().slice(1));
    await expect(session.popItem()).resolves.toEqual(items()[2]);
    await expect(session.getItems()).resolves.toEqual(items().slice(0, 2));
    await session.clearSession();
    await expect(session.getItems()).resolves.toEqual([]);
  });

  it('keeps SDK session items separate from customer-visible turns and clears only the requested session', async () => {
    const store = new MemoryStore();
    await store.addAgentSessionItems(sessionId, items());
    await store.addAgentSessionItems('kfc:other', [user('keep')]);
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'customer visible',
      externalMessageId: 'message-1',
      externalUserId: 'customer',
      deliveryStatus: 'received',
      metadata: null,
    });

    await store.clearAgentSessionItems(sessionId);

    await expect(store.listAgentSessionItems(sessionId)).resolves.toEqual([]);
    await expect(store.listAgentSessionItems('kfc:other')).resolves.toEqual([
      user('keep'),
    ]);
    await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
  });

  it('persists ordered SDK items through D1 and removes them during a session reset', async () => {
    const database = new FakeD1Database();
    const store = new D1Store(database);
    await store.initialize();
    await store.addAgentSessionItems(sessionId, items());
    await store.addAgentSessionItems('kfc:other', [user('keep')]);

    await expect(store.listAgentSessionItems(sessionId, 2)).resolves.toEqual(
      items().slice(1),
    );
    await expect(store.popAgentSessionItem(sessionId)).resolves.toEqual(
      items()[2],
    );
    await store.resetSession(sessionId);

    await expect(store.listAgentSessionItems(sessionId)).resolves.toEqual([]);
    await expect(store.listAgentSessionItems('kfc:other')).resolves.toEqual([
      user('keep'),
    ]);
  });

  it('keeps each concurrent D1 append batch contiguous and internally ordered', async () => {
    const database = new FakeD1Database();
    const store = new D1Store(database);
    await store.initialize();

    await Promise.all([
      store.addAgentSessionItems(sessionId, [user('a1'), user('a2')]),
      store.addAgentSessionItems(sessionId, [user('b1'), user('b2')]),
    ]);

    const texts = (await store.listAgentSessionItems(sessionId)).map((item) => {
      if (!('content' in item) || !Array.isArray(item.content))
        return undefined;
      const content = item.content[0];
      return content && 'text' in content ? content.text : undefined;
    });
    expect(texts).toSatisfy(
      (values: unknown[]) =>
        JSON.stringify(values) === JSON.stringify(['a1', 'a2', 'b1', 'b2']) ||
        JSON.stringify(values) === JSON.stringify(['b1', 'b2', 'a1', 'a2']),
    );
  });

  it('uses ordered Postgres rows for append, recent reads, pop, and clear', async () => {
    const rows: Array<{
      session_id: string;
      sequence: number;
      item_json: string;
    }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('INSERT INTO agent_session_items')) {
        // The store binds this query as a session id plus serialized item array.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const [targetSession, payloads] = values as [string, string[]];
        payloads.forEach((payload, index) => {
          rows.push({
            session_id: targetSession,
            sequence: rows.length + index + 1,
            item_json: payload,
          });
        });
        return result([]);
      }
      if (
        sql.includes('DELETE FROM agent_session_items') &&
        sql.includes('RETURNING')
      ) {
        const candidates = rows
          .filter((row) => row.session_id === values[0])
          .sort((left, right) => right.sequence - left.sequence);
        const popped = candidates[0];
        if (popped) rows.splice(rows.indexOf(popped), 1);
        return result(popped ? [popped] : []);
      }
      if (sql.includes('DELETE FROM agent_session_items')) {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index]?.session_id === values[0]) rows.splice(index, 1);
        }
        return result([]);
      }
      if (sql.includes('FROM agent_session_items')) {
        const target = rows
          .filter((row) => row.session_id === values[0])
          .sort((left, right) => left.sequence - right.sequence);
        const limited =
          typeof values[1] === 'number'
            ? target.slice(-Number(values[1]))
            : target;
        return result(limited);
      }
      if (sql.includes('MAX(sequence)')) {
        const sequence = rows
          .filter((row) => row.session_id === values[0])
          .reduce((highest, row) => Math.max(highest, row.sequence), 0);
        return result([{ sequence }]);
      }
      return result([]);
    });
    // Narrow query-only test double for the Postgres store constructor.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const store = new PostgresStore({ query } as never);

    await store.addAgentSessionItems(sessionId, items());
    const appendSql = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO agent_session_items'),
    )?.[0];
    expect(appendSql).toContain(
      'pg_advisory_xact_lock(hashtextextended($1, 0))',
    );
    expect(appendSql).toContain('WITH ORDINALITY');
    await expect(store.listAgentSessionItems(sessionId, 2)).resolves.toEqual(
      items().slice(1),
    );
    await expect(store.popAgentSessionItem(sessionId)).resolves.toEqual(
      items()[2],
    );
    await store.clearAgentSessionItems(sessionId);
    await expect(store.listAgentSessionItems(sessionId)).resolves.toEqual([]);

    await Promise.all([
      store.addAgentSessionItems(sessionId, [user('a1'), user('a2')]),
      store.addAgentSessionItems(sessionId, [user('b1'), user('b2')]),
    ]);
    const texts = (await store.listAgentSessionItems(sessionId)).map((item) => {
      if (!('content' in item) || !Array.isArray(item.content))
        return undefined;
      const content = item.content[0];
      return content && 'text' in content ? content.text : undefined;
    });
    expect(texts).toSatisfy(
      (values: unknown[]) =>
        JSON.stringify(values) === JSON.stringify(['a1', 'a2', 'b1', 'b2']) ||
        JSON.stringify(values) === JSON.stringify(['b1', 'b2', 'a1', 'a2']),
    );
  });
});

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
