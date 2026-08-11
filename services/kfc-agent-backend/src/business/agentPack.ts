import type { FunctionTool } from '@kfc/openai-agents-runtime';

type MaybePromise<T> = Promise<T> | T;

/** Official Agents SDK function tools are passed through without interpretation. */
// The SDK itself uses these three `any` arguments for an opaque function tool.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpaqueFunctionTool = FunctionTool<any, any, any>;

export interface AgentProfile {
  readonly name: string;
  readonly instructions: string;
}

export interface PreparedTurnResources<
  TContext = unknown,
  TTool extends OpaqueFunctionTool = OpaqueFunctionTool,
> {
  readonly tools: readonly TTool[];
  readonly context: TContext;
}

export interface AgentPackLifecycleHooks<
  TPrepared extends PreparedTurnResources = PreparedTurnResources,
  TResult = unknown,
> {
  onRunSucceeded?(input: {
    readonly prepared: TPrepared;
    readonly result: TResult;
  }): MaybePromise<void>;
  onRunFailed?(input: {
    readonly prepared: TPrepared;
    readonly error: unknown;
  }): MaybePromise<void>;
}

export interface AgentPackPresentationHook<
  TPrepared extends PreparedTurnResources = PreparedTurnResources,
  TResult = unknown,
  TPresentation = unknown,
> {
  present(input: {
    readonly prepared: TPrepared;
    readonly result: TResult;
  }): MaybePromise<TPresentation | undefined>;
}

export interface AgentPack<
  TTurnInput = unknown,
  TContext = unknown,
  TResult = unknown,
  TPresentation = unknown,
  TTool extends OpaqueFunctionTool = OpaqueFunctionTool,
> {
  readonly id: string;
  readonly profile: AgentProfile;
  prepareTurn(
    input: TTurnInput,
  ): MaybePromise<PreparedTurnResources<TContext, TTool>>;
  readonly lifecycle?: AgentPackLifecycleHooks<
    PreparedTurnResources<TContext, TTool>,
    TResult
  >;
  readonly presentation?: AgentPackPresentationHook<
    PreparedTurnResources<TContext, TTool>,
    TResult,
    TPresentation
  >;
}

export interface AgentPackRegistryOptions {
  readonly expectedIds?: readonly string[];
}

function requireNonEmptyId(id: string | null | undefined): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('agent_pack_id_missing');
  }
  return id;
}

function validatedUniqueIds(ids: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const candidate of ids) {
    const id = requireNonEmptyId(candidate);
    if (unique.has(id)) {
      throw new Error(`agent_pack_id_duplicate:${id}`);
    }
    unique.add(id);
  }
  return Object.freeze([...unique]);
}

export class AgentPackRegistry<TPack extends AgentPack = AgentPack> {
  readonly #packsById: ReadonlyMap<string, TPack>;
  readonly ids: readonly string[];

  constructor(packs: readonly TPack[], options: AgentPackRegistryOptions = {}) {
    const packIds = validatedUniqueIds(packs.map(({ id }) => id));
    const expectedIds = options.expectedIds
      ? validatedUniqueIds(options.expectedIds)
      : undefined;

    if (expectedIds) {
      const expected = new Set(expectedIds);
      for (const id of packIds) {
        if (!expected.has(id)) {
          throw new Error(`agent_pack_id_unknown:${id}`);
        }
      }
      const registered = new Set(packIds);
      for (const id of expectedIds) {
        if (!registered.has(id)) {
          throw new Error(`agent_pack_registration_missing:${id}`);
        }
      }
    }

    this.ids = packIds;
    this.#packsById = new Map(packs.map((pack) => [pack.id, pack]));
    Object.freeze(this);
  }

  require(id: string | null | undefined): TPack {
    const requiredId = requireNonEmptyId(id);
    const pack = this.#packsById.get(requiredId);
    if (!pack) {
      throw new Error(`agent_pack_id_unknown:${requiredId}`);
    }
    return pack;
  }
}
