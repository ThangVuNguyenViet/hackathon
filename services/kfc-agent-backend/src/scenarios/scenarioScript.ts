import { readFile } from 'node:fs/promises';

export interface ScenarioTurn {
  index: number;
  speaker: 'User' | 'Bot';
  text: string;
  useCases: string[];
}

export interface ScenarioScriptJson {
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'kfc';
  goal: string;
  useCases: string[];
  finalState: string;
  acceptance?: {
    noCartMutationBeforeUserTurn?: number;
    cartAfterUserTurn?: Record<string, {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number }>;
      totalVnd: number;
    }>;
    assistantAfterUserTurnContains?: Record<string, string[]>;
    finalCart?: {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number }>;
      excludedItemCodes: string[];
      totalVnd: number;
    };
  };
  turns: ScenarioTurn[];
  expectations: string[];
}

export interface ScenarioScript extends ScenarioScriptJson {
  userTurns: ScenarioTurn[];
}

export async function loadScenarioScript(filePath: string): Promise<ScenarioScript> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as ScenarioScriptJson;
  return {
    ...raw,
    userTurns: raw.turns.filter((turn) => turn.speaker === 'User'),
  };
}
