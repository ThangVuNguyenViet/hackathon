import { Client } from 'langsmith';
import { buildLiveQualityDatasetCases } from '../src/evaluation/liveQualityDataset.js';
import { LIVE_QUALITY_DATASET_NAME } from '../src/evaluation/liveQualityContracts.js';
import { syncLiveQualityDataset } from '../src/evaluation/liveQualityDatasetSync.js';
import {
  liveScenarioCases,
  SCENARIO_COVERAGE_LEDGER_VERSION,
} from '../test/scenarios/scenarioCoverageLedger.js';

const apiKey = process.env.LANGSMITH_API_KEY?.trim();
if (!apiKey) throw new Error('LANGSMITH_API_KEY is required to synchronize the live quality dataset');

const endpoint = process.env.LANGSMITH_ENDPOINT?.trim();
const client = new Client({
  apiKey,
  ...(endpoint ? { apiUrl: endpoint } : {}),
});
const cases = buildLiveQualityDatasetCases({
  inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
  scenarioCases: liveScenarioCases,
});
const result = await syncLiveQualityDataset(client, cases);
await client.awaitPendingTraceBatches();

console.log(JSON.stringify({
  ok: true,
  datasetName: LIVE_QUALITY_DATASET_NAME,
  inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
  caseCount: cases.length,
  ...result,
}, null, 2));
