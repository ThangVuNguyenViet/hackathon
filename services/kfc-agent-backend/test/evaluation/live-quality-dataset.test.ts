import type { Client } from 'langsmith';
import { describe, expect, it } from 'vitest';
import {
  buildLiveQualityDatasetCases,
  expectationForLiveQualityMode,
  liveQualityCaseFingerprint,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import {
  LIVE_QUALITY_DATASET_DESCRIPTION,
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveQualityDatasetCase,
  type LiveQualityExperimentOutput,
  type TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import { syncLiveQualityDataset } from '../../src/evaluation/liveQualityDatasetSync.js';
import {
  createLiveQualityExperimentEvaluator,
  evaluateLiveQualityOutput,
  requiresSemanticResponseJudge,
} from '../../src/evaluation/liveQualityEvaluators.js';
import type { SemanticResponseJudge } from '../../src/evaluation/semanticResponseJudge.js';
import {
  liveQualityDatasetCaseSchema,
  liveScenarioCaseSchema,
} from '../../src/evaluation/liveQualitySchemas.js';
import {
  liveScenarioCases,
  SCENARIO_COVERAGE_LEDGER_VERSION,
} from '../scenarios/scenarioCoverageLedger.js';

interface FakeExample {
  id: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

class FakeLangSmithClient {
  datasetExists = false;
  dataset = {
    id: 'dataset-live-quality',
    name: LIVE_QUALITY_DATASET_NAME,
    description: LIVE_QUALITY_DATASET_DESCRIPTION,
    data_type: 'kv',
    metadata: {
      managedBy: LIVE_QUALITY_SYNC_OWNER,
      datasetName: LIVE_QUALITY_DATASET_NAME,
      schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
      sourcePath: LIVE_QUALITY_SOURCE_PATH,
    },
  };
  examples: FakeExample[] = [];
  createCalls: string[] = [];
  updateCalls: string[] = [];
  deleteCalls: string[] = [];
  hasDatasetCalls = 0;
  readDatasetCalls = 0;
  readDatasetRequests: Array<{ datasetId?: string; datasetName?: string }> = [];
  listExamplesCalls = 0;
  failCreate = false;
  failUpdate = false;
  readError: Error | undefined;
  createResponseDatasetId: string | undefined;
  persistedDataset: typeof this.dataset | undefined;

  async hasDataset(): Promise<boolean> {
    this.hasDatasetCalls += 1;
    return this.datasetExists;
  }

  async readDataset(request: { datasetId?: string; datasetName?: string }) {
    this.readDatasetCalls += 1;
    this.readDatasetRequests.push(request);
    if (this.readError) throw this.readError;
    return this.persistedDataset ?? this.dataset;
  }

  async createDataset(
    name: string,
    options: {
      description: string;
      dataType: string;
      metadata: Record<string, unknown>;
    },
  ) {
    if (this.failCreate) throw new Error('injected create failure');
    this.datasetExists = true;
    this.dataset = {
      id: 'dataset-live-quality',
      name,
      description: options.description,
      data_type: options.dataType,
      metadata: {
        managedBy: String(options.metadata.managedBy),
        datasetName: String(options.metadata.datasetName),
        schemaVersion: String(options.metadata.schemaVersion),
        sourcePath: String(options.metadata.sourcePath),
      },
    };
    return {
      ...this.dataset,
      id: this.createResponseDatasetId ?? this.dataset.id,
      metadata: undefined,
    };
  }

  async getDatasetUrl() {
    return 'https://smith.test/datasets/dataset-live-quality';
  }

  async *listExamples() {
    this.listExamplesCalls += 1;
    yield* this.examples;
  }

  async createExample(example: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    metadata: Record<string, unknown>;
    split: string;
  }) {
    if (this.failCreate) throw new Error('injected create failure');
    this.createCalls.push(String(example.metadata.caseId));
    this.examples.push({
      id: `example-${this.examples.length + 1}`,
      inputs: structuredClone(example.inputs),
      outputs: structuredClone(example.outputs),
      metadata: { ...example.metadata, dataset_split: [example.split] },
    });
  }

  async updateExample(update: {
    id: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    metadata: Record<string, unknown>;
    split: string;
  }) {
    if (this.failUpdate) throw new Error('injected update failure');
    this.updateCalls.push(update.id);
    const index = this.examples.findIndex(({ id }) => id === update.id);
    if (index < 0) throw new Error(`unknown example ${update.id}`);
    this.examples[index] = {
      id: update.id,
      inputs: structuredClone(update.inputs),
      outputs: structuredClone(update.outputs),
      metadata: { ...update.metadata, dataset_split: [update.split] },
    };
    return update;
  }

  async deleteExample(exampleId: string) {
    this.deleteCalls.push(exampleId);
    this.examples = this.examples.filter(({ id }) => id !== exampleId);
  }
}

function datasetCases(): LiveQualityDatasetCase[] {
  return buildLiveQualityDatasetCases({
    inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
    scenarioCases: liveScenarioCases,
  });
}

const activeTurnCount = liveScenarioCases.reduce(
  (total, scenario) => total + scenario.turnExpectations.length,
  0,
);
const activeCaseCount = activeTurnCount * 2;

function syncCases(client: Client, cases: readonly unknown[]) {
  return syncLiveQualityDataset(client, cases, liveScenarioCases);
}

function refreshFingerprint(
  testCase: LiveQualityDatasetCase,
): LiveQualityDatasetCase {
  const refreshed = structuredClone(testCase);
  refreshed.metadata.fingerprint = liveQualityCaseFingerprint({
    inputs: refreshed.inputs,
    outputs: refreshed.outputs,
    metadata: {
      caseId: refreshed.metadata.caseId,
      schemaVersion: refreshed.metadata.schemaVersion,
      inventoryVersion: refreshed.metadata.inventoryVersion,
      sourcePath: refreshed.metadata.sourcePath,
      datasetName: refreshed.metadata.datasetName,
      managedBy: refreshed.metadata.managedBy,
    },
    split: refreshed.split,
  });
  return refreshed;
}

function ownedExample(
  testCase: LiveQualityDatasetCase,
  id: string,
): FakeExample {
  return {
    id,
    inputs: { ...structuredClone(testCase.inputs) },
    outputs: { ...structuredClone(testCase.outputs) },
    metadata: {
      ...structuredClone(testCase.metadata),
      dataset_split: [testCase.split],
    },
  };
}

function findExample(client: FakeLangSmithClient, caseId: string): FakeExample {
  const example = client.examples.find(
    ({ metadata }) => metadata.caseId === caseId,
  );
  if (!example) throw new Error(`missing fake example ${caseId}`);
  return example;
}

function passingExperimentOutput(): LiveQualityExperimentOutput {
  return {
    responseText:
      'Mình xin lỗi về trải nghiệm này. Bạn cho mình biết thêm chi tiết nhé.',
    executedTools: [],
    observations: [],
    stateBefore: {},
    stateAfter: {},
    durationMs: 100,
    persistence: {
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: 1,
      eventIdsBefore: [],
      eventIds: ['event-1'],
      eventIdsAfter: ['event-1'],
      checkpointId: 'checkpoint-1',
      checkpointNamespace: 'run:test',
      checkpointThreadId: 'thread-test',
      checkpointVerified: true,
    },
  };
}

describe('live quality LangSmith dataset', () => {
  it('strictly validates advisory scenario metadata and criterion uniqueness', () => {
    const advisoryScenario = liveScenarioCases.find(
      ({ advisory }) => advisory,
    )!;
    expect(() => liveScenarioCaseSchema.parse(advisoryScenario)).not.toThrow();

    const duplicateCriteria = structuredClone(advisoryScenario);
    duplicateCriteria.advisory!.criteria.push(
      structuredClone(duplicateCriteria.advisory!.criteria[0]!),
    );
    expect(() => liveScenarioCaseSchema.parse(duplicateCriteria)).toThrow(
      /criterion IDs must be unique/i,
    );

    const invalidPhase = structuredClone(advisoryScenario);
    invalidPhase.advisory!.phaseEndTurnIndex = 999;
    expect(() => liveScenarioCaseSchema.parse(invalidPhase)).toThrow(
      /phase end must reference a scenario turn/i,
    );

    const unknownField = {
      ...structuredClone(advisoryScenario),
      advisory: {
        ...structuredClone(advisoryScenario.advisory),
        unexpected: true,
      },
    };
    expect(() => liveScenarioCaseSchema.parse(unknownField)).toThrow();
  });

  it('derives both modes and stable fingerprints from the repository ledger', () => {
    const first = datasetCases();
    const second = datasetCases();

    expect(first).toHaveLength(activeCaseCount);
    expect(new Set(first.map(({ inputs }) => inputs.caseId)).size).toBe(
      activeCaseCount,
    );
    expect(liveQualityInventoryDigest(first)).toBe(
      liveQualityInventoryDigest(second),
    );
    expect(first.map(({ inputs }) => inputs.mode)).toEqual(
      expect.arrayContaining(['genui', 'text']),
    );
    expect(first.map(({ metadata }) => metadata.fingerprint)).toEqual(
      second.map(({ metadata }) => metadata.fingerprint),
    );
    const changedInventory = structuredClone(liveScenarioCases);
    changedInventory[0]!.turnExpectations[0]!.latency.maxTurnMs += 1;
    const changedFingerprint = buildLiveQualityDatasetCases({
      inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
      scenarioCases: changedInventory,
    })[0]!.metadata.fingerprint;
    expect(changedFingerprint).not.toBe(first[0]!.metadata.fingerprint);
    const textCase = first.find(
      ({ inputs }) =>
        inputs.caseId === '03-ton-kho-dia-chi-va-cua-hang.json#1:text',
    );
    const genUiCase = first.find(
      ({ inputs }) =>
        inputs.caseId === '03-ton-kho-dia-chi-va-cua-hang.json#1:genui',
    );
    expect(genUiCase?.outputs.expectation.genUi.required).toBe(true);
    expect(textCase?.outputs.expectation.genUi).toMatchObject({
      required: false,
    });
    expect(textCase?.outputs.expectation.genUi.requiredDataPaths).toEqual(
      genUiCase?.outputs.expectation.genUi.requiredDataPaths,
    );
    for (const scenarioCase of liveScenarioCases) {
      for (const originalExpectation of scenarioCase.turnExpectations) {
        for (const mode of ['genui', 'text'] as const) {
          const built = first.find(
            ({ inputs }) =>
              inputs.caseId === `${originalExpectation.id}:${mode}`,
          );
          expect(built?.outputs.expectation).toEqual(
            expectationForLiveQualityMode(originalExpectation, mode),
          );
        }
      }
    }
  });

  it('accepts a structurally complete inventory without a pinned digest', async () => {
    const changedInventory = structuredClone(liveScenarioCases);
    changedInventory[0]!.turnExpectations[0]!.latency.maxTurnMs += 1;
    const cases = buildLiveQualityDatasetCases({
      inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
      scenarioCases: changedInventory,
    });
    const client = new FakeLangSmithClient();

    const result = await syncCases(client as unknown as Client, cases);

    expect(result.created).toHaveLength(cases.length);
    expect(result.inventoryDigest).toBe(liveQualityInventoryDigest(cases));
  });

  it('creates, updates, skips, and removes only repository-owned examples', async () => {
    const client = new FakeLangSmithClient();
    const cases = datasetCases();
    const testCase = cases[0]!;
    const first = await syncCases(client as unknown as Client, cases);

    expect(first.created).toHaveLength(activeCaseCount);
    expect(first.created).toContain(testCase.inputs.caseId);
    expect(client.readDatasetCalls).toBe(1);
    expect(client.readDatasetRequests[0]).toEqual({
      datasetId: 'dataset-live-quality',
    });
    expect(client.examples).toHaveLength(activeCaseCount);
    const second = await syncCases(client as unknown as Client, cases);
    expect(second.unchanged).toHaveLength(activeCaseCount);
    expect(second.unchanged).toContain(testCase.inputs.caseId);

    findExample(client, testCase.inputs.caseId).inputs.customerMessage =
      'tampered remote input';
    const repaired = await syncCases(client as unknown as Client, cases);
    expect(repaired.updated).toEqual([testCase.inputs.caseId]);

    client.examples.push({
      id: 'stale-owned',
      inputs: {},
      outputs: {},
      metadata: {
        caseId: 'stale-case',
        datasetName: LIVE_QUALITY_DATASET_NAME,
        managedBy: LIVE_QUALITY_SYNC_OWNER,
        sourcePath: LIVE_QUALITY_SOURCE_PATH,
        schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
        fingerprint: 'stale',
      },
    });
    client.examples.push({
      id: 'unowned',
      inputs: {},
      outputs: {},
      metadata: { caseId: 'manual-case', sourcePath: LIVE_QUALITY_SOURCE_PATH },
    });

    const third = await syncCases(client as unknown as Client, cases);
    expect(third.updated).toEqual([]);
    expect(third.deleted).toEqual(['stale-case']);
    expect(client.examples.some(({ id }) => id === 'unowned')).toBe(true);
  });

  it('rejects an unowned same-name dataset before listing or mutating examples', async () => {
    const mutations: Array<(client: FakeLangSmithClient) => void> = [
      (client) => {
        client.dataset.name = 'manual-dataset';
      },
      (client) => {
        client.dataset.data_type = 'chat';
      },
      (client) => {
        client.dataset.metadata.managedBy = 'manual-dataset';
      },
      (client) => {
        client.dataset.metadata.schemaVersion = 'manual-schema';
      },
    ];
    for (const mutate of mutations) {
      const client = new FakeLangSmithClient();
      client.datasetExists = true;
      mutate(client);
      client.examples.push(ownedExample(datasetCases()[0]!, 'preserved'));

      await expect(
        syncCases(client as unknown as Client, datasetCases()),
      ).rejects.toThrow('Refusing to synchronize unowned LangSmith dataset');
      expect(client.listExamplesCalls).toBe(0);
      expect(client.examples.map(({ id }) => id)).toEqual(['preserved']);
      expect(client.deleteCalls).toEqual([]);
    }
  });

  it('preserves examples when the newly created dataset cannot be read back', async () => {
    const client = new FakeLangSmithClient();
    client.readError = new Error('injected read failure');
    client.examples.push(ownedExample(datasetCases()[0]!, 'preserved'));

    await expect(
      syncCases(client as unknown as Client, datasetCases()),
    ).rejects.toThrow('injected read failure');
    expect(client.listExamplesCalls).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.updateCalls).toEqual([]);
    expect(client.deleteCalls).toEqual([]);
    expect(client.examples.map(({ id }) => id)).toEqual(['preserved']);
  });

  it('preserves examples when the newly created dataset persists mismatched ownership', async () => {
    const client = new FakeLangSmithClient();
    client.persistedDataset = {
      ...structuredClone(client.dataset),
      metadata: {
        ...structuredClone(client.dataset.metadata),
        managedBy: 'manual-dataset',
      },
    };
    client.examples.push(ownedExample(datasetCases()[0]!, 'preserved'));

    await expect(
      syncCases(client as unknown as Client, datasetCases()),
    ).rejects.toThrow('Refusing to synchronize unowned LangSmith dataset');
    expect(client.listExamplesCalls).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.updateCalls).toEqual([]);
    expect(client.deleteCalls).toEqual([]);
    expect(client.examples.map(({ id }) => id)).toEqual(['preserved']);
  });

  it('preserves examples when created and persisted dataset IDs differ', async () => {
    const client = new FakeLangSmithClient();
    client.createResponseDatasetId = 'dataset-create-response';
    client.examples.push(ownedExample(datasetCases()[0]!, 'preserved'));

    await expect(
      syncCases(client as unknown as Client, datasetCases()),
    ).rejects.toThrow('Refusing LangSmith dataset ID mismatch');
    expect(client.readDatasetRequests[0]).toEqual({
      datasetId: 'dataset-create-response',
    });
    expect(client.listExamplesCalls).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.updateCalls).toEqual([]);
    expect(client.deleteCalls).toEqual([]);
    expect(client.examples.map(({ id }) => id)).toEqual(['preserved']);
  });

  it('rejects empty, duplicate, or forged desired inventories before remote access', async () => {
    const canonical = datasetCases();
    const testCase = canonical[0]!;
    const forgedFingerprint = structuredClone(canonical);
    forgedFingerprint[0]!.metadata.fingerprint = 'forged';
    const invalidMessage = structuredClone(canonical);
    invalidMessage[0]!.inputs.customerMessage =
      'rehashed but not bound to the expectation';
    invalidMessage[0] = refreshFingerprint(invalidMessage[0]!);
    const invalidScenario = structuredClone(canonical);
    invalidScenario[0]!.inputs.scenarioFile = '99-foreign-scenario.json';
    invalidScenario[0] = refreshFingerprint(invalidScenario[0]!);
    const invalidInventoryVersion = structuredClone(canonical);
    (
      invalidInventoryVersion[0]!.metadata as { inventoryVersion: string }
    ).inventoryVersion = '2099-01-01.1';
    invalidInventoryVersion[0] = refreshFingerprint(
      invalidInventoryVersion[0]!,
    );
    const divergentModes = structuredClone(canonical);
    const textIndex = divergentModes.findIndex(
      ({ inputs }) =>
        inputs.caseId === `${testCase.outputs.expectation.id}:text`,
    );
    divergentModes[textIndex]!.outputs.expectation.latency.maxTurnMs += 1;
    divergentModes[textIndex] = refreshFingerprint(divergentModes[textIndex]!);
    const forgedPair = structuredClone(canonical);
    for (const [index, candidate] of forgedPair.entries()) {
      if (candidate.outputs.expectation.id !== testCase.outputs.expectation.id)
        continue;
      const forgedTurnId = '99-forged-scenario.json#1';
      candidate.inputs.scenarioFile = '99-forged-scenario.json';
      candidate.inputs.turnIndex = 1;
      candidate.inputs.customerMessage = 'Coherent forged replacement';
      candidate.inputs.caseId = `${forgedTurnId}:${candidate.inputs.mode}`;
      candidate.outputs.expectation.id = forgedTurnId;
      candidate.outputs.expectation.turnIndex = 1;
      candidate.outputs.expectation.input = candidate.inputs.customerMessage;
      candidate.metadata.caseId = candidate.inputs.caseId;
      forgedPair[index] = refreshFingerprint(candidate);
    }
    const invalidMode = structuredClone(canonical) as unknown[];
    const invalidModeCase = invalidMode[0] as LiveQualityDatasetCase;
    (invalidModeCase.inputs as { mode: string }).mode = 'voice';
    invalidModeCase.metadata.fingerprint = liveQualityCaseFingerprint({
      inputs: invalidModeCase.inputs,
      outputs: invalidModeCase.outputs,
      metadata: {
        caseId: invalidModeCase.metadata.caseId,
        schemaVersion: invalidModeCase.metadata.schemaVersion,
        inventoryVersion: invalidModeCase.metadata.inventoryVersion,
        sourcePath: invalidModeCase.metadata.sourcePath,
        datasetName: invalidModeCase.metadata.datasetName,
        managedBy: invalidModeCase.metadata.managedBy,
      },
      split: invalidModeCase.split,
    });
    const missingClaimsForbidden = structuredClone(canonical) as unknown[];
    delete (
      (missingClaimsForbidden[0] as LiveQualityDatasetCase).outputs.expectation
        .claims as { forbidden?: string[] }
    ).forbidden;
    const missingMessengerForbiddenText = structuredClone(
      canonical,
    ) as unknown[];
    delete (
      (missingMessengerForbiddenText[0] as LiveQualityDatasetCase).outputs
        .expectation.messenger as { forbiddenText?: string[] }
    ).forbiddenText;
    const attempts: Array<{ cases: unknown[]; expectedError?: string }> = [
      {
        cases: [],
        expectedError: 'structurally incomplete live quality inventory',
      },
      {
        cases: canonical.slice(0, 1),
        expectedError: 'structurally incomplete live quality inventory',
      },
      {
        cases: [...canonical, structuredClone(testCase)],
        expectedError: 'Duplicate live quality case',
      },
      { cases: forgedFingerprint },
      { cases: invalidMessage },
      { cases: invalidScenario },
      { cases: invalidInventoryVersion },
      { cases: divergentModes },
      {
        cases: forgedPair,
        expectedError: 'structurally incomplete live quality inventory',
      },
      { cases: invalidMode, expectedError: 'inputs.mode' },
      {
        cases: missingClaimsForbidden,
        expectedError: 'outputs.expectation.claims.forbidden',
      },
      {
        cases: missingMessengerForbiddenText,
        expectedError: 'outputs.expectation.messenger.forbiddenText',
      },
    ];

    for (const { cases, expectedError } of attempts) {
      const client = new FakeLangSmithClient();
      client.datasetExists = true;
      client.examples.push(ownedExample(testCase, 'preserved'));
      await expect(
        syncCases(client as unknown as Client, cases),
      ).rejects.toThrow(expectedError);
      expect(client.hasDatasetCalls).toBe(0);
      expect(client.listExamplesCalls).toBe(0);
      expect(client.examples.map(({ id }) => id)).toEqual(['preserved']);
    }
  });

  it('never adopts a marker-free legacy or manual row, even when its content and fingerprint match', async () => {
    const client = new FakeLangSmithClient();
    client.datasetExists = true;
    const cases = datasetCases();
    const testCase = cases[0]!;
    client.examples.push({
      id: 'manual-same-case',
      inputs: structuredClone(testCase.inputs) as unknown as Record<
        string,
        unknown
      >,
      outputs: structuredClone(testCase.outputs) as unknown as Record<
        string,
        unknown
      >,
      metadata: {
        caseId: testCase.inputs.caseId,
        schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
        sourcePath: LIVE_QUALITY_SOURCE_PATH,
        fingerprint: testCase.metadata.fingerprint,
      },
    });
    client.examples.push({
      ...ownedExample(testCase, 'foreign-schema'),
      metadata: {
        ...ownedExample(testCase, 'foreign-schema').metadata,
        schemaVersion: 'foreign-schema',
      },
    });

    const result = await syncCases(client as unknown as Client, cases);

    expect(result.created).toHaveLength(activeCaseCount);
    expect(result.created).toContain(testCase.inputs.caseId);
    expect(result.deleted).toEqual([]);
    expect(client.examples.map(({ id }) => id)).toContain('manual-same-case');
    expect(client.examples.map(({ id }) => id)).toContain('foreign-schema');
    expect(client.examples).toHaveLength(activeCaseCount + 2);
  });

  it('repairs inventory metadata, split metadata, and stale-fingerprint content drift', async () => {
    const client = new FakeLangSmithClient();
    const cases = datasetCases();
    const original = cases[0]!;
    await syncCases(client as unknown as Client, cases);

    findExample(client, original.inputs.caseId).metadata.inventoryVersion =
      'tampered-inventory';
    expect(
      (await syncCases(client as unknown as Client, cases)).updated,
    ).toEqual([original.inputs.caseId]);

    findExample(client, original.inputs.caseId).metadata.dataset_split = [
      'manual',
    ];
    expect(
      (await syncCases(client as unknown as Client, cases)).updated,
    ).toEqual([original.inputs.caseId]);

    const drifted = findExample(client, original.inputs.caseId);
    (
      drifted.outputs as unknown as LiveQualityDatasetCase['outputs']
    ).expectation.latency.maxTurnMs += 1;
    expect(drifted.metadata.fingerprint).toBe(original.metadata.fingerprint);
    expect(
      (await syncCases(client as unknown as Client, cases)).updated,
    ).toEqual([original.inputs.caseId]);
  });

  it('selects an exact canonical row independent of enumeration order', async () => {
    const client = new FakeLangSmithClient();
    client.datasetExists = true;
    const cases = datasetCases();
    const testCase = cases[0]!;
    const stale = ownedExample(testCase, 'a-stale');
    stale.inputs.customerMessage = 'stale';
    client.examples.push(stale, ownedExample(testCase, 'z-exact'));

    const result = await syncCases(client as unknown as Client, cases);

    expect(result.unchanged).toEqual([testCase.inputs.caseId]);
    expect(result.created).toHaveLength(activeCaseCount - 1);
    expect(result.updated).toEqual([]);
    expect(client.updateCalls).toEqual([]);
    expect(client.deleteCalls).toEqual(['a-stale']);
    expect(client.examples).toHaveLength(activeCaseCount);
    expect(client.examples.some(({ id }) => id === 'z-exact')).toBe(true);
    expect(client.examples.some(({ id }) => id === 'a-stale')).toBe(false);
  });

  it('defers duplicate and stale deletion until every canonical write succeeds', async () => {
    const cases = datasetCases();
    const testCase = cases[0]!;
    const updateClient = new FakeLangSmithClient();
    updateClient.datasetExists = true;
    const firstStale = ownedExample(testCase, 'a-stale');
    firstStale.inputs.customerMessage = 'stale-a';
    const secondStale = ownedExample(testCase, 'b-stale');
    secondStale.inputs.customerMessage = 'stale-b';
    updateClient.examples.push(firstStale, secondStale);
    updateClient.failUpdate = true;

    await expect(
      syncCases(updateClient as unknown as Client, cases),
    ).rejects.toThrow('injected update failure');
    expect(updateClient.deleteCalls).toEqual([]);
    expect(updateClient.examples.map(({ id }) => id)).toEqual([
      'a-stale',
      'b-stale',
    ]);

    const createClient = new FakeLangSmithClient();
    createClient.datasetExists = true;
    const staleCase = ownedExample(testCase, 'stale-other-case');
    staleCase.metadata.caseId = 'stale-other-case';
    createClient.examples.push(staleCase);
    createClient.failCreate = true;

    await expect(
      syncCases(createClient as unknown as Client, cases),
    ).rejects.toThrow('injected create failure');
    expect(createClient.deleteCalls).toEqual([]);
    expect(createClient.examples.map(({ id }) => id)).toEqual([
      'stale-other-case',
    ]);
  });

  it('reuses the local deterministic oracle as LangSmith experiment scores', async () => {
    const cases = datasetCases();
    const testCases = (['text', 'genui'] as const).map((mode) =>
      cases.find(
        ({ inputs }) =>
          inputs.caseId === `05-khieu-nai-va-human-handoff.json#1:${mode}`,
      )!,
    );
    const output = passingExperimentOutput();
    for (const testCase of testCases) {
      await expect(
        createLiveQualityExperimentEvaluator(cases)({
          inputs: { caseId: testCase.inputs.caseId },
          outputs: output as unknown as Record<string, unknown>,
        }),
      ).rejects.toThrow(
        'A semantic response judge is required for this live quality case',
      );
    }
    const passingSemanticJudge: SemanticResponseJudge = {
      async judge({ expectation }) {
        return {
          passed: true,
          requirements: expectation.claims.required.map(
            ({ requirementId }) => ({
              requirementId,
              passed: true,
              reason: 'satisfied' as const,
            }),
          ),
        };
      },
    };
    const passingEvaluator = createLiveQualityExperimentEvaluator(cases, {
      semanticJudge: passingSemanticJudge,
    });
    const rejectingSemanticJudge: SemanticResponseJudge = {
      async judge({ expectation }) {
        return {
          passed: false,
          requirements: expectation.claims.required.map(
            ({ requirementId }) => ({
              requirementId,
              passed: false,
              reason: 'contradicted' as const,
            }),
          ),
        };
      },
    };
    const rejectingEvaluator = createLiveQualityExperimentEvaluator(cases, {
      semanticJudge: rejectingSemanticJudge,
    });
    for (const testCase of testCases) {
      const passingScores = await passingEvaluator({
        inputs: { caseId: testCase.inputs.caseId },
        outputs: output as unknown as Record<string, unknown>,
      });
      expect(
        passingScores.find(({ key }) => key === 'semantic_response'),
      ).toMatchObject({ score: 1, value: true });
      expect(
        passingScores.find(({ key }) => key === 'acceptance'),
      ).toMatchObject({ score: 1, value: true });

      const rejectedScores = await rejectingEvaluator({
        inputs: { caseId: testCase.inputs.caseId },
        outputs: output as unknown as Record<string, unknown>,
      });
      expect(
        rejectedScores.find(({ key }) => key === 'semantic_response'),
      ).toMatchObject({ score: 0, value: false });
      expect(
        rejectedScores.find(({ key }) => key === 'acceptance'),
      ).toMatchObject({ score: 0, value: false });
    }
    const requirementId =
      testCases[0].outputs.expectation.claims.required[0]!.requirementId;
    const malformedCoverage = [
      [],
      [
        { requirementId, passed: true, reason: 'satisfied' as const },
        { requirementId, passed: true, reason: 'satisfied' as const },
      ],
      [
        { requirementId, passed: true, reason: 'satisfied' as const },
        {
          requirementId: 'unexpected-requirement',
          passed: true,
          reason: 'satisfied' as const,
        },
      ],
    ];
    for (const requirements of malformedCoverage) {
      const malformedJudge: SemanticResponseJudge = {
        async judge() {
          return { passed: true, requirements };
        },
      };
      await expect(
        createLiveQualityExperimentEvaluator(cases, {
          semanticJudge: malformedJudge,
        })({
          inputs: { caseId: testCases[0].inputs.caseId },
          outputs: output as unknown as Record<string, unknown>,
        }),
      ).rejects.toThrow(
        'Semantic response judgment must cover every expected requirement exactly once',
      );
    }
    const inconsistentAggregateJudge: SemanticResponseJudge = {
      async judge() {
        return {
          passed: false,
          requirements: [
            {
              requirementId,
              passed: true,
              reason: 'satisfied',
            },
          ],
        };
      },
    };
    await expect(
      createLiveQualityExperimentEvaluator(cases, {
        semanticJudge: inconsistentAggregateJudge,
      })({
        inputs: { caseId: testCases[0].inputs.caseId },
        outputs: output as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(
      'Semantic response judgment passed value must equal all requirement results',
    );
    await expect(
      passingEvaluator({
        inputs: { caseId: 'dataset-only-case' },
        outputs: {},
      }),
    ).rejects.toThrow('Unknown live quality evaluation case');
  });

  it('keeps every acceptance score identical through the local and LangSmith adapters', async () => {
    const sourceCase = datasetCases().find(
      ({ inputs }) =>
        inputs.caseId === '05-khieu-nai-va-human-handoff.json#1:text',
    )!;
    const toolTrace = {
      toolName: 'handoff' as const,
      arguments: { reason: 'customer_requested' },
      ok: true,
      resultSummary: 'handoff created',
      provenance: [{ fixtureMode: 'test_only' as const, sourceFile: 'test' }],
    };
    const semanticJudge: SemanticResponseJudge = {
      async judge({ expectation }) {
        return {
          passed: true,
          requirements: expectation.claims.required.map(
            ({ requirementId }) => ({
              requirementId,
              passed: true,
              reason: 'satisfied' as const,
            }),
          ),
        };
      },
    };
    const parity = async (
      testCase: LiveQualityDatasetCase,
      output: LiveQualityExperimentOutput,
    ) => {
      expect(() => liveQualityDatasetCaseSchema.parse(testCase)).not.toThrow();
      expect(requiresSemanticResponseJudge(testCase.outputs.expectation)).toBe(
        true,
      );
      const direct = evaluateLiveQualityOutput(
        testCase.outputs.expectation,
        output,
        testCase.inputs.mode,
      );
      const adapted = await createLiveQualityExperimentEvaluator([testCase], {
        semanticJudge,
      })({
        inputs: { caseId: testCase.inputs.caseId },
        outputs: output as unknown as Record<string, unknown>,
      });
      expect(
        adapted.find(({ key }) => key === 'semantic_response'),
      ).toMatchObject({ score: 1, value: true });
      expect(
        adapted
          .filter(({ key }) => key !== 'semantic_response')
          .map(({ key, value, comment }) => ({
            key,
            score: value,
            ...(comment ? { comment } : {}),
          })),
      ).toEqual(direct);
      return direct;
    };
    const caseWith = (
      label: string,
      mode: LiveQualityDatasetCase['inputs']['mode'],
      expectation: LiveQualityDatasetCase['outputs']['expectation'],
    ): LiveQualityDatasetCase => {
      const boundExpectation = {
        ...structuredClone(expectation),
        id: label,
      };
      return refreshFingerprint({
        ...structuredClone(sourceCase),
        inputs: {
          ...structuredClone(sourceCase.inputs),
          caseId: `${label}:${mode}`,
          mode,
        },
        outputs: { expectation: boundExpectation },
        metadata: {
          ...structuredClone(sourceCase.metadata),
          caseId: `${label}:${mode}`,
        },
      });
    };

    const countExpectation: TurnExpectation = {
      ...structuredClone(sourceCase.outputs.expectation),
      allowedTools: ['handoff'],
      requiredGroups: [],
      forbiddenTools: [],
      toolCounts: [{ toolName: 'handoff' as const, min: 0, max: 1 }],
      toolOrder: [],
      toolOrderGroups: [],
      argumentConstraints: [],
      claims: {
        required: [
          {
            kind: 'semantic_response',
            requirementId: 'synthetic-response',
            act: 'acknowledge_complaint_without_invented_resolution',
            description:
              'Return a natural customer-facing response without inventing an outcome.',
          },
        ],
        forbidden: [],
      },
      providerEvidence: {
        requireToolProvenance: false,
        requireRevisionOrSource: false,
        providerTools: [],
        acceptedFailedTools: [],
      },
    };
    const countOutput = passingExperimentOutput();
    countOutput.executedTools = [toolTrace, toolTrace];
    const countScores = await parity(
      caseWith('count', 'text', countExpectation),
      countOutput,
    );
    expect(
      countScores.find(({ key }) => key === 'tool_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('observed 2, maximum 1'),
    });
    expect(countScores.find(({ key }) => key === 'acceptance')?.score).toBe(
      false,
    );

    const groundingExpectation: TurnExpectation = {
      ...structuredClone(countExpectation),
      toolCounts: [{ toolName: 'handoff', min: 1, max: 1 }],
      claims: {
        required: [
          {
            kind: 'grounded_tool_outcome',
            requirementId: 'handoff-outcome',
            anyOf: ['handoff'],
            expectedOk: true,
            resultSummaryOneOf: ['handoff created'],
            statePaths: ['handoff'],
            genUiPaths: [],
            textAnyOf: [],
          },
        ],
        forbidden: [],
      },
    };
    const wrongOutcomeOutput = passingExperimentOutput();
    wrongOutcomeOutput.executedTools = [
      {
        ...toolTrace,
        ok: false,
        resultSummary: 'provider_timeout',
      },
    ];
    const wrongOutcomeScores = await parity(
      caseWith('wrong-outcome-grounding', 'text', groundingExpectation),
      wrongOutcomeOutput,
    );
    expect(
      wrongOutcomeScores.find(({ key }) => key === 'grounded_response'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('wrong handoff outcome'),
    });
    const missingStateEvidenceOutput = passingExperimentOutput();
    missingStateEvidenceOutput.executedTools = [toolTrace];
    const missingStateEvidenceScores = await parity(
      caseWith('missing-state-evidence', 'text', groundingExpectation),
      missingStateEvidenceOutput,
    );
    expect(
      missingStateEvidenceScores.find(({ key }) => key === 'grounded_response'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('no verified state evidence'),
    });
    const verifiedOutcomeOutput = {
      ...passingExperimentOutput(),
      executedTools: [toolTrace],
      stateAfter: { handoff: { id: 'REF-HANDOFF-1' } },
    };
    const verifiedOutcomeScores = await parity(
      caseWith('verified-outcome-grounding', 'text', groundingExpectation),
      verifiedOutcomeOutput,
    );
    expect(
      verifiedOutcomeScores.find(({ key }) => key === 'grounded_response'),
    ).toMatchObject({ score: true });
    const groundingClaim = groundingExpectation.claims.required[0];
    if (groundingClaim?.kind !== 'grounded_tool_outcome') {
      throw new Error('grounding fixture must use a grounded tool outcome');
    }
    const genUiGroundingExpectation: TurnExpectation = {
      ...structuredClone(groundingExpectation),
      claims: {
        required: [
          {
            ...structuredClone(groundingClaim),
            genUiPaths: ['data.handoff'],
          },
        ],
        forbidden: [],
      },
    };
    const missingGenUiEvidenceOutput = {
      ...verifiedOutcomeOutput,
      genUi: {
        id: 'handoff-1',
        lifecycleStage: 'active',
        widgetKind: 'supportHandoff',
        status: 'active',
        data: {},
        actions: [],
      },
    };
    const missingGenUiEvidenceScores = await parity(
      caseWith('missing-genui-evidence', 'genui', genUiGroundingExpectation),
      missingGenUiEvidenceOutput,
    );
    expect(
      missingGenUiEvidenceScores.find(({ key }) => key === 'grounded_response'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('no GenUI evidence'),
    });

    const orderExpectation: TurnExpectation = {
      ...structuredClone(countExpectation),
      allowedTools: ['handoff', 'previewCart'],
      toolCounts: [
        { toolName: 'handoff', min: 1, max: 1 },
        { toolName: 'previewCart', min: 1, max: 1 },
      ],
      toolOrder: ['handoff', 'previewCart'],
      toolOrderGroups: [['handoff'], ['previewCart']],
    };
    const orderOutput = passingExperimentOutput();
    orderOutput.executedTools = [
      {
        toolName: 'previewCart',
        arguments: {},
        ok: true,
        resultSummary: 'cart previewed',
        provenance: [{ fixtureMode: 'test_only', sourceFile: 'test' }],
      },
      toolTrace,
    ];
    const orderScores = await parity(
      caseWith('outcome-over-tool-order', 'text', orderExpectation),
      orderOutput,
    );
    expect(
      orderScores.find(({ key }) => key === 'tool_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('missing ordered tool'),
    });
    orderOutput.executedTools.reverse();
    const orderedScores = await parity(
      caseWith('required-tool-order', 'text', orderExpectation),
      orderOutput,
    );
    expect(
      orderedScores.find(({ key }) => key === 'tool_contract'),
    ).toMatchObject({ score: true });

    const genUiExpectation: TurnExpectation = {
      ...structuredClone(countExpectation),
      genUi: {
        required: true,
        requireCompleteMenuCollection: false,
        allowedWidgetKinds: ['supportHandoff'],
        requiredDataPaths: [
          'id',
          'lifecycleStage',
          'widgetKind',
          'status',
          'data',
          'actions',
        ],
        requiredActions: [],
        forbiddenActions: ['contact_staff'],
      },
    };
    const genUiOutput = passingExperimentOutput();
    genUiOutput.genUi = {
      id: 'handoff-1',
      lifecycleStage: 'active',
      widgetKind: 'supportHandoff',
      status: 'active',
      data: {},
      actions: [{ id: 'contact_staff' }],
    };
    const forbiddenActionScores = await parity(
      caseWith('forbidden-action', 'genui', genUiExpectation),
      genUiOutput,
    );
    expect(
      forbiddenActionScores.find(({ key }) => key === 'presentation_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('forbidden GenUI action'),
    });

    const textGenUiScores = await parity(
      caseWith(
        'text-genui',
        'text',
        expectationForLiveQualityMode(genUiExpectation, 'text'),
      ),
      genUiOutput,
    );
    expect(
      textGenUiScores.find(({ key }) => key === 'presentation_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('text mode forbids GenUI'),
    });
    const nullGenUiOutput = passingExperimentOutput();
    nullGenUiOutput.genUi = null;
    const nullGenUiScores = await parity(
      caseWith(
        'text-null-genui',
        'text',
        expectationForLiveQualityMode(genUiExpectation, 'text'),
      ),
      nullGenUiOutput,
    );
    expect(
      nullGenUiScores.find(({ key }) => key === 'presentation_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('text mode forbids GenUI'),
    });

    const persistenceOutput = passingExperimentOutput();
    persistenceOutput.persistence = {
      ...persistenceOutput.persistence,
      transcriptRevisionAfter: 1,
      eventRevisionAfter: 2,
      eventIds: ['event-1'],
      eventIdsAfter: ['event-2'],
      checkpointId: undefined,
      checkpointNamespace: undefined,
    };
    const persistenceScores = await parity(
      caseWith('persistence', 'text', countExpectation),
      persistenceOutput,
    );
    expect(
      persistenceScores.find(({ key }) => key === 'persistence')?.score,
    ).toBe(false);

    const checkpointRequiredOutput = passingExperimentOutput();
    checkpointRequiredOutput.persistence.checkpointId = undefined;
    checkpointRequiredOutput.persistence.checkpointNamespace = undefined;
    checkpointRequiredOutput.persistence.checkpointThreadId = undefined;
    checkpointRequiredOutput.persistence.checkpointVerified = false;
    const checkpointRequiredScores = await parity(
      caseWith('live-checkpoint-required', 'text', countExpectation),
      checkpointRequiredOutput,
    );
    expect(
      checkpointRequiredScores.find(({ key }) => key === 'persistence')?.score,
    ).toBe(false);

    const structuralExpectation: TurnExpectation = {
      ...structuredClone(countExpectation),
      stateTransition: {
        mayChange: [],
        mustChange: [],
        mustNotChange: ['cart'],
        pathConstraints: [],
      },
    };
    const structuralOutput = passingExperimentOutput();
    structuralOutput.stateBefore = { cart: { id: 'cart-1', quantity: 1 } };
    structuralOutput.stateAfter = { cart: { quantity: 1, id: 'cart-1' } };
    const structuralScores = await parity(
      caseWith('structural-state', 'text', structuralExpectation),
      structuralOutput,
    );
    expect(
      structuralScores.find(({ key }) => key === 'state_transition')?.score,
    ).toBe(true);

    const provenanceExpectation: TurnExpectation = {
      ...countExpectation,
      toolCounts: [{ toolName: 'handoff' as const, min: 1, max: 1 }],
      providerEvidence: {
        requireToolProvenance: true,
        requireRevisionOrSource: true,
        providerTools: ['handoff'],
        acceptedFailedTools: [],
      },
    };
    const provenanceOutput = passingExperimentOutput();
    provenanceOutput.executedTools = [{ ...toolTrace, provenance: [] }];
    const provenanceScores = await parity(
      caseWith('provenance', 'text', provenanceExpectation),
      provenanceOutput,
    );
    expect(
      provenanceScores.find(({ key }) => key === 'provider_evidence'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('without provenance'),
    });

    const latencyOutput = passingExperimentOutput();
    latencyOutput.durationMs = countExpectation.latency.maxTurnMs + 1;
    const latencyScores = await parity(
      caseWith('latency', 'text', countExpectation),
      latencyOutput,
    );
    expect(latencyScores.find(({ key }) => key === 'latency')?.score).toBe(
      false,
    );
    expect(latencyScores.find(({ key }) => key === 'acceptance')?.score).toBe(
      false,
    );
  });

  it('uses the requested versioned dataset name', () => {
    expect(LIVE_QUALITY_DATASET_NAME).toBe('kfc-live-quality-v2');
  });
});
