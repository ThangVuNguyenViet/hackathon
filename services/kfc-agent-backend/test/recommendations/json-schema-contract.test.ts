import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;
type JsonObject = { [key: string]: JsonValue };
type DefinitionName =
  | 'RecommendationDecisionRequest'
  | 'RecommendationDecisionResponse'
  | 'RecommendationEvent';

interface InvalidCase {
  name: string;
  definition: DefinitionName;
  source: string;
  patch: Record<string, JsonValue>;
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const contractDirectory = resolve(repoRoot, 'contracts/recommendations/v1');
const examplesDirectory = resolve(contractDirectory, 'examples');
const schemaPath = resolve(contractDirectory, 'kfc-recommendation.schema.json');

const readJson = async (path: string): Promise<JsonValue> =>
  JSON.parse(await readFile(path, 'utf8')) as JsonValue;

const readObject = async (path: string): Promise<JsonObject> => {
  const value = await readJson(path);
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`Expected a JSON object at ${path}`);
  }
  return value;
};

const readInvalidCases = async (): Promise<InvalidCase[]> => {
  const value = await readJson(
    resolve(examplesDirectory, 'invalid-contract-values.json'),
  );
  if (!Array.isArray(value)) {
    throw new Error(
      'Expected invalid-contract-values.json to contain an array',
    );
  }
  return value as unknown as InvalidCase[];
};

const getAtPath = (value: JsonObject, path: string): JsonValue => {
  let current: JsonValue = value;
  for (const segment of path.split('.')) {
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== 'object'
    ) {
      throw new Error(`Cannot read ${path}`);
    }
    current = current[segment];
  }
  return current;
};

const setAtPath = (value: JsonObject, path: string, replacement: JsonValue) => {
  const segments = path.split('.');
  const lastSegment = segments.pop();
  if (lastSegment === undefined) {
    throw new Error('Patch path cannot be empty');
  }

  let target: JsonObject = value;
  for (const segment of segments) {
    const next = target[segment];
    if (next === null || Array.isArray(next) || typeof next !== 'object') {
      throw new Error(`Cannot write ${path}`);
    }
    target = next;
  }
  target[lastSegment] = replacement;
};

const expandActionCopies = (
  current: JsonValue,
  replacement: JsonValue,
): JsonValue => {
  if (
    !Array.isArray(replacement) ||
    replacement.length === 0 ||
    !replacement.every((value) => value === 'copy:0')
  ) {
    return replacement;
  }
  if (!Array.isArray(current) || current.length === 0) {
    throw new Error('copy:0 requires an existing action');
  }
  const firstAction = current[0];
  if (
    firstAction === null ||
    Array.isArray(firstAction) ||
    typeof firstAction !== 'object'
  ) {
    throw new Error('copy:0 requires an object action');
  }
  return replacement.map((_copy, index) => ({
    ...structuredClone(firstAction),
    actionId: `action-product-copy-${index + 1}`,
  }));
};

const applyPatch = (
  source: JsonObject,
  patch: Record<string, JsonValue>,
): JsonObject => {
  const patched = structuredClone(source);
  for (const [path, replacement] of Object.entries(patch)) {
    setAtPath(
      patched,
      path,
      expandActionCopies(getAtPath(patched, path), replacement),
    );
  }
  return patched;
};

describe('recommendation JSON Schema contract', async () => {
  const schema = await readObject(schemaPath);
  const validRequest = await readObject(
    resolve(examplesDirectory, 'valid-decision-request.json'),
  );
  const validResponse = await readObject(
    resolve(examplesDirectory, 'valid-decision-response.json'),
  );
  const validEvent = await readObject(
    resolve(examplesDirectory, 'valid-recommendation-event.json'),
  );
  const invalidCases = await readInvalidCases();
  const ajv = new (
    Ajv2020 as unknown as typeof import('ajv/dist/2020.js').Ajv2020
  )({ allErrors: true, strict: true });
  (addFormats as unknown as typeof import('ajv-formats').default)(ajv);
  ajv.addSchema(schema);

  const schemaId = schema.$id;
  if (typeof schemaId !== 'string') {
    throw new Error('Schema must have a string $id');
  }
  const requestValidator = ajv.getSchema(
    `${schemaId}#/$defs/RecommendationDecisionRequest`,
  );
  const responseValidator = ajv.getSchema(
    `${schemaId}#/$defs/RecommendationDecisionResponse`,
  );
  const eventValidator = ajv.getSchema(
    `${schemaId}#/$defs/RecommendationEvent`,
  );
  if (
    requestValidator === undefined ||
    responseValidator === undefined ||
    eventValidator === undefined
  ) {
    throw new Error('Expected all addressable recommendation schemas');
  }

  const validatorFor = (definition: DefinitionName) => {
    switch (definition) {
      case 'RecommendationDecisionRequest':
        return requestValidator;
      case 'RecommendationDecisionResponse':
        return responseValidator;
      case 'RecommendationEvent':
        return eventValidator;
    }
  };

  it.each([
    ['RecommendationDecisionRequest', validRequest],
    ['RecommendationDecisionResponse', validResponse],
    ['RecommendationEvent', validEvent],
  ] as const)('accepts the canonical %s example', (name, value) => {
    expect(validatorFor(name)(value)).toBe(true);
  });

  it.each(invalidCases)('rejects $name', (invalidCase) => {
    const value = applyPatch(getSource(invalidCase.source), invalidCase.patch);
    expect(validatorFor(invalidCase.definition)(value)).toBe(false);
  });

  function getSource(source: string): JsonObject {
    switch (source) {
      case 'valid-decision-request.json':
        return validRequest;
      case 'valid-decision-response.json':
        return validResponse;
      case 'valid-recommendation-event.json':
        return validEvent;
      default:
        throw new Error(`Unknown example source: ${source}`);
    }
  }
});
