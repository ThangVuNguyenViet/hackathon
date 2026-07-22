import type { ExternalCallContext } from '../clients/interfaces.js';
import type { z } from 'zod';
import {
  externalCallIsCancelled,
} from '../ordering/toolExecutor.js';
import {
  agentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';
import { agentToolArgumentSchemas } from '../ordering/toolCatalog.js';
import type { ToolName } from '../ordering/types.js';

export type DeepReadonly<Value> =
  Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export const independentParallelReadToolNames = [
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
] as const satisfies readonly ToolName[];

export type IndependentParallelReadToolName =
  (typeof independentParallelReadToolNames)[number];

export type ValidatedAgentToolRequest = {
  [Name in ToolName]: {
    readonly toolName: Name;
    readonly arguments: z.infer<(typeof agentToolArgumentSchemas)[Name]>;
  };
}[ToolName];

export type ValidatedParallelReadRequest = {
  [Name in IndependentParallelReadToolName]: {
    readonly toolName: Name;
    readonly arguments: z.infer<(typeof agentToolArgumentSchemas)[Name]>;
  };
}[IndependentParallelReadToolName];

export interface ParallelReadBatchCall {
  /** Exact provider tool-call identity; never normalized or regenerated here. */
  readonly id: string;
  readonly toolName: ToolName;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ParallelReadExecution<Snapshot> {
  readonly index: number;
  readonly id: string;
  readonly request: DeepReadonly<ValidatedParallelReadRequest>;
  readonly stateSnapshot: DeepReadonly<Snapshot>;
  readonly externalCallContext: ExternalCallContext;
}

export interface IndexedParallelReadResult<RawResult> {
  readonly index: number;
  readonly id: string;
  readonly request: DeepReadonly<ValidatedParallelReadRequest>;
  readonly result: RawResult;
}

export type ParallelReadBatchErrorCode =
  | 'parallel_read_batch_empty'
  | 'parallel_read_batch_invalid_index'
  | 'parallel_read_batch_duplicate_index'
  | 'parallel_read_batch_non_contiguous_index'
  | 'parallel_read_batch_duplicate_call_id'
  | 'parallel_read_batch_approval_forbidden'
  | 'parallel_read_batch_mutation_forbidden'
  | 'parallel_read_batch_dependency_forbidden'
  | 'parallel_read_batch_invalid_arguments'
  | 'parallel_read_batch_input_not_plain_data'
  | 'parallel_read_batch_cancelled';

export type ParallelReadBatchEligibilityErrorCode =
  | 'parallel_read_batch_empty'
  | 'parallel_read_batch_duplicate_call_id'
  | 'parallel_read_batch_approval_forbidden'
  | 'parallel_read_batch_mutation_forbidden'
  | 'parallel_read_batch_dependency_forbidden'
  | 'parallel_read_batch_invalid_arguments';

export type ParallelReadBatchEligibility =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errorCode: ParallelReadBatchEligibilityErrorCode;
    };

export class ParallelReadBatchError extends Error {
  readonly code: ParallelReadBatchErrorCode;

  constructor(code: ParallelReadBatchErrorCode) {
    super(code);
    this.name = 'ParallelReadBatchError';
    this.code = code;
  }
}

const independentParallelReadToolNameSet = new Set<ToolName>(
  independentParallelReadToolNames,
);

function isIndependentParallelReadToolName(
  toolName: ToolName,
): toolName is IndependentParallelReadToolName {
  return independentParallelReadToolNameSet.has(toolName);
}

export function parallelReadBatchEligibility(
  calls: readonly ParallelReadBatchCall[],
): ParallelReadBatchEligibility {
  if (calls.length === 0) {
    return { ok: false, errorCode: 'parallel_read_batch_empty' };
  }

  const callIds = new Set<string>();
  for (const call of calls) {
    if (callIds.has(call.id)) {
      return {
        ok: false,
        errorCode: 'parallel_read_batch_duplicate_call_id',
      };
    }
    callIds.add(call.id);

    const disposition = agentToolCallDisposition(
      call.toolName,
      call.arguments,
    );
    if (!disposition.success) {
      return {
        ok: false,
        errorCode: 'parallel_read_batch_invalid_arguments',
      };
    }
    if (disposition.data.effect === 'irreversible_mutation') {
      return {
        ok: false,
        errorCode: 'parallel_read_batch_approval_forbidden',
      };
    }
    if (disposition.data.effect !== 'provider_read') {
      return {
        ok: false,
        errorCode: 'parallel_read_batch_mutation_forbidden',
      };
    }
    if (
      !isIndependentParallelReadToolName(call.toolName)
    ) {
      return {
        ok: false,
        errorCode: 'parallel_read_batch_dependency_forbidden',
      };
    }
  }
  return { ok: true };
}

function deepFreezePlainData(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new ParallelReadBatchError(
      'parallel_read_batch_input_not_plain_data',
    );
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezePlainData(Reflect.get(value, key), seen);
  }
  Object.freeze(value);
}

function assertPlainData(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new ParallelReadBatchError(
      'parallel_read_batch_input_not_plain_data',
    );
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    assertPlainData(Reflect.get(value, key), seen);
  }
}

function immutablePlainDataClone<Value>(value: Value): DeepReadonly<Value> {
  try {
    const clone = structuredClone(value);
    deepFreezePlainData(clone);
    return clone as DeepReadonly<Value>;
  } catch (error) {
    if (error instanceof ParallelReadBatchError) throw error;
    throw new ParallelReadBatchError(
      'parallel_read_batch_input_not_plain_data',
    );
  }
}

function mutablePlainDataClone<Value>(value: Value): Value {
  try {
    const clone = structuredClone(value);
    assertPlainData(clone);
    return clone;
  } catch (error) {
    if (error instanceof ParallelReadBatchError) throw error;
    throw new ParallelReadBatchError(
      'parallel_read_batch_input_not_plain_data',
    );
  }
}

function validatedParallelReadRequest(
  request: ParallelReadBatchCall,
): ValidatedParallelReadRequest {
  if (!isIndependentParallelReadToolName(request.toolName)) {
    throw new ParallelReadBatchError(
      'parallel_read_batch_dependency_forbidden',
    );
  }
  const parsed = agentToolArgumentSchemas[request.toolName]
    .safeParse(request.arguments);
  if (!parsed.success) {
    throw new ParallelReadBatchError(
      'parallel_read_batch_invalid_arguments',
    );
  }
  return {
    toolName: request.toolName,
    arguments: parsed.data,
  } as ValidatedParallelReadRequest;
}

function throwIfCancelled(context: ExternalCallContext): void {
  if (externalCallIsCancelled(context)) {
    throw new ParallelReadBatchError('parallel_read_batch_cancelled');
  }
}

async function settleWithinExternalCallContext<Value>(
  operation: () => Promise<Value>,
  context: ExternalCallContext,
  abortAtDeadline?: () => void,
): Promise<Value> {
  throwIfCancelled(context);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = () => {
      reject(new ParallelReadBatchError('parallel_read_batch_cancelled'));
    };
    context.signal.addEventListener('abort', rejectCancellation, {
      once: true,
    });
    timeout = setTimeout(() => {
      abortAtDeadline?.();
      rejectCancellation?.();
    }, Math.max(0, context.deadlineAt - Date.now()));
  });
  try {
    return await Promise.race([operation(), cancellation]);
  } finally {
    if (rejectCancellation) {
      context.signal.removeEventListener('abort', rejectCancellation);
    }
    if (timeout) clearTimeout(timeout);
  }
}

function parallelReadExternalCallScope(
  parent: ExternalCallContext,
): {
  context: ExternalCallContext;
  abortAtDeadline(): void;
  dispose(): void;
} {
  const controller = new AbortController();
  const forwardParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parent.signal.reason);
    }
  };
  parent.signal.addEventListener('abort', forwardParentAbort, { once: true });
  if (parent.signal.aborted) forwardParentAbort();
  return {
    context: Object.freeze({
      signal: controller.signal,
      deadlineAt: parent.deadlineAt,
    }),
    abortAtDeadline() {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException(
          'Parallel read batch deadline exceeded',
          'TimeoutError',
        ));
      }
    },
    dispose() {
      parent.signal.removeEventListener('abort', forwardParentAbort);
    },
  };
}

function orderedByIndex<Entry extends { readonly index: number }>(
  entries: readonly Entry[],
): Entry[] {
  const indexes = new Set<number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.index) || entry.index < 0) {
      throw new ParallelReadBatchError('parallel_read_batch_invalid_index');
    }
    if (indexes.has(entry.index)) {
      throw new ParallelReadBatchError(
        'parallel_read_batch_duplicate_index',
      );
    }
    indexes.add(entry.index);
  }
  const ordered = [...entries].sort((left, right) => left.index - right.index);
  if (ordered.some((entry, index) => entry.index !== index)) {
    throw new ParallelReadBatchError(
      'parallel_read_batch_non_contiguous_index',
    );
  }
  return ordered;
}

async function allOperationsSettled<Value>(
  operations: readonly Promise<Value>[],
): Promise<Value[]> {
  const settled = await Promise.allSettled(operations);
  const firstFailure = settled.find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected',
  );
  if (firstFailure) throw firstFailure.reason;
  return settled.map((result) => {
    if (result.status !== 'fulfilled') {
      throw new Error('parallel_read_batch_unreachable_rejection');
    }
    return result.value;
  });
}

export async function executeParallelReadBatch<Snapshot, RawResult>(input: {
  readonly calls: readonly ParallelReadBatchCall[];
  readonly stateSnapshot: Snapshot;
  readonly externalCallContext: ExternalCallContext;
  readonly execute: (
    execution: ParallelReadExecution<Snapshot>,
  ) => Promise<RawResult>;
}): Promise<readonly IndexedParallelReadResult<RawResult>[]> {
  const eligibility = parallelReadBatchEligibility(input.calls);
  if (!eligibility.ok) {
    throw new ParallelReadBatchError(eligibility.errorCode);
  }
  const externalCallScope = parallelReadExternalCallScope(
    input.externalCallContext,
  );
  try {
    throwIfCancelled(externalCallScope.context);
    const stateSnapshot = immutablePlainDataClone(input.stateSnapshot);
    const calls = input.calls.map((call, index) => ({
      index,
      id: call.id,
      request: immutablePlainDataClone(
        validatedParallelReadRequest(call),
      ),
    }));
    const results = await settleWithinExternalCallContext(
      () => allOperationsSettled(calls.map(async (call) => Object.freeze({
          index: call.index,
          id: call.id,
          request: call.request,
          result: await input.execute({
            index: call.index,
            id: call.id,
            request: call.request,
            stateSnapshot,
            externalCallContext: externalCallScope.context,
          }),
        }))),
      externalCallScope.context,
      externalCallScope.abortAtDeadline,
    );

    throwIfCancelled(externalCallScope.context);
    return Object.freeze(results);
  } finally {
    externalCallScope.dispose();
  }
}

export async function projectParallelReadResultsInOrder<
  RawResult,
  Accumulator,
>(input: {
  readonly results: readonly IndexedParallelReadResult<RawResult>[];
  /**
   * The projector always clones this value. Only the returned draft may be
   * committed, so a failed/cancelled projection cannot leak partial state.
   */
  readonly initialAccumulator: Accumulator;
  readonly externalCallContext: ExternalCallContext;
  /**
   * Integration supplies run-ownership/supersession validation. It is checked
   * before and after every projection together with the shared turn deadline.
   */
  readonly assertActive: () => void | Promise<void>;
  readonly project: (
    privateDraft: Accumulator,
    entry: IndexedParallelReadResult<RawResult>,
  ) => void | Promise<void>;
}): Promise<Accumulator> {
  const ordered = orderedByIndex(input.results);
  const assertActive = async () => {
    await settleWithinExternalCallContext(
      async () => {
        await input.assertActive();
      },
      input.externalCallContext,
    );
    throwIfCancelled(input.externalCallContext);
  };
  await assertActive();
  const privateDraft = mutablePlainDataClone(input.initialAccumulator);
  for (const entry of ordered) {
    await assertActive();
    await settleWithinExternalCallContext(
      async () => {
        await input.project(privateDraft, entry);
      },
      input.externalCallContext,
    );
    await assertActive();
  }
  return privateDraft;
}
