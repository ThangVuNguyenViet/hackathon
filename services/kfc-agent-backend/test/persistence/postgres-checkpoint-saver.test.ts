import { emptyCheckpoint } from '@langchain/langgraph';
import { expect, it } from 'vitest';
import {
  PostgresCheckpointSaver,
  type PostgresCheckpointQueryable,
} from '../../src/persistence/postgresCheckpointSaver.js';

class FakePostgres implements PostgresCheckpointQueryable {
  checkpoints: Array<Record<string, unknown>> = [];
  writes: Array<Record<string, unknown>> = [];

  async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('CREATE TABLE')) return { rows: [] };
    if (normalized.startsWith('INSERT INTO langgraph_checkpoints')) {
      const row = {
        thread_id: values[0], checkpoint_ns: values[1], checkpoint_id: values[2],
        parent_checkpoint_id: values[3], checkpoint_type: values[4], checkpoint_blob: values[5],
        metadata_type: values[6], metadata_blob: values[7], created_at: values[8],
      };
      this.checkpoints = this.checkpoints.filter((candidate) => !(
        candidate.thread_id === row.thread_id && candidate.checkpoint_ns === row.checkpoint_ns && candidate.checkpoint_id === row.checkpoint_id
      ));
      this.checkpoints.push(row);
      return { rows: [] };
    }
    if (normalized.startsWith('INSERT INTO langgraph_checkpoint_writes')) {
      this.writes.push({
        thread_id: values[0], checkpoint_ns: values[1], checkpoint_id: values[2], task_id: values[3],
        write_index: values[4], channel: values[5], value_type: values[6], value_blob: values[7],
      });
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT task_id')) {
      return { rows: this.writes.filter((row) => row.thread_id === values[0] && row.checkpoint_ns === values[1] && row.checkpoint_id === values[2]) as T[] };
    }
    if (normalized.startsWith('SELECT * FROM langgraph_checkpoints')) {
      const rows = this.checkpoints
        .filter((row) => row.thread_id === values[0] && row.checkpoint_ns === values[1] && (values.length < 3 || row.checkpoint_id === values[2]))
        .sort((left, right) => String(right.checkpoint_id).localeCompare(String(left.checkpoint_id)));
      return { rows: rows.slice(0, normalized.includes('LIMIT 1') ? 1 : undefined) as T[] };
    }
    if (normalized.startsWith('DELETE FROM langgraph_checkpoint_writes')) {
      this.writes = this.writes.filter((row) => row.thread_id !== values[0]);
      return { rows: [] };
    }
    if (normalized.startsWith('DELETE FROM langgraph_checkpoints')) {
      this.checkpoints = this.checkpoints.filter((row) => row.thread_id !== values[0]);
      return { rows: [] };
    }
    throw new Error(`Unhandled SQL: ${normalized}`);
  }
}

it('persists and restores LangGraph checkpoints through the Postgres saver', async () => {
  const db = new FakePostgres();
  const saver = new PostgresCheckpointSaver(db);
  await saver.initialize();
  const config = { configurable: { thread_id: 'production-thread', checkpoint_ns: 'run:one' } };
  const checkpoint = { ...emptyCheckpoint(), channel_values: { phase: 'planned' } };
  const saved = await saver.put(config, checkpoint, { source: 'input', step: -1, parents: {} }, {});
  await saver.putWrites(saved, [['phase', 'executed']], 'task-one');

  const restored = await new PostgresCheckpointSaver(db).getTuple(config);
  expect(restored?.checkpoint.id).toBe(checkpoint.id);
  expect(restored?.pendingWrites).toEqual([['task-one', 'phase', 'executed']]);

  await saver.deleteThread('production-thread');
  expect(await saver.getTuple(config)).toBeUndefined();
});
