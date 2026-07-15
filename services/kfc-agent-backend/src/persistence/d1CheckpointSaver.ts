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
import type { D1DatabaseLike } from './d1Store.js';

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_blob: ArrayBuffer | Uint8Array;
  metadata_type: string;
  metadata_blob: ArrayBuffer | Uint8Array;
}

interface WriteRow {
  task_id: string;
  channel: string;
  value_type: string;
  value_blob: ArrayBuffer | Uint8Array;
}

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function blob(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
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

export class D1CheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: D1DatabaseLike) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Getting a checkpoint');
    const row = checkpointId
      ? await this.db.prepare(`
          SELECT * FROM langgraph_checkpoints
          WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
        `).bind(threadId, checkpointNs, checkpointId).first<CheckpointRow>()
      : await this.db.prepare(`
          SELECT * FROM langgraph_checkpoints
          WHERE thread_id = ? AND checkpoint_ns = ?
          ORDER BY checkpoint_id DESC LIMIT 1
        `).bind(threadId, checkpointNs).first<CheckpointRow>();
    return row ? this.tuple(row) : undefined;
  }

  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Listing checkpoints');
    const beforeId = options.before?.configurable?.checkpoint_id;
    const clauses = ['thread_id = ?', 'checkpoint_ns = ?'];
    const values: unknown[] = [threadId, checkpointNs];
    if (checkpointId) {
      clauses.push('checkpoint_id = ?');
      values.push(checkpointId);
    }
    if (typeof beforeId === 'string') {
      clauses.push('checkpoint_id < ?');
      values.push(beforeId);
    }
    const result = await this.db.prepare(`
      SELECT * FROM langgraph_checkpoints
      WHERE ${clauses.join(' AND ')}
      ORDER BY checkpoint_id DESC
    `).bind(...values).all<CheckpointRow>();
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;
    for (const row of result.results ?? []) {
      const tuple = await this.tuple(row);
      if (options.filter && !Object.entries(options.filter).every(
        ([key, value]) => (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value,
      )) {
        continue;
      }
      if (remaining-- <= 0) break;
      yield tuple;
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
    await this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_blob, metadata_type, metadata_blob, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      threadId,
      checkpointNs,
      checkpoint.id,
      parentCheckpointId ?? null,
      checkpointType,
      blob(checkpointBlob),
      metadataType,
      blob(metadataBlob),
      checkpoint.ts,
    ).run();
    return {
      configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { threadId, checkpointNs, checkpointId } = requiredConfig(config, 'Saving checkpoint writes');
    if (!checkpointId) throw new Error('Saving checkpoint writes requires configurable.checkpoint_id');
    const statements = await Promise.all(writes.map(async ([channel, value], index) => {
      const writeIndex = WRITES_IDX_MAP[channel] ?? index;
      const [valueType, valueBlob] = await this.serde.dumpsTyped(value);
      const insert = writeIndex >= 0 ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
      return this.db.prepare(`
        ${insert} INTO langgraph_checkpoint_writes (
          thread_id, checkpoint_ns, checkpoint_id, task_id, write_index,
          channel, value_type, value_blob
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(threadId, checkpointNs, checkpointId, taskId, writeIndex, channel, valueType, blob(valueBlob));
    }));
    if (statements.length === 0) return;
    if (this.db.batch) await this.db.batch(statements);
    else for (const statement of statements) await statement.run();
  }

  async deleteThread(threadId: string): Promise<void> {
    const statements = [
      this.db.prepare('DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?').bind(threadId),
      this.db.prepare('DELETE FROM langgraph_checkpoints WHERE thread_id = ?').bind(threadId),
    ];
    if (this.db.batch) await this.db.batch(statements);
    else for (const statement of statements) await statement.run();
  }

  private async tuple(row: CheckpointRow): Promise<CheckpointTuple> {
    const writeResult = await this.db.prepare(`
      SELECT task_id, channel, value_type, value_blob
      FROM langgraph_checkpoint_writes
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY task_id, write_index
    `).bind(row.thread_id, row.checkpoint_ns, row.checkpoint_id).all<WriteRow>();
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      (writeResult.results ?? []).map(async (write) => [
        write.task_id,
        write.channel,
        await this.serde.loadsTyped(write.value_type, bytes(write.value_blob)),
      ]),
    );
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint: await this.serde.loadsTyped(row.checkpoint_type, bytes(row.checkpoint_blob)),
      metadata: await this.serde.loadsTyped(row.metadata_type, bytes(row.metadata_blob)),
      pendingWrites,
    };
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    return tuple;
  }
}
