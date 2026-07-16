import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';

export interface PostgresCheckpointQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface CheckpointRow extends Record<string, unknown> {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_blob: Buffer;
  metadata_type: string;
  metadata_blob: Buffer;
}

interface WriteRow extends Record<string, unknown> {
  task_id: string;
  channel: string;
  value_type: string;
  value_blob: Buffer;
}

function requiredConfig(config: RunnableConfig, operation: string) {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== 'string' || !threadId) {
    throw new Error(`${operation} requires configurable.thread_id`);
  }
  return {
    threadId,
    checkpointNs: typeof config.configurable?.checkpoint_ns === 'string'
      ? config.configurable.checkpoint_ns
      : '',
    checkpointId: typeof config.configurable?.checkpoint_id === 'string'
      ? config.configurable.checkpoint_id
      : undefined,
  };
}

export class PostgresCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: PostgresCheckpointQueryable) {
    super();
  }

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
        thread_id text NOT NULL,
        checkpoint_ns text NOT NULL,
        checkpoint_id text NOT NULL,
        parent_checkpoint_id text,
        checkpoint_type text NOT NULL,
        checkpoint_blob bytea NOT NULL,
        metadata_type text NOT NULL,
        metadata_blob bytea NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
        thread_id text NOT NULL,
        checkpoint_ns text NOT NULL,
        checkpoint_id text NOT NULL,
        task_id text NOT NULL,
        write_index integer NOT NULL,
        channel text NOT NULL,
        value_type text NOT NULL,
        value_blob bytea NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index)
      )
    `);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Getting a checkpoint');
    const result = checkpointId
      ? await this.db.query<CheckpointRow>(`
          SELECT * FROM langgraph_checkpoints
          WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3
        `, [threadId, checkpointNs, checkpointId])
      : await this.db.query<CheckpointRow>(`
          SELECT * FROM langgraph_checkpoints
          WHERE thread_id = $1 AND checkpoint_ns = $2
          ORDER BY checkpoint_id DESC LIMIT 1
        `, [threadId, checkpointNs]);
    return result.rows[0] ? this.tuple(result.rows[0]) : undefined;
  }

  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Listing checkpoints');
    const clauses = ['thread_id = $1', 'checkpoint_ns = $2'];
    const values: unknown[] = [threadId, checkpointNs];
    if (checkpointId) {
      values.push(checkpointId);
      clauses.push(`checkpoint_id = $${values.length}`);
    }
    const beforeId = options.before?.configurable?.checkpoint_id;
    if (typeof beforeId === 'string') {
      values.push(beforeId);
      clauses.push(`checkpoint_id < $${values.length}`);
    }
    const result = await this.db.query<CheckpointRow>(`
      SELECT * FROM langgraph_checkpoints
      WHERE ${clauses.join(' AND ')}
      ORDER BY checkpoint_id DESC
    `, values);
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;
    for (const row of result.rows) {
      const tuple = await this.tuple(row);
      if (!options.filter || Object.entries(options.filter).every(
        ([key, value]) => (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value,
      )) {
        if (remaining-- <= 0) break;
        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { threadId, checkpointNs, checkpointId: parentCheckpointId } = requiredConfig(config, 'Saving a checkpoint');
    const [[checkpointType, checkpointBlob], [metadataType, metadataBlob]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    await this.db.query(`
      INSERT INTO langgraph_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_blob, metadata_type, metadata_blob, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
        parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
        checkpoint_type = EXCLUDED.checkpoint_type,
        checkpoint_blob = EXCLUDED.checkpoint_blob,
        metadata_type = EXCLUDED.metadata_type,
        metadata_blob = EXCLUDED.metadata_blob,
        created_at = EXCLUDED.created_at
    `, [
      threadId, checkpointNs, checkpoint.id, parentCheckpointId ?? null,
      checkpointType, Buffer.from(checkpointBlob), metadataType, Buffer.from(metadataBlob), checkpoint.ts,
    ]);
    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Saving checkpoint writes');
    if (!checkpointId) throw new Error('Saving checkpoint writes requires configurable.checkpoint_id');
    for (const [index, [channel, value]] of writes.entries()) {
      const writeIndex = WRITES_IDX_MAP[channel] ?? index;
      const [valueType, valueBlob] = await this.serde.dumpsTyped(value);
      await this.db.query(`
        INSERT INTO langgraph_checkpoint_writes (
          thread_id, checkpoint_ns, checkpoint_id, task_id, write_index,
          channel, value_type, value_blob
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index)
        ${writeIndex >= 0 ? 'DO NOTHING' : `DO UPDATE SET channel = EXCLUDED.channel,
          value_type = EXCLUDED.value_type, value_blob = EXCLUDED.value_blob`}
      `, [threadId, checkpointNs, checkpointId, taskId, writeIndex, channel, valueType, Buffer.from(valueBlob)]);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.query('DELETE FROM langgraph_checkpoint_writes WHERE thread_id = $1', [threadId]);
    await this.db.query('DELETE FROM langgraph_checkpoints WHERE thread_id = $1', [threadId]);
  }

  private async tuple(row: CheckpointRow): Promise<CheckpointTuple> {
    const writes = await this.db.query<WriteRow>(`
      SELECT task_id, channel, value_type, value_blob
      FROM langgraph_checkpoint_writes
      WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3
      ORDER BY task_id, write_index
    `, [row.thread_id, row.checkpoint_ns, row.checkpoint_id]);
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(writes.rows.map(async (write) => [
      write.task_id,
      write.channel,
      await this.serde.loadsTyped(write.value_type, write.value_blob),
    ]));
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.checkpoint_id } },
      checkpoint: await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint_blob),
      metadata: await this.serde.loadsTyped(row.metadata_type, row.metadata_blob),
      pendingWrites,
    };
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = { configurable: {
        thread_id: row.thread_id,
        checkpoint_ns: row.checkpoint_ns,
        checkpoint_id: row.parent_checkpoint_id,
      } };
    }
    return tuple;
  }
}
