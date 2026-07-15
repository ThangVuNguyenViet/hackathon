import { Annotation, END, START, StateGraph, emptyCheckpoint } from '@langchain/langgraph';
import { expect, it } from 'vitest';
import { D1CheckpointSaver } from '../../src/persistence/d1CheckpointSaver.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

it('persists checkpoints, parent links, pending writes, listing, and thread deletion in D1', async () => {
  const db = new FakeD1Database();
  const saver = new D1CheckpointSaver(db);
  const config = { configurable: { thread_id: 'thread-1', checkpoint_ns: 'run:message-1' } };
  const first = { ...emptyCheckpoint(), channel_values: { phase: 'context_loaded' } };
  const firstConfig = await saver.put(config, first, {
    source: 'input', step: -1, parents: {},
  }, {});
  await saver.putWrites(firstConfig, [['phase', 'tools_planned']], 'task-1');

  const second = { ...emptyCheckpoint(), channel_values: { phase: 'tools_executed' } };
  await saver.put(firstConfig, second, {
    source: 'loop', step: 0, parents: {},
  }, {});

  const latest = await saver.getTuple(config);
  expect(latest?.checkpoint.id).toBe(second.id);
  expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe(first.id);
  const firstTuple = await saver.getTuple(firstConfig);
  expect(firstTuple?.pendingWrites).toEqual([['task-1', 'phase', 'tools_planned']]);

  const listed = [];
  for await (const tuple of saver.list(config)) listed.push(tuple);
  expect(listed.map((tuple) => tuple.checkpoint.id)).toEqual([second.id, first.id]);
  const loopCheckpoints = [];
  for await (const tuple of saver.list(config, { filter: { source: 'loop' } })) loopCheckpoints.push(tuple);
  expect(loopCheckpoints.map((tuple) => tuple.checkpoint.id)).toEqual([second.id]);

  await saver.deleteThread('thread-1');
  expect(await saver.getTuple(config)).toBeUndefined();
});

it('restores a thread into a newly compiled graph with a new saver instance', async () => {
  const db = new FakeD1Database();
  const State = Annotation.Root({
    count: Annotation<number>({ reducer: (left, right) => left + right, default: () => 0 }),
  });
  const compile = (saver: D1CheckpointSaver) => new StateGraph(State)
    .addNode('increment', () => ({ count: 1 }))
    .addEdge(START, 'increment')
    .addEdge('increment', END)
    .compile({ checkpointer: saver });
  const config = { configurable: { thread_id: 'restored-thread', checkpoint_ns: 'journey' } };

  expect(await compile(new D1CheckpointSaver(db)).invoke({ count: 2 }, config)).toEqual({ count: 3 });
  expect(await compile(new D1CheckpointSaver(db)).invoke({ count: 3 }, config)).toEqual({ count: 7 });
});
