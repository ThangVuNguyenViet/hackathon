import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import {
  providerPortableToolSchema,
} from '../../src/agent/providerPortableToolSchema.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  groundedResponseToolDefinition,
  groundedResponseSchema,
} from '../../src/agent/responseGrounding.js';
import {
  agentToolArgumentSchemas,
  toolNames,
} from '../../src/ordering/toolCatalog.js';

const forbiddenKeywords = new Set([
  '$defs',
  '$ref',
  '$schema',
  'const',
  'definitions',
  'exclusiveMaximum',
  'exclusiveMinimum',
]);

function schemaKeywords(
  value: unknown,
  found = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) schemaKeywords(entry, found);
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, entry] of Object.entries(value)) {
    found.add(key);
    schemaKeywords(entry, found);
  }
  return found;
}

describe('provider-portable commerce tool schemas', () => {
  it('serializes every commerce tool to the shared provider subset', () => {
    const definitions = commerceToolDefinitions();

    expect(definitions.map(({ name }) => name)).toEqual(toolNames);
    expect(definitions).toHaveLength(33);
    for (const definition of definitions) {
      expect(definition.description).toContain(definition.name);
      expect(definition.schema).toMatchObject({ type: 'object' });
      expect(JSON.parse(JSON.stringify(definition.schema)))
        .toEqual(definition.schema);
      const keywords = schemaKeywords(definition.schema);
      for (const forbidden of forbiddenKeywords) {
        expect(keywords, `${definition.name}:${forbidden}`)
          .not.toContain(forbidden);
      }
    }
  });

  it('serializes the grounded response tool through the same subset', () => {
    expect(groundedResponseToolDefinition.name)
      .toBe(GROUNDED_RESPONSE_TOOL_NAME);
    expect(groundedResponseToolDefinition.schema)
      .toMatchObject({ type: 'object' });
    const keywords = schemaKeywords(
      groundedResponseToolDefinition.schema,
    );
    for (const forbidden of forbiddenKeywords) {
      expect(
        keywords,
        `${GROUNDED_RESPONSE_TOOL_NAME}:${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it('dereferences and normalizes provider-incompatible schema keywords', () => {
    const sharedPositiveInteger = z.number().int().positive();
    const schema = z.union([
      z.object({
        kind: z.literal('first'),
        count: sharedPositiveInteger,
      }).strict(),
      z.object({
        kind: z.literal('second'),
        count: sharedPositiveInteger,
        ratio: z.number().gt(0).lt(1),
      }).strict(),
    ]);

    const portable = providerPortableToolSchema(schema);
    const serialized = JSON.stringify(portable);

    expect(portable).toMatchObject({
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['first'] },
            count: { type: 'integer', minimum: 1 },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['second'] },
            count: { type: 'integer', minimum: 1 },
            ratio: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      ],
    });
    for (const forbidden of forbiddenKeywords) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it('leaves runtime Zod validation authoritative', () => {
    expect(agentToolArgumentSchemas.searchMenu.safeParse({
      scope: 'all',
      query: 'not-null',
    }).success).toBe(false);
    expect(agentToolArgumentSchemas.acquireVoucher.safeParse({
      rewardId: 'reward-discount-10k',
      confirmed: true,
    }).success).toBe(false);
    expect(groundedResponseSchema.safeParse({
      customerText: 'Unsupported raw response',
    }).success).toBe(false);
  });

  it('rejects a non-object provider tool schema', () => {
    expect(() => providerPortableToolSchema(z.string()))
      .toThrow('provider_tool_schema_root_must_be_object');
  });
});
