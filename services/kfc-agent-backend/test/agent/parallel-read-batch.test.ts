import { describe, expect, it, vi } from 'vitest';
import type { ExternalCallContext } from '../../src/clients/interfaces.js';
import {
  executeParallelReadBatch,
  independentParallelReadToolNames,
  ParallelReadBatchError,
  parallelReadBatchEligibility,
  projectParallelReadResultsInOrder,
  type IndexedParallelReadResult,
  type ParallelReadBatchCall,
  type ValidatedParallelReadRequest,
} from '../../src/agent/parallelReadBatch.js';

function externalCallContext(
  signal = new AbortController().signal,
): ExternalCallContext {
  return {
    signal,
    deadlineAt: Date.now() + 10_000,
  };
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function parallelReadRequest(
  toolName: 'searchMenu' | 'searchPromotions' = 'searchMenu',
): ValidatedParallelReadRequest {
  return toolName === 'searchPromotions'
    ? {
        toolName,
        arguments: { scope: 'all', query: null },
      }
    : {
        toolName,
        arguments: { scope: 'all', query: null },
      };
}

function readCall(input: {
  id: string;
  toolName?: 'searchMenu' | 'searchPromotions';
}): ParallelReadBatchCall {
  return {
    id: input.id,
    ...parallelReadRequest(input.toolName),
  };
}

function singleProjectionResult(): IndexedParallelReadResult<{
  value: string;
}>[] {
  return [{
    index: 0,
    id: 'projection-call',
    request: parallelReadRequest(),
    result: { value: 'projected' },
  }];
}

describe('parallel read batch', () => {
  it('dispatches reads concurrently against one immutable snapshot and shared call context', async () => {
    const releases = [deferred<void>(), deferred<void>()] as const;
    const context = externalCallContext();
    const originalState = {
      cart: {
        id: 'cart-1',
        items: [{ itemCode: 'item-1', quantity: 1 }],
      },
    };
    const starts: number[] = [];
    const snapshots: unknown[] = [];
    const contexts: ExternalCallContext[] = [];
    const execute = vi.fn(async (execution) => {
      starts.push(execution.index);
      snapshots.push(execution.stateSnapshot);
      contexts.push(execution.externalCallContext);
      expect(Object.isFrozen(execution.stateSnapshot)).toBe(true);
      expect(Object.isFrozen(execution.stateSnapshot.cart)).toBe(true);
      expect(Object.isFrozen(execution.stateSnapshot.cart.items)).toBe(true);
      expect(Object.isFrozen(execution.request.arguments)).toBe(true);
      expect(() => {
        (
          execution.stateSnapshot.cart.items[0] as {
            itemCode: string;
          }
        ).itemCode = 'mutated';
      }).toThrow(TypeError);
      await releases[execution.index]!.promise;
      return { toolName: execution.request.toolName };
    });

    const pending = executeParallelReadBatch({
      calls: [
        readCall({
          id: 'provider-call/🔥 promotion',
          toolName: 'searchPromotions',
        }),
        readCall({ id: ' provider-call menu ' }),
      ],
      stateSnapshot: originalState,
      externalCallContext: context,
      execute,
    });

    try {
      await Promise.resolve();
      expect(starts).toEqual([0, 1]);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toBe(snapshots[1]);
      expect(snapshots[0]).not.toBe(originalState);
      expect(contexts[0]).toBe(contexts[1]);
      expect(contexts[0]).not.toBe(context);
      expect(contexts[0]?.deadlineAt).toBe(context.deadlineAt);
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      releases[1].resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      releases[0].resolve();

      await expect(pending).resolves.toMatchObject([
        {
          index: 0,
          id: 'provider-call/🔥 promotion',
          request: { toolName: 'searchPromotions' },
          result: { toolName: 'searchPromotions' },
        },
        {
          index: 1,
          id: ' provider-call menu ',
          request: { toolName: 'searchMenu' },
          result: { toolName: 'searchMenu' },
        },
      ]);
      expect(originalState.cart.items[0]?.itemCode).toBe('item-1');
    } finally {
      releases.forEach((release) => release.resolve());
      await pending.catch(() => undefined);
    }
  });

  it('waits for every started read to settle before rejecting one provider failure', async () => {
    const first = deferred<{ ok: true }>();
    const second = deferred<{ ok: true }>();
    const operations = [first, second] as const;
    const execute = vi.fn(
      (execution: { index: number }) =>
        operations[execution.index]!.promise,
    );
    const pending = executeParallelReadBatch({
      calls: [
        readCall({ id: 'fails-first' }),
        readCall({ id: 'settles-later', toolName: 'searchPromotions' }),
      ],
      stateSnapshot: {},
      externalCallContext: externalCallContext(),
      execute,
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      first.reject(new Error('provider_read_failed'));
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      second.resolve({ ok: true });

      await expect(pending).rejects.toThrow('provider_read_failed');
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      first.resolve({ ok: true });
      second.resolve({ ok: true });
      await pending.catch(() => undefined);
    }
  });

  it('retains a typed provider failure as a raw result for ordered projection', async () => {
    const providerFailure = {
      ok: false as const,
      errorCode: 'not_found',
    };

    await expect(
      executeParallelReadBatch({
        calls: [readCall({ id: 'typed-failure' })],
        stateSnapshot: {},
        externalCallContext: externalCallContext(),
        execute: vi.fn(async () => providerFailure),
      }),
    ).resolves.toEqual([
      {
        index: 0,
        id: 'typed-failure',
        request: parallelReadRequest(),
        result: providerFailure,
      },
    ]);
  });

  it('projects indexed raw results serially in original call order', async () => {
    const results: IndexedParallelReadResult<{ value: string }>[] = [
      {
        index: 2,
        id: 'call-third',
        request: parallelReadRequest(),
        result: { value: 'third' },
      },
      {
        index: 0,
        id: 'call-first',
        request: parallelReadRequest(),
        result: { value: 'first' },
      },
      {
        index: 1,
        id: 'call-second',
        request: parallelReadRequest(),
        result: { value: 'second' },
      },
    ];
    const timeline: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const initialAccumulator: string[] = [];

    const projected = await projectParallelReadResultsInOrder({
      results,
      initialAccumulator,
      externalCallContext: externalCallContext(),
      assertActive: vi.fn(),
      project: async (privateDraft, entry) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        timeline.push(`start:${entry.index}:${entry.id}`);
        await Promise.resolve();
        privateDraft.push(entry.result.value);
        timeline.push(`end:${entry.index}:${entry.id}`);
        active -= 1;
      },
    });

    expect(projected).toEqual(['first', 'second', 'third']);
    expect(projected).not.toBe(initialAccumulator);
    expect(initialAccumulator).toEqual([]);
    expect(maximumActive).toBe(1);
    expect(timeline).toEqual([
      'start:0:call-first',
      'end:0:call-first',
      'start:1:call-second',
      'end:1:call-second',
      'start:2:call-third',
      'end:2:call-third',
    ]);
  });

  it('admits the independent membership reads required by one model-authored batch', () => {
    const calls = [
      {
        id: 'membership-profile',
        toolName: 'getMembershipProfile',
        arguments: {},
      },
      {
        id: 'membership-rewards',
        toolName: 'listMembershipRewards',
        arguments: { scope: 'all', query: null },
      },
      {
        id: 'membership-wallet',
        toolName: 'listMembershipWallet',
        arguments: { status: null },
      },
      {
        id: 'membership-points',
        toolName: 'getMembershipPointHistory',
        arguments: { days: null },
      },
      {
        id: 'membership-tools',
        toolName: 'listMembershipTools',
        arguments: { sideEffect: null },
      },
    ] satisfies ParallelReadBatchCall[];

    expect(parallelReadBatchEligibility(calls)).toEqual({ ok: true });
  });

  it('keeps the repository-owned independent-read allowlist exact', () => {
    expect(independentParallelReadToolNames).toEqual([
      'searchMenu',
      'findStores',
      'searchPromotions',
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
      'getMembershipPointHistory',
      'listMembershipTools',
      'listPaymentMethods',
      'searchContentPolicy',
      'answerAllergenQuestion',
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);
  });

  it.each([
    {
      name: 'a mutation',
      call: {
        id: 'mutation',
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: 'item-1',
            quantity: 1,
            modifiers: [],
          }],
        },
      } satisfies ParallelReadBatchCall,
      errorCode: 'parallel_read_batch_mutation_forbidden',
    },
    {
      name: 'an approval capability',
      call: {
        id: 'approval',
        toolName: 'acquireVoucher',
        arguments: { rewardId: 'reward-1' },
      } satisfies ParallelReadBatchCall,
      errorCode: 'parallel_read_batch_approval_forbidden',
    },
  ] as const)('rejects $name before dispatch', async ({ call, errorCode }) => {
    const execute = vi.fn(async () => ({ ok: true }));

    expect(parallelReadBatchEligibility([call])).toEqual({
      ok: false,
      errorCode,
    });
    await expect(
      executeParallelReadBatch({
        calls: [call],
        stateSnapshot: {},
        externalCallContext: externalCallContext(),
        execute,
      }),
    ).rejects.toMatchObject({
      name: 'ParallelReadBatchError',
      code: errorCode,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a mutation',
      call: {
        id: 'mutation-after-valid-read',
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: 'item-1',
            quantity: 1,
            modifiers: [],
          }],
        },
      } satisfies ParallelReadBatchCall,
      errorCode: 'parallel_read_batch_mutation_forbidden',
    },
    {
      name: 'an approval capability',
      call: {
        id: 'approval-after-valid-read',
        toolName: 'acquireVoucher',
        arguments: { rewardId: 'reward-1' },
      } satisfies ParallelReadBatchCall,
      errorCode: 'parallel_read_batch_approval_forbidden',
    },
    {
      name: 'a dependent read',
      call: {
        id: 'dependent-after-valid-read',
        toolName: 'getItemDetails',
        arguments: { code: 'item-1' },
      } satisfies ParallelReadBatchCall,
      errorCode: 'parallel_read_batch_dependency_forbidden',
    },
  ] as const)(
    'preflights the complete mixed batch before dispatching $name',
    async ({ call, errorCode }) => {
      const execute = vi.fn(async () => ({ ok: true }));

      await expect(
        executeParallelReadBatch({
          calls: [
            readCall({ id: 'eligible-first' }),
            call,
          ],
          stateSnapshot: {},
          externalCallContext: externalCallContext(),
          execute,
        }),
      ).rejects.toMatchObject({ code: errorCode });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: 'item details',
      call: {
        id: 'details',
        toolName: 'getItemDetails',
        arguments: { code: 'item-1' },
      },
    },
    {
      name: 'modifier options',
      call: {
        id: 'modifiers',
        toolName: 'getModifierOptions',
        arguments: { code: 'item-1' },
      },
    },
    {
      name: 'promotion explanation',
      call: {
        id: 'promotion',
        toolName: 'explainPromotion',
        arguments: { offerId: 'offer-1' },
      },
    },
  ] satisfies Array<{
    name: string;
    call: ParallelReadBatchCall;
  }>)(
    'rejects repository-declared dependent $name even when the caller claims no dependency',
    async ({ call }) => {
      const execute = vi.fn(async () => ({ ok: true }));

      await expect(
        executeParallelReadBatch({
          calls: [call],
          stateSnapshot: {},
          externalCallContext: externalCallContext(),
          execute,
        }),
      ).rejects.toMatchObject({
        code: 'parallel_read_batch_dependency_forbidden',
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('reparses strict agent arguments before dispatch', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const invalid = {
      id: 'invalid-arguments',
      toolName: 'searchPromotions',
      arguments: { query: null },
    } as unknown as ParallelReadBatchCall;

    await expect(
      executeParallelReadBatch({
        calls: [invalid],
        stateSnapshot: {},
        externalCallContext: externalCallContext(),
        execute,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_invalid_arguments',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects duplicate exact tool-call identities before dispatch', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const calls = [
      readCall({ id: 'same-provider-id' }),
      readCall({ id: 'same-provider-id', toolName: 'searchPromotions' }),
    ];

    await expect(
      executeParallelReadBatch({
        calls,
        stateSnapshot: {},
        externalCallContext: externalCallContext(),
        execute,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_duplicate_call_id',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'an aborted signal',
      context: () => {
        const controller = new AbortController();
        controller.abort(new DOMException('cancelled', 'AbortError'));
        return externalCallContext(controller.signal);
      },
    },
    {
      name: 'an expired deadline',
      context: () => ({
        signal: new AbortController().signal,
        deadlineAt: Date.now() - 1,
      }),
    },
  ])('does not dispatch after $name', async ({ context }) => {
    const execute = vi.fn(async () => ({ ok: true }));

    await expect(
      executeParallelReadBatch({
        calls: [readCall({ id: 'cancelled-before-dispatch' })],
        stateSnapshot: {},
        externalCallContext: context(),
        execute,
      }),
    ).rejects.toEqual(
      new ParallelReadBatchError('parallel_read_batch_cancelled'),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects promptly when the shared signal aborts and a provider read never settles', async () => {
    const controller = new AbortController();
    const context = externalCallContext(controller.signal);
    const execute = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const pending = executeParallelReadBatch({
      calls: [readCall({ id: 'never-settles' })],
      stateSnapshot: {},
      externalCallContext: context,
      execute,
    });

    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({
      code: 'parallel_read_batch_cancelled',
    });
  });

  it('expires an already-running batch at the shared absolute deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      const context: ExternalCallContext = {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 50,
      };
      const execute = vi.fn(
        () => new Promise<never>(() => undefined),
      );
      const pending = executeParallelReadBatch({
        calls: [readCall({ id: 'deadline-in-flight' })],
        stateSnapshot: {},
        externalCallContext: context,
        execute,
      });

      await Promise.resolve();
      expect(execute).toHaveBeenCalledOnce();
      const cancellation = expect(pending).rejects.toMatchObject({
        code: 'parallel_read_batch_cancelled',
      });
      await vi.advanceTimersByTimeAsync(50);

      await cancellation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not release raw results when the shared signal aborts in flight', async () => {
    const controller = new AbortController();
    const context = externalCallContext(controller.signal);
    const execute = vi.fn(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'));
      return { ok: true };
    });

    await expect(
      executeParallelReadBatch({
        calls: [readCall({ id: 'aborted-result' })],
        stateSnapshot: {},
        externalCallContext: context,
        execute,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_cancelled',
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('discards a private projection draft when cancellation follows an earlier result', async () => {
    const controller = new AbortController();
    const initialAccumulator = { values: [] as string[] };
    const results: IndexedParallelReadResult<{ value: string }>[] = [
      {
        index: 0,
        id: 'first',
        request: parallelReadRequest(),
        result: { value: 'first' },
      },
      {
        index: 1,
        id: 'second',
        request: parallelReadRequest(),
        result: { value: 'second' },
      },
    ];
    const project = vi.fn((privateDraft: { values: string[] }, entry) => {
      privateDraft.values.push(entry.result.value);
      if (entry.index === 0) {
        controller.abort(new DOMException('cancelled', 'AbortError'));
      }
    });

    await expect(
      projectParallelReadResultsInOrder({
        results,
        initialAccumulator,
        externalCallContext: externalCallContext(controller.signal),
        assertActive: vi.fn(),
        project,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_cancelled',
    });
    expect(project).toHaveBeenCalledOnce();
    expect(initialAccumulator).toEqual({ values: [] });
  });

  it('discards a private projection draft when run ownership fails between results', async () => {
    const initialAccumulator = { values: [] as string[] };
    const results: IndexedParallelReadResult<{ value: string }>[] = [
      {
        index: 0,
        id: 'first',
        request: parallelReadRequest(),
        result: { value: 'first' },
      },
      {
        index: 1,
        id: 'second',
        request: parallelReadRequest(),
        result: { value: 'second' },
      },
    ];
    let activeChecks = 0;
    const assertActive = vi.fn(() => {
      activeChecks += 1;
      if (activeChecks === 4) throw new Error('run_no_longer_current');
    });
    const project = vi.fn((privateDraft: { values: string[] }, entry) => {
      privateDraft.values.push(entry.result.value);
    });

    await expect(
      projectParallelReadResultsInOrder({
        results,
        initialAccumulator,
        externalCallContext: externalCallContext(),
        assertActive,
        project,
      }),
    ).rejects.toThrow('run_no_longer_current');
    expect(project).toHaveBeenCalledOnce();
    expect(initialAccumulator).toEqual({ values: [] });
  });

  it('cancels a never-settling ownership assertion on explicit abort', async () => {
    const controller = new AbortController();
    const initialAccumulator = { values: [] as string[] };
    const assertActive = vi.fn(
      () => new Promise<void>(() => undefined),
    );
    const project = vi.fn();
    const pending = projectParallelReadResultsInOrder({
      results: singleProjectionResult(),
      initialAccumulator,
      externalCallContext: externalCallContext(controller.signal),
      assertActive,
      project,
    });

    await Promise.resolve();
    expect(assertActive).toHaveBeenCalledOnce();
    const cancellation = expect(pending).rejects.toMatchObject({
      code: 'parallel_read_batch_cancelled',
    });
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await cancellation;
    expect(project).not.toHaveBeenCalled();
    expect(initialAccumulator).toEqual({ values: [] });
  });

  it('expires a never-settling ownership assertion at the shared deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      const initialAccumulator = { values: [] as string[] };
      const assertActive = vi.fn(
        () => new Promise<void>(() => undefined),
      );
      const project = vi.fn();
      const pending = projectParallelReadResultsInOrder({
        results: singleProjectionResult(),
        initialAccumulator,
        externalCallContext: {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 50,
        },
        assertActive,
        project,
      });

      await Promise.resolve();
      expect(assertActive).toHaveBeenCalledOnce();
      const cancellation = expect(pending).rejects.toMatchObject({
        code: 'parallel_read_batch_cancelled',
      });
      await vi.advanceTimersByTimeAsync(50);

      await cancellation;
      expect(project).not.toHaveBeenCalled();
      expect(initialAccumulator).toEqual({ values: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a never-settling private projector on explicit abort', async () => {
    const controller = new AbortController();
    const initialAccumulator = { values: [] as string[] };
    const assertActive = vi.fn();
    const project = vi.fn((privateDraft: { values: string[] }) => {
      privateDraft.values.push('partial');
      return new Promise<void>(() => undefined);
    });
    const pending = projectParallelReadResultsInOrder({
      results: singleProjectionResult(),
      initialAccumulator,
      externalCallContext: externalCallContext(controller.signal),
      assertActive,
      project,
    });

    for (let attempt = 0;
      attempt < 10 && project.mock.calls.length === 0;
      attempt += 1) {
      await Promise.resolve();
    }
    expect(project).toHaveBeenCalledOnce();
    const cancellation = expect(pending).rejects.toMatchObject({
      code: 'parallel_read_batch_cancelled',
    });
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await cancellation;
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(initialAccumulator).toEqual({ values: [] });
  });

  it('expires a never-settling private projector at the shared deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      const initialAccumulator = { values: [] as string[] };
      const assertActive = vi.fn();
      const project = vi.fn((privateDraft: { values: string[] }) => {
        privateDraft.values.push('partial');
        return new Promise<void>(() => undefined);
      });
      const pending = projectParallelReadResultsInOrder({
        results: singleProjectionResult(),
        initialAccumulator,
        externalCallContext: {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 50,
        },
        assertActive,
        project,
      });

      for (let attempt = 0;
        attempt < 10 && project.mock.calls.length === 0;
        attempt += 1) {
        await Promise.resolve();
      }
      expect(project).toHaveBeenCalledOnce();
      const cancellation = expect(pending).rejects.toMatchObject({
        code: 'parallel_read_batch_cancelled',
      });
      await vi.advanceTimersByTimeAsync(50);

      await cancellation;
      expect(assertActive).toHaveBeenCalledTimes(2);
      expect(initialAccumulator).toEqual({ values: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects non-plain snapshot data before provider dispatch', async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    await expect(
      executeParallelReadBatch({
        calls: [readCall({ id: 'plain-data-only' })],
        stateSnapshot: { observedAt: new Date() },
        externalCallContext: externalCallContext(),
        execute,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_input_not_plain_data',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects ambiguous indexes before serial projection', async () => {
    const duplicate = [
      {
        index: 0,
        id: 'first',
        request: parallelReadRequest(),
        result: { ok: true },
      },
      {
        index: 0,
        id: 'second',
        request: parallelReadRequest(),
        result: { ok: true },
      },
    ];
    const project = vi.fn();

    await expect(
      projectParallelReadResultsInOrder({
        results: duplicate,
        initialAccumulator: {},
        externalCallContext: externalCallContext(),
        assertActive: vi.fn(),
        project,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_duplicate_index',
    });
    expect(project).not.toHaveBeenCalled();
  });

  it('rejects an indexed-result gap before serial projection', async () => {
    const gap = [
      {
        index: 0,
        id: 'first',
        request: parallelReadRequest(),
        result: { ok: true },
      },
      {
        index: 2,
        id: 'third',
        request: parallelReadRequest(),
        result: { ok: true },
      },
    ];
    const project = vi.fn();

    await expect(
      projectParallelReadResultsInOrder({
        results: gap,
        initialAccumulator: {},
        externalCallContext: externalCallContext(),
        assertActive: vi.fn(),
        project,
      }),
    ).rejects.toMatchObject({
      code: 'parallel_read_batch_non_contiguous_index',
    });
    expect(project).not.toHaveBeenCalled();
  });
});
