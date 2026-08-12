import {
  AgentPackRegistry,
  type BusinessAgentPack,
} from '../business/agentPack.js';

export interface AgentTurnRunnerOptions<TTurn, TResult> {
  readonly packs: readonly BusinessAgentPack<TTurn, TResult>[];
  readonly expectedPackIds?: readonly string[];
}

/** Business-neutral direct-turn shell. Pack selection is always explicit. */
export class AgentTurnRunner<TTurn, TResult> {
  readonly #registry: AgentPackRegistry<BusinessAgentPack<TTurn, TResult>>;

  constructor(options: AgentTurnRunnerOptions<TTurn, TResult>) {
    this.#registry = new AgentPackRegistry(options.packs, {
      expectedIds: options.expectedPackIds,
    });
  }

  async run(input: {
    readonly packId: string | null | undefined;
    readonly turn: TTurn;
  }): Promise<TResult> {
    return this.#registry.require(input.packId).runTurn(input.turn);
  }
}
