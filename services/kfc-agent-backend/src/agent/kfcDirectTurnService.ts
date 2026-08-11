import { AgentTurnRunner } from './agentTurnRunner.js';
import {
  KfcAgentPack,
  type DirectAgentTurnInput,
  type DirectAgentTurnResult,
  type KfcAgentPackOptions,
  type PreparedDirectKfcTurn,
} from './kfcAgentPack.js';

export type {
  KfcAgentPackOptions as KfcDirectTurnServiceOptions,
  DirectAgentTurnInput as KfcDirectTurnInput,
  PreparedDirectKfcTurn,
};

export interface KfcDirectTurnResult extends DirectAgentTurnResult {
  session: NonNullable<DirectAgentTurnResult['session']>;
  stateCommit: NonNullable<DirectAgentTurnResult['stateCommit']>;
}

/** Compatibility facade for callers that are already trusted KFC routes. */
export class KfcDirectTurnService {
  readonly #runner: AgentTurnRunner<
    DirectAgentTurnInput,
    DirectAgentTurnResult
  >;

  constructor(options: KfcAgentPackOptions) {
    this.#runner = new AgentTurnRunner({
      packs: [new KfcAgentPack(options)],
      expectedPackIds: ['kfc'],
    });
  }

  async run(input: DirectAgentTurnInput): Promise<KfcDirectTurnResult> {
    if (input.businessId !== undefined && input.businessId !== 'kfc') {
      throw new Error(`agent_pack_id_unknown:${input.businessId}`);
    }
    const { result } = await this.#runner.run({ packId: 'kfc', turn: input });
    if (!result.session || !result.stateCommit) {
      throw new Error('kfc_agent_pack_result_incomplete');
    }
    return {
      ...result,
      session: result.session,
      stateCommit: result.stateCommit,
    };
  }
}
