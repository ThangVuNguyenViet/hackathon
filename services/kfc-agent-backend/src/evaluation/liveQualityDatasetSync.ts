import { isDeepStrictEqual } from 'node:util';
import type { Client } from 'langsmith';
import {
  LIVE_QUALITY_DATASET_DESCRIPTION,
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_EXPECTED_CASE_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveQualityDatasetCase,
  type LiveQualityMode,
} from './liveQualityContracts.js';
import {
  expectationForLiveQualityMode,
  liveQualityCaseFingerprint,
  liveQualityInventoryDigest,
} from './liveQualityDataset.js';
import { liveQualityDatasetCaseSchema } from './liveQualitySchemas.js';

interface ExistingExample {
  id: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

interface DatasetBoundary {
  id: string;
  name: string;
  description: string;
  data_type?: string;
  metadata?: Record<string, unknown> | null;
}

export interface LiveQualityDatasetSyncResult {
  datasetId: string;
  datasetUrl: string | null;
  created: string[];
  updated: string[];
  unchanged: string[];
  deleted: string[];
}

function assertOwnedDataset(dataset: DatasetBoundary): void {
  const metadata = dataset.metadata;
  const isOwned =
    dataset.name === LIVE_QUALITY_DATASET_NAME &&
    dataset.description === LIVE_QUALITY_DATASET_DESCRIPTION &&
    dataset.data_type === 'kv' &&
    metadata?.managedBy === LIVE_QUALITY_SYNC_OWNER &&
    metadata.datasetName === LIVE_QUALITY_DATASET_NAME &&
    metadata.schemaVersion === LIVE_QUALITY_SCHEMA_VERSION &&
    metadata.sourcePath === LIVE_QUALITY_SOURCE_PATH;
  if (!isOwned) {
    throw new Error(
      `Refusing to synchronize unowned LangSmith dataset ${JSON.stringify({
        id: dataset.id,
        name: dataset.name,
      })}`,
    );
  }
}

function assertDesiredCases(cases: readonly unknown[]): Map<string, LiveQualityDatasetCase> {
  const desiredByCaseId = new Map<string, LiveQualityDatasetCase>();
  const casesByTurn = new Map<
    string,
    Partial<Record<LiveQualityMode, LiveQualityDatasetCase>>
  >();
  for (const [index, candidate] of cases.entries()) {
    const parsed = liveQualityDatasetCaseSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(({ path, message }) => `${path.join('.') || '<root>'}: ${message}`)
        .join('; ');
      throw new Error(`Refusing invalid live quality case at index ${index}: ${issues}`);
    }
    const testCase = parsed.data;
    const { inputs, outputs, metadata, split } = testCase;
    const fingerprint = liveQualityCaseFingerprint({
      inputs,
      outputs,
      metadata: {
        caseId: metadata.caseId,
        schemaVersion: metadata.schemaVersion,
        inventoryVersion: metadata.inventoryVersion,
        sourcePath: metadata.sourcePath,
        datasetName: metadata.datasetName,
        managedBy: metadata.managedBy,
      },
      split,
    });
    const isManaged =
      metadata.caseId === inputs.caseId &&
      metadata.schemaVersion === LIVE_QUALITY_SCHEMA_VERSION &&
      metadata.sourcePath === LIVE_QUALITY_SOURCE_PATH &&
      metadata.datasetName === LIVE_QUALITY_DATASET_NAME &&
      metadata.managedBy === LIVE_QUALITY_SYNC_OWNER &&
      split === LIVE_QUALITY_DATASET_SPLIT &&
      metadata.fingerprint === fingerprint;
    const expectedTurnId = `${inputs.scenarioFile}#${inputs.turnIndex}`;
    const isBoundToTurn =
      outputs.expectation.id === expectedTurnId &&
      outputs.expectation.turnIndex === inputs.turnIndex &&
      inputs.caseId === `${expectedTurnId}:${inputs.mode}` &&
      metadata.caseId === inputs.caseId &&
      inputs.customerMessage === outputs.expectation.input &&
      isDeepStrictEqual(inputs.preconditions, outputs.expectation.preconditions) &&
      isDeepStrictEqual(inputs.evidenceBindings, outputs.expectation.evidenceBindings);
    if (!isManaged || !isBoundToTurn) {
      throw new Error(`Refusing invalid live quality case ${JSON.stringify(inputs.caseId)}`);
    }
    if (desiredByCaseId.has(inputs.caseId)) {
      throw new Error(`Duplicate live quality case ${JSON.stringify(inputs.caseId)}`);
    }
    desiredByCaseId.set(inputs.caseId, testCase);
    const modes = casesByTurn.get(expectedTurnId) ?? {};
    if (modes[inputs.mode]) {
      throw new Error(
        `Duplicate live quality mode ${JSON.stringify(inputs.mode)} for ${JSON.stringify(expectedTurnId)}`,
      );
    }
    modes[inputs.mode] = testCase;
    casesByTurn.set(expectedTurnId, modes);
  }
  if (
    desiredByCaseId.size !== LIVE_QUALITY_EXPECTED_CASE_COUNT ||
    casesByTurn.size !== LIVE_QUALITY_EXPECTED_TURN_COUNT
  ) {
    throw new Error(
      `Refusing incomplete live quality inventory: expected ` +
      `${LIVE_QUALITY_EXPECTED_CASE_COUNT} cases across ${LIVE_QUALITY_EXPECTED_TURN_COUNT} turns, ` +
      `received ${desiredByCaseId.size} cases across ${casesByTurn.size} turns`,
    );
  }
  for (const [turnId, modes] of casesByTurn) {
    if (!modes.genui || !modes.text) {
      throw new Error(`Live quality turn ${JSON.stringify(turnId)} must contain genui and text`);
    }
    const expectedTextExpectation = expectationForLiveQualityMode(
      modes.genui.outputs.expectation,
      'text',
    );
    if (!isDeepStrictEqual(modes.text.outputs.expectation, expectedTextExpectation)) {
      throw new Error(`Live quality turn ${JSON.stringify(turnId)} has divergent mode expectations`);
    }
  }
  const inventoryDigest = liveQualityInventoryDigest([...desiredByCaseId.values()]);
  if (inventoryDigest !== LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST) {
    throw new Error(
      `Refusing non-canonical live quality inventory digest ${JSON.stringify(inventoryDigest)}`,
    );
  }
  return desiredByCaseId;
}

function remoteFingerprint(example: ExistingExample): string {
  const metadata = example.metadata;
  const remoteMetadata = {
    caseId: metadata?.caseId,
    schemaVersion: metadata?.schemaVersion,
    inventoryVersion: metadata?.inventoryVersion,
    sourcePath: metadata?.sourcePath,
    datasetName: metadata?.datasetName,
    managedBy: metadata?.managedBy,
  } as Omit<LiveQualityDatasetCase['metadata'], 'fingerprint'>;
  const datasetSplit = metadata?.dataset_split;
  const split =
    Array.isArray(datasetSplit) &&
    datasetSplit.length === 1 &&
    datasetSplit[0] === LIVE_QUALITY_DATASET_SPLIT
      ? LIVE_QUALITY_DATASET_SPLIT
      : 'invalid-remote-split';
  return liveQualityCaseFingerprint({
    inputs: example.inputs as unknown as LiveQualityDatasetCase['inputs'],
    outputs: example.outputs as unknown as LiveQualityDatasetCase['outputs'],
    metadata: remoteMetadata,
    split,
  });
}

function selectCanonical(
  examples: ExistingExample[],
  desired: LiveQualityDatasetCase,
): { canonical: ExistingExample | undefined; duplicates: ExistingExample[] } {
  const ordered = [...examples].sort((left, right) => {
    const leftExact =
      left.metadata?.fingerprint === desired.metadata.fingerprint &&
      remoteFingerprint(left) === desired.metadata.fingerprint;
    const rightExact =
      right.metadata?.fingerprint === desired.metadata.fingerprint &&
      remoteFingerprint(right) === desired.metadata.fingerprint;
    if (leftExact !== rightExact) return leftExact ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  const [canonical, ...duplicates] = ordered;
  return { canonical, duplicates };
}

export async function syncLiveQualityDataset(
  client: Client,
  cases: readonly unknown[],
): Promise<LiveQualityDatasetSyncResult> {
  const desiredByCaseId = assertDesiredCases(cases);
  const datasetExists = await client.hasDataset({ datasetName: LIVE_QUALITY_DATASET_NAME });
  const dataset = datasetExists
    ? await client.readDataset({ datasetName: LIVE_QUALITY_DATASET_NAME })
    : await client.createDataset(LIVE_QUALITY_DATASET_NAME, {
        description: LIVE_QUALITY_DATASET_DESCRIPTION,
        dataType: 'kv',
        metadata: {
          managedBy: LIVE_QUALITY_SYNC_OWNER,
          datasetName: LIVE_QUALITY_DATASET_NAME,
          schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
          sourcePath: LIVE_QUALITY_SOURCE_PATH,
        },
      });
  const persistedDataset = datasetExists
    ? dataset
    : await client.readDataset({ datasetId: dataset.id });
  assertOwnedDataset(persistedDataset as DatasetBoundary);
  const desiredCaseIds = new Set(desiredByCaseId.keys());
  const existingByCaseId = new Map<string, ExistingExample[]>();
  for await (const example of client.listExamples({ datasetId: persistedDataset.id })) {
    const metadata = example.metadata as Record<string, unknown> | undefined;
    if (!metadata) continue;
    const caseId = metadata?.caseId;
    if (typeof caseId !== 'string') continue;
    const isManaged =
      metadata?.managedBy === LIVE_QUALITY_SYNC_OWNER &&
      metadata.datasetName === LIVE_QUALITY_DATASET_NAME &&
      metadata.sourcePath === LIVE_QUALITY_SOURCE_PATH &&
      metadata.schemaVersion === LIVE_QUALITY_SCHEMA_VERSION;
    if (!isManaged) continue;
    const examples = existingByCaseId.get(caseId) ?? [];
    examples.push({
      id: String(example.id),
      inputs: example.inputs,
      outputs: example.outputs ?? {},
      metadata,
    });
    existingByCaseId.set(caseId, examples);
  }

  const result: LiveQualityDatasetSyncResult = {
    datasetId: String(persistedDataset.id),
    datasetUrl: await client.getDatasetUrl({ datasetId: persistedDataset.id }).catch(() => null),
    created: [],
    updated: [],
    unchanged: [],
    deleted: [],
  };
  const pendingDeletes: Array<{ caseId: string; id: string }> = [];

  for (const testCase of desiredByCaseId.values()) {
    const existing = existingByCaseId.get(testCase.inputs.caseId) ?? [];
    const { canonical, duplicates } = selectCanonical(existing, testCase);
    if (!canonical) {
      await client.createExample({
        dataset_id: persistedDataset.id,
        inputs: testCase.inputs,
        outputs: testCase.outputs,
        metadata: testCase.metadata,
        split: testCase.split,
      });
      result.created.push(testCase.inputs.caseId);
      continue;
    }
    if (
      canonical.metadata?.fingerprint === testCase.metadata.fingerprint &&
      remoteFingerprint(canonical) === testCase.metadata.fingerprint
    ) {
      result.unchanged.push(testCase.inputs.caseId);
    } else {
      await client.updateExample({
        id: canonical.id,
        inputs: testCase.inputs,
        outputs: testCase.outputs,
        metadata: testCase.metadata,
        split: testCase.split,
      });
      result.updated.push(testCase.inputs.caseId);
    }
    for (const duplicate of duplicates) {
      pendingDeletes.push({ caseId: testCase.inputs.caseId, id: duplicate.id });
    }
  }

  for (const [caseId, examples] of existingByCaseId) {
    if (desiredCaseIds.has(caseId)) continue;
    for (const example of examples) {
      pendingDeletes.push({ caseId, id: example.id });
    }
  }
  for (const pendingDelete of pendingDeletes) {
    await client.deleteExample(pendingDelete.id);
    result.deleted.push(pendingDelete.caseId);
  }
  return result;
}
