import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ScenarioCapturePlan {
  version: number;
  description: string;
  scenarios: Array<{
    fileName: string;
    requiredWidgetKinds: string[];
    expectedWidgetsByUserTurn: Record<string, string>;
    acceptableWidgetsByUserTurn?: Record<string, string[]>;
  }>;
}

interface ScenarioScript {
  id: string;
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    text: string;
    useCases?: string[];
  }>;
}

export function syncFlutterGenUiScenarioData(
  capturePlanPath: string,
  scenariosRoot: string,
  outputPath: string,
): void {
  writeFileSync(outputPath, renderFlutterGenUiScenarioData(capturePlanPath, scenariosRoot));
}

export function renderFlutterGenUiScenarioData(
  capturePlanPath: string,
  scenariosRoot: string,
): string {
  const capturePlan = readJson<ScenarioCapturePlan>(capturePlanPath);
  return renderFlutterGenUiScenarioDataFromPlan(capturePlan, scenariosRoot);
}

export function renderFlutterGenUiScenarioDataFromPlan(
  capturePlan: ScenarioCapturePlan,
  scenariosRoot: string,
): string {
  const scenarioEntries = capturePlan.scenarios.map(({ fileName }) => {
    const script = readJson<ScenarioScript>(resolve(scenariosRoot, fileName));
    const userScript = {
      id: script.id,
      turns: script.turns
        .filter((turn) => turn.speaker === 'User')
        .map(({ index, speaker, text, useCases }) => ({ index, speaker, text, useCases })),
    };
    return `  ${JSON.stringify(fileName)}: ${dartRawJson(userScript)},`;
  });

  const output = [
    '// Generated test data for backend-backed customer-chat GenUI integration tests.',
    '// Source: backend GenUI scenario capture plan.',
    '// Source: ai-talent-tracks/fnb/conversations/*.json user turns only.',
    '// Generated before a counted proof. Do not edit manually.',
    '',
    `const genUiScenarioCapturePlanJson = ${dartRawJson(capturePlan)};`,
    '',
    'const genUiScenarioJsonByFileName = <String, String>{',
    ...scenarioEntries,
    '};',
    '',
  ].join('\n');

  return output;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function dartRawJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (json.includes("'''")) {
    throw new Error('Scenario data cannot contain a triple single quote in a Dart raw string.');
  }
  return `r'''${json}'''`;
}
