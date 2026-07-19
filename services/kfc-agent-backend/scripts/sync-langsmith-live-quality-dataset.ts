import { Client } from 'langsmith';
import { buildLiveQualityDatasetCases } from '../src/evaluation/liveQualityDataset.js';
import {
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
} from '../src/evaluation/liveQualityContracts.js';
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
const legacyDatasetName = 'kfc-live-quality-v1';
let legacyDatasetDisposition: 'absent' | 'superseded' | 'unowned_skipped' = 'absent';
if (await client.hasDataset({ datasetName: legacyDatasetName })) {
  const legacy = await client.readDataset({ datasetName: legacyDatasetName });
  const legacyMetadata = (legacy as unknown as {
    metadata?: Record<string, unknown> | null;
  }).metadata;
  if (
    legacyMetadata?.managedBy === LIVE_QUALITY_SYNC_OWNER &&
    legacyMetadata?.sourcePath === LIVE_QUALITY_SOURCE_PATH &&
    legacyMetadata?.schemaVersion === 'kfc-live-quality-v1'
  ) {
    await client.updateDataset({
      datasetId: legacy.id,
      description:
        `Superseded by ${LIVE_QUALITY_DATASET_NAME}. Retained read-only as rollback history.`,
    });
    legacyDatasetDisposition = 'superseded';
  } else {
    legacyDatasetDisposition = 'unowned_skipped';
  }
}
await client.awaitPendingTraceBatches();

console.log(JSON.stringify({
  ok: true,
  datasetName: LIVE_QUALITY_DATASET_NAME,
  inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
  caseCount: cases.length,
  legacyDatasetDisposition,
  ...result,
}, null, 2));
