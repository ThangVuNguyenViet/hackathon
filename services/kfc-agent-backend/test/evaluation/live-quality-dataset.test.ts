import type { Client } from 'langsmith';
import { describe, expect, it } from 'vitest';
import {
  buildLiveQualityDatasetCases,
  expectationForLiveQualityMode,
  liveQualityCaseFingerprint,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
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
} from '../../src/evaluation/liveQualityEvaluators.js';
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

function refreshFingerprint(testCase: LiveQualityDatasetCase): LiveQualityDatasetCase {
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

function ownedExample(testCase: LiveQualityDatasetCase, id: string): FakeExample {
  return {
    id,
    inputs: structuredClone(testCase.inputs) as unknown as Record<string, unknown>,
    outputs: structuredClone(testCase.outputs) as unknown as Record<string, unknown>,
    metadata: {
      ...structuredClone(testCase.metadata),
      dataset_split: [testCase.split],
    },
  };
}

function findExample(client: FakeLangSmithClient, caseId: string): FakeExample {
  const example = client.examples.find(({ metadata }) => metadata.caseId === caseId);
  if (!example) throw new Error(`missing fake example ${caseId}`);
  return example;
}

function passingExperimentOutput(): LiveQualityExperimentOutput {
  return {
    responseText: 'Mình xin lỗi về trải nghiệm này. Bạn cho mình biết thêm chi tiết nhé.',
    plannerRecords: [{
      toolNames: [],
      calls: [],
      booleanEntities: {},
      catalogCandidateCodes: [],
      catalogModifierOptionNames: [],
      fulfillmentLocations: [],
    }],
    executedTools: [],
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
    },
  };
}

describe('live quality LangSmith dataset', () => {
  it('derives both modes and stable fingerprints from the repository ledger', () => {
    const first = datasetCases();
    const second = datasetCases();

    expect(first).toHaveLength(92);
    expect(new Set(first.map(({ inputs }) => inputs.caseId)).size).toBe(92);
    expect(liveQualityInventoryDigest(first)).toBe(LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST);
    expect(first.map(({ inputs }) => inputs.mode)).toEqual(expect.arrayContaining(['genui', 'text']));
    expect(first.map(({ metadata }) => metadata.fingerprint))
      .toEqual(second.map(({ metadata }) => metadata.fingerprint));
    const changedInventory = structuredClone(liveScenarioCases);
    changedInventory[0]!.turnExpectations[0]!.latency.maxTurnMs += 1;
    const changedFingerprint = buildLiveQualityDatasetCases({
      inventoryVersion: SCENARIO_COVERAGE_LEDGER_VERSION,
      scenarioCases: changedInventory,
    })[0]!.metadata.fingerprint;
    expect(changedFingerprint).not.toBe(first[0]!.metadata.fingerprint);
    const textCase = first.find(({ inputs }) =>
      inputs.caseId === '03-ton-kho-dia-chi-va-cua-hang.json#1:text');
    const genUiCase = first.find(({ inputs }) =>
      inputs.caseId === '03-ton-kho-dia-chi-va-cua-hang.json#1:genui');
    expect(genUiCase?.outputs.expectation.genUi.required).toBe(true);
    expect(textCase?.outputs.expectation.genUi).toMatchObject({
      required: false,
    });
    expect(textCase?.outputs.expectation.genUi.requiredDataPaths)
      .toEqual(genUiCase?.outputs.expectation.genUi.requiredDataPaths);
    for (const scenarioCase of liveScenarioCases) {
      for (const originalExpectation of scenarioCase.turnExpectations) {
        for (const mode of ['genui', 'text'] as const) {
          const built = first.find(({ inputs }) =>
            inputs.caseId === `${originalExpectation.id}:${mode}`);
          expect(built?.outputs.expectation).toEqual(
            expectationForLiveQualityMode(originalExpectation, mode),
          );
        }
      }
    }
  });

  it('creates, updates, skips, and removes only repository-owned examples', async () => {
    const client = new FakeLangSmithClient();
    const cases = datasetCases();
    const testCase = cases[0]!;
    const first = await syncLiveQualityDataset(client as unknown as Client, cases);

    expect(first.created).toHaveLength(92);
    expect(first.created).toContain(testCase.inputs.caseId);
    expect(client.readDatasetCalls).toBe(1);
    expect(client.readDatasetRequests[0]).toEqual({ datasetId: 'dataset-live-quality' });
    expect(client.examples).toHaveLength(92);
    const second = await syncLiveQualityDataset(client as unknown as Client, cases);
    expect(second.unchanged).toHaveLength(92);
    expect(second.unchanged).toContain(testCase.inputs.caseId);

    findExample(client, testCase.inputs.caseId).inputs.customerMessage = 'tampered remote input';
    const repaired = await syncLiveQualityDataset(client as unknown as Client, cases);
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

    const third = await syncLiveQualityDataset(client as unknown as Client, cases);
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
        syncLiveQualityDataset(client as unknown as Client, datasetCases()),
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
      syncLiveQualityDataset(client as unknown as Client, datasetCases()),
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
      syncLiveQualityDataset(client as unknown as Client, datasetCases()),
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
      syncLiveQualityDataset(client as unknown as Client, datasetCases()),
    ).rejects.toThrow('Refusing LangSmith dataset ID mismatch');
    expect(client.readDatasetRequests[0]).toEqual({ datasetId: 'dataset-create-response' });
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
    invalidMessage[0]!.inputs.customerMessage = 'rehashed but not bound to the expectation';
    invalidMessage[0] = refreshFingerprint(invalidMessage[0]!);
    const invalidScenario = structuredClone(canonical);
    invalidScenario[0]!.inputs.scenarioFile = '99-foreign-scenario.json';
    invalidScenario[0] = refreshFingerprint(invalidScenario[0]!);
    const invalidInventoryVersion = structuredClone(canonical);
    (invalidInventoryVersion[0]!.metadata as { inventoryVersion: string }).inventoryVersion =
      '2099-01-01.1';
    invalidInventoryVersion[0] = refreshFingerprint(invalidInventoryVersion[0]!);
    const divergentModes = structuredClone(canonical);
    const textIndex = divergentModes.findIndex(({ inputs }) =>
      inputs.caseId === `${testCase.outputs.expectation.id}:text`);
    divergentModes[textIndex]!.outputs.expectation.latency.maxTurnMs += 1;
    divergentModes[textIndex] = refreshFingerprint(divergentModes[textIndex]!);
    const forgedPair = structuredClone(canonical);
    for (const [index, candidate] of forgedPair.entries()) {
      if (candidate.outputs.expectation.id !== testCase.outputs.expectation.id) continue;
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
    const attempts: Array<{ cases: unknown[]; expectedError?: string }> = [
      { cases: [], expectedError: 'incomplete live quality inventory' },
      { cases: canonical.slice(0, 1), expectedError: 'incomplete live quality inventory' },
      { cases: [...canonical, structuredClone(testCase)], expectedError: 'Duplicate live quality case' },
      { cases: forgedFingerprint },
      { cases: invalidMessage },
      { cases: invalidScenario },
      { cases: invalidInventoryVersion },
      { cases: divergentModes },
      { cases: forgedPair, expectedError: 'non-canonical live quality inventory digest' },
      { cases: invalidMode, expectedError: 'inputs.mode' },
    ];

    for (const { cases, expectedError } of attempts) {
      const client = new FakeLangSmithClient();
      client.datasetExists = true;
      client.examples.push(ownedExample(testCase, 'preserved'));
      await expect(syncLiveQualityDataset(client as unknown as Client, cases))
        .rejects.toThrow(expectedError);
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
      inputs: structuredClone(testCase.inputs) as unknown as Record<string, unknown>,
      outputs: structuredClone(testCase.outputs) as unknown as Record<string, unknown>,
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

    const result = await syncLiveQualityDataset(client as unknown as Client, cases);

    expect(result.created).toHaveLength(92);
    expect(result.created).toContain(testCase.inputs.caseId);
    expect(result.deleted).toEqual([]);
    expect(client.examples.map(({ id }) => id)).toContain('manual-same-case');
    expect(client.examples.map(({ id }) => id)).toContain('foreign-schema');
    expect(client.examples).toHaveLength(94);
  });

  it('repairs inventory metadata, split metadata, and stale-fingerprint content drift', async () => {
    const client = new FakeLangSmithClient();
    const cases = datasetCases();
    const original = cases[0]!;
    await syncLiveQualityDataset(client as unknown as Client, cases);

    findExample(client, original.inputs.caseId).metadata.inventoryVersion = 'tampered-inventory';
    expect(
      (await syncLiveQualityDataset(client as unknown as Client, cases)).updated,
    ).toEqual([original.inputs.caseId]);

    findExample(client, original.inputs.caseId).metadata.dataset_split = ['manual'];
    expect(
      (await syncLiveQualityDataset(client as unknown as Client, cases)).updated,
    ).toEqual([original.inputs.caseId]);

    const drifted = findExample(client, original.inputs.caseId);
    (drifted.outputs as unknown as LiveQualityDatasetCase['outputs'])
      .expectation.latency.maxTurnMs += 1;
    expect(drifted.metadata.fingerprint).toBe(original.metadata.fingerprint);
    expect(
      (await syncLiveQualityDataset(client as unknown as Client, cases)).updated,
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

    const result = await syncLiveQualityDataset(client as unknown as Client, cases);

    expect(result.unchanged).toEqual([testCase.inputs.caseId]);
    expect(result.created).toHaveLength(91);
    expect(result.updated).toEqual([]);
    expect(client.updateCalls).toEqual([]);
    expect(client.deleteCalls).toEqual(['a-stale']);
    expect(client.examples).toHaveLength(92);
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
      syncLiveQualityDataset(updateClient as unknown as Client, cases),
    ).rejects.toThrow('injected update failure');
    expect(updateClient.deleteCalls).toEqual([]);
    expect(updateClient.examples.map(({ id }) => id)).toEqual(['a-stale', 'b-stale']);

    const createClient = new FakeLangSmithClient();
    createClient.datasetExists = true;
    const staleCase = ownedExample(testCase, 'stale-other-case');
    staleCase.metadata.caseId = 'stale-other-case';
    createClient.examples.push(staleCase);
    createClient.failCreate = true;

    await expect(
      syncLiveQualityDataset(createClient as unknown as Client, cases),
    ).rejects.toThrow('injected create failure');
    expect(createClient.deleteCalls).toEqual([]);
    expect(createClient.examples.map(({ id }) => id)).toEqual(['stale-other-case']);
  });

  it('reuses the local deterministic oracle as LangSmith experiment scores', async () => {
    const cases = datasetCases();
    const testCase = cases.find(({ inputs }) =>
      inputs.caseId === '05-khieu-nai-va-human-handoff.json#1:text');
    const evaluator = createLiveQualityExperimentEvaluator(cases);
    const scores = await evaluator({
      inputs: { caseId: testCase!.inputs.caseId },
      outputs: {
        responseText: 'Mình xin lỗi về trải nghiệm này. Bạn cho mình biết thêm chi tiết nhé.',
        plannerRecords: [{
          toolNames: [],
          calls: [],
          booleanEntities: {},
          catalogCandidateCodes: [],
          catalogModifierOptionNames: [],
          fulfillmentLocations: [],
        }],
        executedTools: [],
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
        },
      },
    });

    expect(scores.find(({ key }) => key === 'acceptance')).toMatchObject({
      score: 1,
      value: true,
    });
    await expect(evaluator({
      inputs: { caseId: 'dataset-only-case' },
      outputs: {},
    })).rejects.toThrow('Unknown live quality evaluation case');
  });

  it('keeps every acceptance score identical through the local and LangSmith adapters', async () => {
    const sourceCase = datasetCases().find(({ inputs }) =>
      inputs.caseId === '05-khieu-nai-va-human-handoff.json#1:text')!;
    const toolTrace = {
      toolName: 'handoff' as const,
      arguments: { reason: 'customer_requested' },
      ok: true,
      resultSummary: 'handoff created',
      provenance: [{ fixtureMode: 'test_only' as const, sourceFile: 'test' }],
    };
    const parity = async (
      testCase: LiveQualityDatasetCase,
      output: LiveQualityExperimentOutput,
    ) => {
      const direct = evaluateLiveQualityOutput(
        testCase.outputs.expectation,
        output,
        testCase.inputs.mode,
      );
      const adapted = await createLiveQualityExperimentEvaluator([testCase])({
        inputs: { caseId: testCase.inputs.caseId },
        outputs: output as unknown as Record<string, unknown>,
      });
      expect(adapted.map(({ key, value, comment }) => ({
        key,
        score: value,
        ...(comment ? { comment } : {}),
      }))).toEqual(direct);
      return direct;
    };
    const caseWith = (
      label: string,
      mode: LiveQualityDatasetCase['inputs']['mode'],
      expectation: LiveQualityDatasetCase['outputs']['expectation'],
    ): LiveQualityDatasetCase => refreshFingerprint({
      ...structuredClone(sourceCase),
      inputs: {
        ...structuredClone(sourceCase.inputs),
        caseId: `${label}:${mode}`,
        mode,
      },
      outputs: { expectation },
      metadata: {
        ...structuredClone(sourceCase.metadata),
        caseId: `${label}:${mode}`,
      },
    });

    const countExpectation: TurnExpectation = {
      ...structuredClone(sourceCase.outputs.expectation),
      allowedTools: ['handoff'],
      requiredGroups: [],
      forbiddenTools: [],
      toolCounts: [{ toolName: 'handoff' as const, min: 0, max: 1 }],
      toolOrder: [],
      toolOrderGroups: [],
      argumentConstraints: [],
      claims: { required: [], forbidden: [] },
      providerEvidence: {
        requireToolProvenance: false,
        requireRevisionOrSource: false,
        providerTools: [],
        allowFailure: false,
      },
    };
    const countOutput = passingExperimentOutput();
    countOutput.plannerRecords[0]!.toolNames = ['handoff'];
    countOutput.executedTools = [toolTrace];
    const countScores = await parity(caseWith('count', 'text', countExpectation), countOutput);
    expect(countScores.find(({ key }) => key === 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('observed 2, maximum 1'),
    });
    expect(countScores.find(({ key }) => key === 'acceptance')?.score).toBe(false);

    const genUiExpectation: TurnExpectation = {
      ...structuredClone(sourceCase.outputs.expectation),
      genUi: {
        required: true,
        allowedWidgetKinds: ['supportHandoff'],
        requiredDataPaths: ['id', 'lifecycleStage', 'widgetKind', 'status', 'data', 'actions'],
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
    expect(forbiddenActionScores.find(({ key }) => key === 'presentation_contract')).toMatchObject({
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
    expect(textGenUiScores.find(({ key }) => key === 'presentation_contract')).toMatchObject({
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
    expect(nullGenUiScores.find(({ key }) => key === 'presentation_contract')).toMatchObject({
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
      caseWith('persistence', 'text', sourceCase.outputs.expectation),
      persistenceOutput,
    );
    expect(persistenceScores.find(({ key }) => key === 'persistence')?.score).toBe(false);

    const checkpointOptionalOutput = passingExperimentOutput();
    checkpointOptionalOutput.persistence.checkpointId = undefined;
    checkpointOptionalOutput.persistence.checkpointNamespace = undefined;
    const checkpointOptionalScores = await parity(
      caseWith(
        'live-checkpoint-optional',
        'text',
        sourceCase.outputs.expectation,
      ),
      checkpointOptionalOutput,
    );
    expect(checkpointOptionalScores.find(({ key }) => key === 'persistence')?.score).toBe(true);

    const structuralExpectation: TurnExpectation = {
      ...structuredClone(sourceCase.outputs.expectation),
      stateTransition: {
        mayChange: [],
        mustChange: [],
        mustNotChange: ['cart'],
      },
    };
    const structuralOutput = passingExperimentOutput();
    structuralOutput.stateBefore = { cart: { id: 'cart-1', quantity: 1 } };
    structuralOutput.stateAfter = { cart: { quantity: 1, id: 'cart-1' } };
    const structuralScores = await parity(
      caseWith('structural-state', 'text', structuralExpectation),
      structuralOutput,
    );
    expect(structuralScores.find(({ key }) => key === 'state_transition')?.score).toBe(true);

    const provenanceExpectation: TurnExpectation = {
      ...countExpectation,
      toolCounts: [{ toolName: 'handoff' as const, min: 1, max: 1 }],
      providerEvidence: {
        requireToolProvenance: true,
        requireRevisionOrSource: true,
        providerTools: ['handoff'],
        allowFailure: false,
      },
    };
    const provenanceOutput = passingExperimentOutput();
    provenanceOutput.executedTools = [{ ...toolTrace, provenance: [] }];
    const provenanceScores = await parity(
      caseWith('provenance', 'text', provenanceExpectation),
      provenanceOutput,
    );
    expect(provenanceScores.find(({ key }) => key === 'provider_evidence')).toMatchObject({
      score: false,
      comment: expect.stringContaining('without provenance'),
    });

    const latencyOutput = passingExperimentOutput();
    latencyOutput.durationMs = sourceCase.outputs.expectation.latency.maxTurnMs + 1;
    const latencyScores = await parity(
      caseWith('latency', 'text', sourceCase.outputs.expectation),
      latencyOutput,
    );
    expect(latencyScores.find(({ key }) => key === 'latency')?.score).toBe(false);
    expect(latencyScores.find(({ key }) => key === 'acceptance')?.score).toBe(false);
  });

  it('uses the requested versioned dataset name', () => {
    expect(LIVE_QUALITY_DATASET_NAME).toBe('kfc-live-quality-v1');
  });
});
