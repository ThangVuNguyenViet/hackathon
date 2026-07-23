import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const scenarioTurnSchema = z
  .object({
    index: z.number().int().positive(),
    speaker: z.enum(['User', 'Bot']),
    text: z.string().min(1),
    useCases: z.array(z.string().min(1)),
  })
  .strict();

export const scenarioScriptJsonSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    channel: z.enum(['messenger_mock', 'zalo_mock', 'kfc']),
    goal: z.string().min(1),
    preconditions: z.array(z.string().min(1)).min(1),
    useCases: z.array(z.string().min(1)).min(1),
    finalState: z.string().min(1),
    turns: z.array(scenarioTurnSchema).min(1),
    risks: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ScenarioTurn = z.infer<typeof scenarioTurnSchema>;
export type ScenarioScriptJson = z.infer<typeof scenarioScriptJsonSchema>;

export interface ScenarioScript extends ScenarioScriptJson {
  userTurns: ScenarioTurn[];
}

export function parseScenarioScript(value: unknown): ScenarioScript {
  const parsed = scenarioScriptJsonSchema.parse(value);
  return {
    ...parsed,
    userTurns: parsed.turns.filter((turn) => turn.speaker === 'User'),
  };
}

export async function loadScenarioScript(
  filePath: string,
): Promise<ScenarioScript> {
  return parseScenarioScript(JSON.parse(await readFile(filePath, 'utf8')));
}
