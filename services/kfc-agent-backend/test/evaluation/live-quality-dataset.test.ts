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
  LIVE_QUALITY_INVENTORY_VERSION,
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
  evaluateLiveQualityModeParity,
  evaluateLiveQualityOutput,
} from '../../src/evaluation/liveQualityEvaluators.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

interface FakeExample {
  id: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

class FakeLangSmithClient {
  datasetExists = false;
  dataset = {
    id: 'dataset-live-quality-v2',
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
  readRequests: Array<{ datasetId?: string; datasetName?: string }> = [];
  listCalls = 0;
  failCreate = false;
  failUpdate = false;
  createResponseDatasetId: string | undefined;
  persistedDataset: typeof this.dataset | undefined;

  async hasDataset(): Promise<boolean> {
    return this.datasetExists;
  }

  async readDataset(request: { datasetId?: string; datasetName?: string }) {
    this.readRequests.push(request);
    return this.persistedDataset ?? this.dataset;
  }

  async createDataset(
    name: string,
    options: { description: string; dataType: string; metadata: Record<string, unknown> },
  ) {
    this.datasetExists = true;
    this.dataset = {
      id: 'dataset-live-quality-v2',
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
    return { ...this.dataset, id: this.createResponseDatasetId ?? this.dataset.id };
  }

  async getDatasetUrl() {
    return 'https://smith.test/datasets/dataset-live-quality-v2';
  }

  async *listExamples() {
    this.listCalls += 1;
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
      metadata: { ...structuredClone(example.metadata), dataset_split: [example.split] },
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
    this.examples[index] = {
      id: update.id,
      inputs: structuredClone(update.inputs),
      outputs: structuredClone(update.outputs),
      metadata: { ...structuredClone(update.metadata), dataset_split: [update.split] },
    };
  }

  async deleteExample(id: string) {
    this.deleteCalls.push(id);
    this.examples = this.examples.filter((example) => example.id !== id);
  }
}

function datasetCases(): LiveQualityDatasetCase[] {
  return buildLiveQualityDatasetCases({
    inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
    scenarioCases: liveScenarioCases,
  });
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

function refreshFingerprint(testCase: LiveQualityDatasetCase): void {
  testCase.metadata.fingerprint = liveQualityCaseFingerprint({
    inputs: testCase.inputs,
    outputs: testCase.outputs,
    metadata: {
      caseId: testCase.metadata.caseId,
      schemaVersion: testCase.metadata.schemaVersion,
      inventoryVersion: testCase.metadata.inventoryVersion,
      sourcePath: testCase.metadata.sourcePath,
      datasetName: testCase.metadata.datasetName,
      managedBy: testCase.metadata.managedBy,
    },
    split: testCase.split,
  });
}

function baseOutput(): LiveQualityExperimentOutput {
  return {
    responseText: 'A grounded customer response.',
    effects: [],
    evidence: [],
    stateBefore: {},
    stateAfter: {},
    presentationFacts: {},
    verifiedCollections: {},
    presentedCollections: {},
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

describe('live quality dataset inventory', () => {
  it('derives 96 stable Text and GenUI cases from the canonical JSON corpus', () => {
    const first = datasetCases();
    const second = datasetCases();
    expect(first).toHaveLength(96);
    expect(new Set(first.map(({ inputs }) => inputs.caseId)).size).toBe(96);
    expect(liveQualityInventoryDigest(first)).toBe(LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST);
    expect(first.map(({ metadata }) => metadata.fingerprint))
      .toEqual(second.map(({ metadata }) => metadata.fingerprint));
    const genui = first.find(({ inputs }) => inputs.caseId.endsWith('#1:genui'))!;
    const text = first.find(({ inputs }) => inputs.caseId ===
      `${genui.outputs.expectation.id}:text`)!;
    expect(text.outputs.expectation)
      .toEqual(expectationForLiveQualityMode(genui.outputs.expectation, 'text'));
    expect(text.outputs.expectation.outcome.presentation.genUi.required).toBe(false);
  });

  it('evaluates exact full-menu completeness and Text/GenUI fact parity without phrases', async () => {
    const expectation = liveScenarioCases[1]!.turnExpectations[0]!;
    const collection = {
      scope: 'all' as const,
      itemIds: ['a', 'b', 'c'],
      categories: ['one', 'two'],
      total: 3,
      returned: 3,
      complete: true,
      categoryTabs: ['one', 'two'],
      selectionLimit: 5,
    };
    const genuiOutput: LiveQualityExperimentOutput = {
      ...baseOutput(),
      evidence: [{
        kind: 'catalog',
        ref: 'catalog-revision-1',
        official: true,
        sourceApi: 'https://provider.test/menu',
      }],
      presentationFacts: { collectionRevision: 'catalog-revision-1' },
      verifiedCollections: { 'menu:all': structuredClone(collection) },
      presentedCollections: { 'menu:all': structuredClone(collection) },
      genUi: {
        widgetKind: 'smartMenuPicker',
        data: {
          items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          categories: ['one', 'two'],
          total: 3,
          returned: 3,
          complete: true,
          selectionLimit: 5,
        },
        actions: [],
      },
    };
    const textOutput = { ...structuredClone(genuiOutput), genUi: undefined };
    delete textOutput.presentedCollections['menu:all']!.categoryTabs;
    delete textOutput.presentedCollections['menu:all']!.selectionLimit;
    expect(evaluateLiveQualityOutput(expectation, genuiOutput, 'genui')
      .find(({ key }) => key === 'acceptance')?.score).toBe(true);
    expect(evaluateLiveQualityOutput(
      expectationForLiveQualityMode(expectation, 'text'),
      textOutput,
      'text',
    ).find(({ key }) => key === 'acceptance')?.score).toBe(true);
    expect(evaluateLiveQualityModeParity({
      expectation,
      text: textOutput,
      genui: genuiOutput,
    }).score).toBe(true);

    const truncated = structuredClone(genuiOutput);
    truncated.presentedCollections['menu:all']!.itemIds = ['a', 'b'];
    truncated.presentedCollections['menu:all']!.returned = 2;
    truncated.presentedCollections['menu:all']!.complete = false;
    expect(evaluateLiveQualityOutput(expectation, truncated, 'genui')
      .find(({ key }) => key === 'presentation')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact verified item set'),
    });

    const unboundWidget = structuredClone(genuiOutput);
    unboundWidget.genUi = {
      widgetKind: 'smartMenuPicker',
      data: {
        items: [{ id: 'a' }, { id: 'invented' }, { id: 'c' }],
        categories: ['one', 'two'],
        total: 3,
        returned: 3,
        complete: true,
        selectionLimit: 5,
      },
      actions: [],
    };
    expect(evaluateLiveQualityOutput(expectation, unboundWidget, 'genui')
      .find(({ key }) => key === 'presentation')).toMatchObject({
      score: false,
      comment: expect.stringContaining('GenUI items differ'),
    });

    const evaluatorCase = datasetCases().find(({ inputs }) =>
      inputs.caseId === `${expectation.id}:genui`)!;
    const native = evaluateLiveQualityOutput(expectation, genuiOutput, 'genui');
    const langsmith = await createLiveQualityExperimentEvaluator([evaluatorCase])({
      inputs: { caseId: evaluatorCase.inputs.caseId },
      outputs: genuiOutput as unknown as Record<string, unknown>,
    });
    expect(langsmith.map(({ key, value, comment }) => ({ key, score: value, comment })))
      .toEqual(native);
  });

  it('rejects forbidden effects and irreversible effects without receipts', () => {
    const forbiddenExpectation = structuredClone(liveScenarioCases[5]!.turnExpectations[5]!);
    const forbiddenOutput = baseOutput();
    forbiddenOutput.effects = [{ kind: 'private_contact_disclosed', ok: true }];
    expect(evaluateLiveQualityOutput(forbiddenExpectation, forbiddenOutput, 'text')
      .find(({ key }) => key === 'effects')?.score).toBe(false);

    const receiptExpectation: TurnExpectation = {
      ...structuredClone(forbiddenExpectation),
      outcome: {
        ...structuredClone(forbiddenExpectation.outcome),
        state: { mustChange: [], mustNotChange: [], facts: [] },
        effects: { required: ['order_created'], forbidden: [] },
        presentation: {
          genUi: { required: false, allowedWidgetKinds: [], requiredDataPaths: [], forbiddenActions: [] },
          collections: [],
        },
        provenance: { requiredEvidenceKinds: [], requireOfficialSameReference: false },
      },
    };
    const receiptOutput = baseOutput();
    receiptOutput.effects = [{ kind: 'order_created', ok: true }];
    expect(evaluateLiveQualityOutput(receiptExpectation, receiptOutput, 'text')
      .find(({ key }) => key === 'effects')).toMatchObject({
      score: false,
      comment: expect.stringContaining('no bound receipt'),
    });

    receiptOutput.effects = [{ kind: 'order_created', ok: true, receiptId: 'receipt-1' }];
    expect(evaluateLiveQualityOutput(receiptExpectation, receiptOutput, 'text')
      .find(({ key }) => key === 'effects')).toMatchObject({
      score: false,
      comment: expect.stringContaining('not bound to official evidence'),
    });

    receiptOutput.evidence = [{
      kind: 'order_receipt',
      ref: 'receipt-1',
      official: true,
      sourceApi: 'https://provider.test/orders/receipt-1',
    }];
    expect(evaluateLiveQualityOutput(receiptExpectation, receiptOutput, 'text')
      .find(({ key }) => key === 'effects')?.score).toBe(true);
  });

  it('includes every scenario identity field in case fingerprints and the canonical digest', () => {
    const canonical = datasetCases();
    const canonicalDigest = liveQualityInventoryDigest(canonical);
    const mutations: Array<(testCase: LiveQualityDatasetCase) => void> = [
      (testCase) => { testCase.inputs.scenario.title = `${testCase.inputs.scenario.title} changed`; },
      (testCase) => { testCase.inputs.scenario.channel = 'kfc'; },
      (testCase) => { testCase.inputs.scenario.goal = `${testCase.inputs.scenario.goal} changed`; },
      (testCase) => { testCase.inputs.scenario.useCaseIds = ['UC-39']; },
      (testCase) => { testCase.inputs.scenario.finalState = 'changed'; },
      (testCase) => {
        testCase.inputs.scenario.setup.requiresCustomerAccess =
          !testCase.inputs.scenario.setup.requiresCustomerAccess;
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(canonical);
      const beforeFingerprint = changed[0]!.metadata.fingerprint;
      mutate(changed[0]!);
      refreshFingerprint(changed[0]!);
      expect(changed[0]!.metadata.fingerprint).not.toBe(beforeFingerprint);
      expect(liveQualityInventoryDigest(changed)).not.toBe(canonicalDigest);
    }
  });
});

describe('fail-closed LangSmith synchronization', () => {
  it('creates 96 rows, is idempotent, repairs owned rows, and deletes only stale owned rows', async () => {
    const client = new FakeLangSmithClient();
    const cases = datasetCases();
    const first = await syncLiveQualityDataset(client as unknown as Client, cases);
    expect(first.created).toHaveLength(96);
    expect(client.readRequests[0]).toEqual({ datasetId: 'dataset-live-quality-v2' });
    const second = await syncLiveQualityDataset(client as unknown as Client, cases);
    expect(second.unchanged).toHaveLength(96);

    client.examples[0]!.inputs.customerMessage = 'tampered';
    client.examples.push({
      id: 'stale-owned',
      inputs: {},
      outputs: {},
      metadata: {
        caseId: 'stale',
        managedBy: LIVE_QUALITY_SYNC_OWNER,
        datasetName: LIVE_QUALITY_DATASET_NAME,
        schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
        sourcePath: LIVE_QUALITY_SOURCE_PATH,
      },
    });
    client.examples.push({ id: 'manual', inputs: {}, outputs: {}, metadata: { caseId: 'manual' } });
    const repaired = await syncLiveQualityDataset(client as unknown as Client, cases);
    expect(repaired.updated).toHaveLength(1);
    expect(repaired.deleted).toEqual(['stale']);
    expect(client.examples.some(({ id }) => id === 'manual')).toBe(true);
  });

  it('rejects unowned datasets and created/read ID mismatches before example access', async () => {
    const unowned = new FakeLangSmithClient();
    unowned.datasetExists = true;
    unowned.dataset.metadata.managedBy = 'manual';
    await expect(syncLiveQualityDataset(unowned as unknown as Client, datasetCases()))
      .rejects.toThrow('Refusing to synchronize unowned LangSmith dataset');
    expect(unowned.listCalls).toBe(0);

    const mismatch = new FakeLangSmithClient();
    mismatch.createResponseDatasetId = 'create-response-id';
    await expect(syncLiveQualityDataset(mismatch as unknown as Client, datasetCases()))
      .rejects.toThrow('Refusing LangSmith dataset ID mismatch');
    expect(mismatch.readRequests[0]).toEqual({ datasetId: 'create-response-id' });
    expect(mismatch.listCalls).toBe(0);
  });

  it('rejects incomplete, duplicate, forged, and divergent mode inventories before remote access', async () => {
    const canonical = datasetCases();
    const forged = structuredClone(canonical);
    forged[0]!.metadata.fingerprint = 'forged';
    const divergent = structuredClone(canonical);
    const text = divergent.find(({ inputs }) => inputs.caseId.endsWith('#1:text'))!;
    text.outputs.expectation.outcome.latency.maxTurnMs += 1;
    refreshFingerprint(text);
    const attempts: unknown[][] = [
      [],
      canonical.slice(0, 1),
      [...canonical, structuredClone(canonical[0]!)],
      forged,
      divergent,
    ];
    for (const cases of attempts) {
      const client = new FakeLangSmithClient();
      client.datasetExists = true;
      await expect(syncLiveQualityDataset(client as unknown as Client, cases)).rejects.toThrow();
      expect(client.listCalls).toBe(0);
    }
  });

  it('performs every create/update before deleting duplicates or stale rows', async () => {
    const canonical = datasetCases();
    for (const failure of ['create', 'update'] as const) {
      const client = new FakeLangSmithClient();
      client.datasetExists = true;
      client.examples = [
        ownedExample(canonical[0]!, 'canonical'),
        ownedExample(canonical[0]!, 'duplicate'),
        {
          ...ownedExample(canonical[0]!, 'stale'),
          metadata: {
            ...ownedExample(canonical[0]!, 'stale').metadata,
            caseId: 'stale-case',
          },
        },
      ];
      if (failure === 'create') {
        client.examples = client.examples.filter(({ id }) => id !== 'canonical' && id !== 'duplicate');
        client.failCreate = true;
      } else {
        client.examples[0]!.inputs.customerMessage = 'tampered';
        client.examples[1]!.inputs.customerMessage = 'tampered duplicate';
        client.failUpdate = true;
      }
      await expect(syncLiveQualityDataset(client as unknown as Client, canonical))
        .rejects.toThrow(`injected ${failure} failure`);
      expect(client.deleteCalls).toEqual([]);
    }
  });

  it('uses separately owned v2 identity and leaves the APAC v1 dataset untouched', () => {
    expect(LIVE_QUALITY_DATASET_NAME).toBe('kfc-live-quality-v2');
    expect(LIVE_QUALITY_SCHEMA_VERSION).toBe('kfc-live-quality-v2');
    expect(LIVE_QUALITY_DATASET_SPLIT).toBe('acceptance');
  });
});
