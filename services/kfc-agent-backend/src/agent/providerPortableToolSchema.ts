import {
  toJsonSchema,
  type JSONSchema,
} from '@langchain/core/utils/json_schema';
import type { StructuredToolParams } from '@langchain/core/tools';

type JsonObject = Record<string, unknown>;

const removedSchemaKeywords = new Set([
  '$defs',
  '$schema',
  'definitions',
]);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveLocalReference(root: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) {
    throw new Error('provider_tool_schema_external_reference_unsupported');
  }
  let current = root;
  for (const token of reference.slice(2).split('/')) {
    const key = decodeJsonPointerToken(token);
    if (Array.isArray(current)) {
      const index = Number(key);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= current.length
      ) {
        throw new Error('provider_tool_schema_reference_missing');
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current)) {
      throw new Error('provider_tool_schema_reference_invalid');
    }
    if (!Object.hasOwn(current, key)) {
      throw new Error('provider_tool_schema_reference_missing');
    }
    current = current[key];
  }
  return current;
}

function integerSchema(schema: JsonObject): boolean {
  return schema.type === 'integer';
}

function inclusiveMinimum(
  schema: JsonObject,
  exclusiveMinimum: unknown,
): number | undefined {
  if (typeof exclusiveMinimum !== 'number') return undefined;
  return integerSchema(schema)
    ? Math.floor(exclusiveMinimum) + 1
    : exclusiveMinimum;
}

function inclusiveMaximum(
  schema: JsonObject,
  exclusiveMaximum: unknown,
): number | undefined {
  if (typeof exclusiveMaximum !== 'number') return undefined;
  return integerSchema(schema)
    ? Math.ceil(exclusiveMaximum) - 1
    : exclusiveMaximum;
}

function normalizeSchemaNode(
  value: unknown,
  root: unknown,
  referenceStack: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeSchemaNode(entry, root, referenceStack));
  }
  if (!isRecord(value)) return value;

  const reference = value.$ref;
  if (typeof reference === 'string') {
    if (referenceStack.has(reference)) {
      throw new Error('provider_tool_schema_recursive_reference_unsupported');
    }
    const nextStack = new Set(referenceStack);
    nextStack.add(reference);
    const resolved = normalizeSchemaNode(
      resolveLocalReference(root, reference),
      root,
      nextStack,
    );
    if (!isRecord(resolved)) {
      throw new Error('provider_tool_schema_reference_invalid');
    }
    const siblings = normalizeSchemaNode(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== '$ref'),
      ),
      root,
      referenceStack,
    );
    if (!isRecord(siblings)) {
      throw new Error('provider_tool_schema_reference_invalid');
    }
    return { ...resolved, ...siblings };
  }

  const normalized: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      removedSchemaKeywords.has(key) ||
      key === 'const' ||
      key === 'exclusiveMinimum' ||
      key === 'exclusiveMaximum'
    ) {
      continue;
    }
    normalized[key] = normalizeSchemaNode(entry, root, referenceStack);
  }

  if (Object.hasOwn(value, 'const')) {
    normalized.enum = [
      normalizeSchemaNode(value.const, root, referenceStack),
    ];
  }

  const minimum = inclusiveMinimum(value, value.exclusiveMinimum);
  if (minimum !== undefined) {
    normalized.minimum =
      typeof normalized.minimum === 'number'
        ? Math.max(normalized.minimum, minimum)
        : minimum;
  }
  const maximum = inclusiveMaximum(value, value.exclusiveMaximum);
  if (maximum !== undefined) {
    normalized.maximum =
      typeof normalized.maximum === 'number'
        ? Math.min(normalized.maximum, maximum)
        : maximum;
  }
  return normalized;
}

function objectBranch(value: unknown): boolean {
  return isRecord(value) && value.type === 'object';
}

function ensureObjectRoot(value: unknown): JsonObject {
  if (!isRecord(value)) {
    throw new Error('provider_tool_schema_root_must_be_object');
  }
  if (value.type === 'object') return value;
  const union = value.anyOf ?? value.oneOf ?? value.allOf;
  if (Array.isArray(union) && union.length > 0 && union.every(objectBranch)) {
    return { ...value, type: 'object' };
  }
  throw new Error('provider_tool_schema_root_must_be_object');
}

/**
 * Convert one runtime-authoritative Zod schema into the conservative JSON
 * Schema subset accepted by both configured model providers.
 */
export function providerPortableToolSchema(
  schema: StructuredToolParams['schema'],
): JSONSchema {
  const generated = toJsonSchema(schema);
  return ensureObjectRoot(
    normalizeSchemaNode(generated, generated, new Set()),
  ) as JSONSchema;
}
