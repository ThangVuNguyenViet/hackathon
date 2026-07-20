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

function schemaRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

describe('provider-portable commerce tool schemas', () => {
  it('serializes every commerce tool to the shared provider subset', () => {
    const definitions = commerceToolDefinitions();

    expect(definitions.map(({ name }) => name)).toEqual(toolNames);
    expect(definitions).toHaveLength(toolNames.length);
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

  it('publishes one OpenAI-strict grounded response object with a nullable selected action', () => {
    expect(groundedResponseToolDefinition.description).toContain(
      'factualClaims: { evidenceReferences, hasUnsupportedFactualClaim }',
    );
    expect(groundedResponseToolDefinition.description).toContain(
      'hasUnsupportedFactualClaim is required inside factualClaims and is never a top-level field',
    );
    expect(groundedResponseToolDefinition.description).toContain(
      'Copy responseContract.selectedActionResponse exactly; never derive it from publication evidence',
    );
    const schema = schemaRecord(
      groundedResponseToolDefinition.schema,
      'grounded response schema',
    );
    const properties = schemaRecord(
      schema.properties,
      'grounded response properties',
    );
    expect([...(schema.required as string[])].sort())
      .toEqual(Object.keys(properties).sort());

    const selectedAction = schemaRecord(
      properties.selectedActionResponse,
      'selected action response',
    );
    const branches = selectedAction.anyOf as unknown[];
    expect(branches).toHaveLength(2);
    expect(branches).toEqual(expect.arrayContaining([
      { type: 'null' },
      expect.objectContaining({
        type: 'object',
        additionalProperties: false,
      }),
    ]));
    const objectBranch = branches
      .map((branch) => schemaRecord(branch, 'selected action branch'))
      .find((branch) => branch.type === 'object');
    expect(objectBranch).toBeDefined();
    const objectProperties = schemaRecord(
      objectBranch?.properties,
      'selected action object properties',
    );
    expect([...(objectBranch?.required as string[])].sort())
      .toEqual(Object.keys(objectProperties).sort());
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

  it('rejects an intersected object root instead of publishing allOf', () => {
    const schema = z.intersection(
      z.object({ itemId: z.string() }).strict(),
      z.object({ quantity: z.number().int().positive() }).strict(),
    );

    expect(() => providerPortableToolSchema(schema))
      .toThrow('provider_tool_schema_all_of_unsupported');
  });

  it.each(['oneOf', 'allOf'] as const)(
    'rejects nested %s composition',
    (keyword) => {
      const schema = {
        type: 'object' as const,
        properties: {
          selection: {
            [keyword]: [
              { type: 'string' },
              { type: 'number' },
            ],
          },
        },
      };

      expect(() => providerPortableToolSchema(schema))
        .toThrow(`provider_tool_schema_${keyword === 'oneOf'
          ? 'one_of'
          : 'all_of'}_unsupported`);
    },
  );

  it('rejects non-string const values instead of widening them to enum', () => {
    const schema = z.object({
      confirmed: z.literal(true),
    }).strict();

    expect(() => providerPortableToolSchema(schema))
      .toThrow('provider_tool_schema_non_string_const_unsupported');
  });
});
