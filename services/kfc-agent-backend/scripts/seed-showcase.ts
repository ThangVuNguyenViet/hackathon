import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'langsmith';
import { parseScenarioScript } from '../src/scenarios/scenarioScript.js';

const backendRoot = resolve(import.meta.dirname, '..');
const scenariosRoot = resolve(
  backendRoot,
  '../../ai-talent-tracks/fnb/conversations',
);
const datasetName =
  process.env.KFC_SHOWCASE_DATASET?.trim() || 'kfc-showcase-scenarios-v1';
const apiKey = process.env.LANGSMITH_API_KEY?.trim();
if (!apiKey) throw new Error('LANGSMITH_API_KEY is required');

const client = new Client({ apiKey, apiUrl: process.env.LANGSMITH_ENDPOINT });
const dataset = (await client.hasDataset({ datasetName }))
  ? await client.readDataset({ datasetName })
  : await client.createDataset(datasetName, {
      description:
        'PM-curated KFC scenario narratives with preconditions, customer turns, and review risks.',
      dataType: 'kv',
      metadata: { schemaVersion: 'kfc-showcase-v1' },
    });
const existing = new Set<string>();
for await (const example of client.listExamples({ datasetId: dataset.id })) {
  const scenarioId = (example.inputs as Record<string, unknown>).scenarioId;
  if (typeof scenarioId === 'string') existing.add(scenarioId);
}
const scripts = readdirSync(scenariosRoot)
  .filter((name) => /^\d{2}-.*\.json$/.test(name))
  .sort()
  .map((name) =>
    parseScenarioScript(
      JSON.parse(readFileSync(resolve(scenariosRoot, name), 'utf8')),
    ),
  );
const created: string[] = [];
for (const scenario of scripts) {
  if (existing.has(scenario.id)) continue;
  await client.createExample({
    dataset_id: dataset.id,
    inputs: {
      scenarioId: scenario.id,
      title: scenario.title,
      goal: scenario.goal,
      preconditions: scenario.preconditions,
      useCases: scenario.useCases,
      turns: scenario.turns
        .filter((turn) => turn.speaker === 'User')
        .map(({ index, text, useCases }) => ({ index, text, useCases })),
    },
    outputs: { risks: scenario.risks },
    metadata: { schemaVersion: 'kfc-showcase-v1', scenarioId: scenario.id },
    split: 'showcase',
  });
  created.push(scenario.id);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      datasetName,
      purpose: 'read_only_narrative_inventory',
      total: scripts.length,
      created,
      existing: scripts
        .map((scenario) => scenario.id)
        .filter((scenarioId) => existing.has(scenarioId)),
    },
    null,
    2,
  ),
);
