import {
  AgentPackRegistry,
  type AgentPack,
  type AgentProfile,
  type PreparedTurnResources,
} from '../business/agentPack.js';

type MaybePromise<T> = Promise<T> | T;

export interface ExecutableAgentPack<
  TTurnInput,
  TResult,
  TPresentation = unknown,
> extends AgentPack<TTurnInput, unknown, TResult, TPresentation> {
  execute(input: {
    readonly turn: TTurnInput;
    readonly profile: AgentProfile;
    readonly prepared: PreparedTurnResources;
  }): MaybePromise<TResult>;
}

export interface AgentTurnRunnerOptions<
  TTurnInput,
  TResult,
  TPresentation = unknown,
> {
  readonly packs: readonly ExecutableAgentPack<
    TTurnInput,
    TResult,
    TPresentation
  >[];
  readonly expectedPackIds?: readonly string[];
}

export interface AgentTurnRunnerResult<TResult, TPresentation = unknown> {
  readonly result: TResult;
  readonly presentation?: TPresentation;
}

/** Business-neutral direct-turn shell. Pack selection is always explicit. */
export class AgentTurnRunner<TTurnInput, TResult, TPresentation = unknown> {
  readonly #registry: AgentPackRegistry<
    ExecutableAgentPack<TTurnInput, TResult, TPresentation>
  >;

  constructor(
    options: AgentTurnRunnerOptions<TTurnInput, TResult, TPresentation>,
  ) {
    this.#registry = new AgentPackRegistry(options.packs, {
      expectedIds: options.expectedPackIds,
    });
  }

  async run(input: {
    readonly packId: string | null | undefined;
    readonly turn: TTurnInput;
  }): Promise<AgentTurnRunnerResult<TResult, TPresentation>> {
    const pack = this.#registry.require(input.packId);
    const prepared = await pack.prepareTurn(input.turn);
    let result: TResult;
    try {
      result = await pack.execute({
        turn: input.turn,
        profile: pack.profile,
        prepared,
      });
    } catch (error) {
      await pack.lifecycle?.onRunFailed?.({ prepared, error });
      throw error;
    }

    await pack.lifecycle?.onRunSucceeded?.({ prepared, result });
    const presentation = await pack.presentation?.present({ prepared, result });
    return {
      result,
      ...(presentation !== undefined ? { presentation } : {}),
    };
  }
}
