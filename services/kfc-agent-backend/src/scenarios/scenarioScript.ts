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
    noCartMutationBeforeUserTurn?: number | undefined;
    cartAfterUserTurn?: Record<string, {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number | undefined }>;
      totalVnd: number;
    }> | undefined;
    assistantAfterUserTurnContains?: Record<string, string[]> | undefined;
    finalCart?: {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number | undefined }>;
      excludedItemCodes: string[];
      totalVnd: number;
    } | undefined;
  } | undefined;
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
