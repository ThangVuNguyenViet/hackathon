import type { BusinessAgentPack } from '../../business/agentPack.js';
import {
  runKfcLangChainTurn,
  type KfcAgentTurnInput,
  type KfcLangChainTurnOptions,
  type KfcLangChainTurnResult,
} from './langchainTurnService.js';

export type KfcAgentPackOptions = KfcLangChainTurnOptions;

export class KfcAgentPack implements BusinessAgentPack<
  KfcAgentTurnInput,
  KfcLangChainTurnResult
> {
  readonly id = 'kfc';

  constructor(private readonly options: KfcAgentPackOptions) {}

  runTurn(turn: KfcAgentTurnInput): Promise<KfcLangChainTurnResult> {
    return runKfcLangChainTurn(this.options, turn);
  }
}

export type {
  KfcAgentTurnInput,
  KfcLangChainTurnResult,
} from './langchainTurnService.js';
