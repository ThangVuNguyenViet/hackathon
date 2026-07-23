import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadScenarioScript } from '../src/scenarios/scenarioScript.js';

const scenarioRoot = resolve('../../ai-talent-tracks/fnb/conversations');
const requestedScenario = process.argv[2];
const scenarioPaths = requestedScenario
  ? [resolve(requestedScenario)]
  : (await readdir(scenarioRoot))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => resolve(scenarioRoot, name));

const scenarios = await Promise.all(
  scenarioPaths.map((scenarioPath) => loadScenarioScript(scenarioPath)),
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 'kfc-scenario-inventory-v1',
      purpose:
        'Read-only narrative prompts for independent role-player and reviewer agents.',
      scenarios,
    },
    null,
    2,
  ),
);
