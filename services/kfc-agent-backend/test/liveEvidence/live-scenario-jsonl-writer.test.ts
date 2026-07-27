import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createJsonLineWriter,
  type JsonLineWritable,
} from '../../src/liveEvidence/jsonLineWriter.js';

describe('live scenario JSONL writer', () => {
  it('resolves only after the writable confirms asynchronous completion', async () => {
    const stream = new EventEmitter() as EventEmitter & JsonLineWritable;
    const chunks: string[] = [];
    let callbackCompleted = false;
    stream.write = (chunk, callback) => {
      chunks.push(chunk);
      queueMicrotask(() => {
        callbackCompleted = true;
        callback();
      });
      return true;
    };
    const writeLine = createJsonLineWriter(stream);

    const completion = writeLine('{"type":"session_ready"}');

    expect(callbackCompleted).toBe(false);
    await completion;
    expect(chunks).toEqual(['{"type":"session_ready"}\n']);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it.each([true, false])(
    'rejects an asynchronous write callback error when write returns %s',
    async (writeReturn) => {
      const stream = new EventEmitter() as EventEmitter & JsonLineWritable;
      const failure = new Error('stdout_callback_failed');
      stream.write = (_chunk, callback) => {
        setImmediate(() => callback(failure));
        return writeReturn;
      };
      const writeLine = createJsonLineWriter(stream);

      await expect(writeLine('{"type":"finished"}')).rejects.toBe(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stream.listenerCount('error')).toBe(0);
    },
  );

  it('rejects an asynchronous stream error and removes its listener', async () => {
    const stream = new EventEmitter() as EventEmitter & JsonLineWritable;
    const failure = new Error('stdout_stream_failed');
    stream.write = (_chunk, callback) => {
      setImmediate(() => {
        stream.emit('error', failure);
        callback();
      });
      return true;
    };
    const writeLine = createJsonLineWriter(stream);

    await expect(writeLine('{"type":"finished"}')).rejects.toBe(failure);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it('rejects a synchronous write failure without leaking its listener', async () => {
    const stream = new EventEmitter() as EventEmitter & JsonLineWritable;
    const failure = new Error('stdout_sync_failed');
    stream.write = () => {
      throw failure;
    };
    const writeLine = createJsonLineWriter(stream);

    await expect(writeLine('{"type":"finished"}')).rejects.toBe(failure);
    expect(stream.listenerCount('error')).toBe(0);
  });
});
