import { canonicalJson } from '../graph/turnSupport.js';
import type {
  ModelPublicationEvidence,
  ModelPublicationState,
} from './modelPublicationProjection.js';

export const MODEL_PUBLICATION_VALUE_REFERENCE_KEY =
  '__kfcPublicationValue_v1' as const;

const minimumInternedValueBytes = 128;

type JsonRecord = Record<string, unknown>;

export interface CompactModelPublicationValues {
  valueTable: Record<string, unknown>;
  modelState: unknown;
  evidence: Array<Omit<ModelPublicationEvidence, 'value'> & { value: unknown }>;
  statistics: {
    uniqueValueCount: number;
    referenceCount: number;
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComposite(value: unknown): value is unknown[] | JsonRecord {
  return Array.isArray(value) || isRecord(value);
}

function collectCompositeValues(
  value: unknown,
  occurrences: Map<string, { count: number; value: unknown[] | JsonRecord }>,
): void {
  if (!isComposite(value)) return;
  const canonical = canonicalJson(value);
  const current = occurrences.get(canonical);
  if (current) {
    current.count += 1;
  } else {
    occurrences.set(canonical, { count: 1, value });
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectCompositeValues(entry, occurrences);
    return;
  }
  for (const entry of Object.values(value)) {
    collectCompositeValues(entry, occurrences);
  }
}

function reference(id: string): JsonRecord {
  return {
    [MODEL_PUBLICATION_VALUE_REFERENCE_KEY]: {
      kind: 'reference',
      id,
    },
  };
}

export function compactModelPublicationValues(input: {
  modelState: ModelPublicationState;
  evidence: readonly ModelPublicationEvidence[];
}): CompactModelPublicationValues {
  const occurrences = new Map<
    string,
    { count: number; value: unknown[] | JsonRecord }
  >();
  collectCompositeValues(input.modelState, occurrences);
  for (const evidence of input.evidence) {
    collectCompositeValues(evidence.value, occurrences);
  }

  const internedCanonicalValues = [...occurrences.entries()]
    .filter(
      ([canonical, occurrence]) =>
        occurrence.count > 1 &&
        Buffer.byteLength(canonical, 'utf8') >= minimumInternedValueBytes,
    )
    .map(([canonical]) => canonical)
    .sort();
  const ids = new Map(
    internedCanonicalValues.map((canonical, index) => [
      canonical,
      `value-${index + 1}`,
    ]),
  );
  let referenceCount = 0;

  const encode = (value: unknown, materializing?: string): unknown => {
    if (!isComposite(value)) return value;
    const canonical = canonicalJson(value);
    const id = ids.get(canonical);
    if (id && canonical !== materializing) {
      referenceCount += 1;
      return reference(id);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => encode(entry));
    }
    const encoded = Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, encode(entry)]),
    );
    if (MODEL_PUBLICATION_VALUE_REFERENCE_KEY in value) {
      return {
        [MODEL_PUBLICATION_VALUE_REFERENCE_KEY]: { kind: 'literal' },
        value: encoded,
      };
    }
    return encoded;
  };

  const valueTable = Object.fromEntries(
    internedCanonicalValues.map((canonical) => {
      const occurrence = occurrences.get(canonical);
      if (!occurrence) {
        throw new Error('agent_publication_value_projection_invalid');
      }
      return [ids.get(canonical)!, encode(occurrence.value, canonical)];
    }),
  );
  const modelState = encode(input.modelState);
  const evidence = input.evidence.map(({ value, ...metadata }) => ({
    ...metadata,
    value: encode(value),
  }));

  return {
    valueTable,
    modelState,
    evidence,
    statistics: {
      uniqueValueCount: internedCanonicalValues.length,
      referenceCount,
    },
  };
}
