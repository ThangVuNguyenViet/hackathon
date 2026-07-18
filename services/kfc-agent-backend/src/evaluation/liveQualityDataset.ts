import { createHash } from 'node:crypto';
import {
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveQualityDatasetCase,
  type LiveQualityMode,
  type LiveScenarioCase,
  type TurnExpectation,
} from './liveQualityContracts.js';

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function expectationForLiveQualityMode(
  expectation: TurnExpectation,
  mode: LiveQualityMode,
): TurnExpectation {
  if (mode === 'genui') return expectation;
  return {
    ...expectation,
    genUi: { ...expectation.genUi, required: false },
  };
}

export function liveQualityCaseFingerprint(input: {
  inputs: LiveQualityDatasetCase['inputs'];
  outputs: LiveQualityDatasetCase['outputs'];
  metadata: Omit<LiveQualityDatasetCase['metadata'], 'fingerprint'>;
  split: string;
}): string {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

export function liveQualityInventoryDigest(cases: readonly LiveQualityDatasetCase[]): string {
  const orderedCases = [...cases].sort((left, right) =>
    left.inputs.caseId.localeCompare(right.inputs.caseId));
  return createHash('sha256').update(stableJson(orderedCases)).digest('hex');
}

export function buildLiveQualityDatasetCases(input: {
  inventoryVersion: string;
  scenarioCases: LiveScenarioCase[];
}): LiveQualityDatasetCase[] {
  return input.scenarioCases.flatMap((scenarioCase) =>
    scenarioCase.turnExpectations.flatMap((turnExpectation) =>
      (['genui', 'text'] as const).map((mode) => {
        const expectation = expectationForLiveQualityMode(turnExpectation, mode);
        const caseId = `${turnExpectation.id}:${mode}`;
        const inputs = {
          caseId,
          scenarioFile: scenarioCase.fileName,
          turnIndex: turnExpectation.turnIndex,
          mode,
          customerMessage: turnExpectation.input,
          preconditions: turnExpectation.preconditions,
          evidenceBindings: turnExpectation.evidenceBindings,
        };
        const outputs = { expectation };
        const managedMetadata = {
          caseId,
          schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
          inventoryVersion: input.inventoryVersion,
          sourcePath: LIVE_QUALITY_SOURCE_PATH,
          datasetName: LIVE_QUALITY_DATASET_NAME,
          managedBy: LIVE_QUALITY_SYNC_OWNER,
        } as const;
        const fingerprint = liveQualityCaseFingerprint({
          inputs,
          outputs,
          metadata: managedMetadata,
          split: LIVE_QUALITY_DATASET_SPLIT,
        });
        return {
          inputs,
          outputs,
          metadata: {
            ...managedMetadata,
            fingerprint,
          },
          split: LIVE_QUALITY_DATASET_SPLIT,
        };
      }),
    ),
  );
}
