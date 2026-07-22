import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import { providerPortableToolSchema } from '../../src/agent/providerPortableToolSchema.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  groundedResponseSchema,
  ordinaryGroundedResponseToolDefinition,
  ordinaryGroundedResponseSchema,
  selectedActionGroundedResponseToolDefinition,
  selectedActionGroundedResponseSchema,
} from '../../src/agent/responseGrounding.js';
import {
  agentToolArgumentSchemas,
  parseAgentToolArguments,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function assertStrictObjects(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertStrictObjects(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === 'object') {
    expect(value.additionalProperties, path).toBe(false);
    const properties = schemaRecord(value.properties, `${path}.properties`);
    if (Object.keys(properties).length === 0) {
      expect(
        value.required === undefined || Array.isArray(value.required),
      ).toBe(true);
    } else {
      expect(
        stringArray(value.required, `${path}.required`).sort(),
        path,
      ).toEqual(Object.keys(properties).sort());
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    assertStrictObjects(entry, `${path}.${key}`);
  }
}

describe('provider-portable commerce tool schemas', () => {
  it('serializes every commerce tool to the shared provider subset', () => {
    const definitions = commerceToolDefinitions();

    expect(definitions.map(({ name }) => name)).toEqual(toolNames);
    expect(definitions).toHaveLength(toolNames.length);
    for (const definition of definitions) {
      expect(definition.description).toContain(definition.name);
      expect(definition.schema).toMatchObject({ type: 'object' });
      expect(JSON.parse(JSON.stringify(definition.schema))).toEqual(
        definition.schema,
      );
      const keywords = schemaKeywords(definition.schema);
      for (const forbidden of forbiddenKeywords) {
        expect(keywords, `${definition.name}:${forbidden}`).not.toContain(
          forbidden,
        );
      }
      assertStrictObjects(definition.schema, definition.name);
    }
  });

  it('publishes a closed canonical payment-surface vocabulary', () => {
    expect(
      agentToolArgumentSchemas.listPaymentMethods.safeParse({
        query: null,
        paymentSurface: 'kfc_website_checkout',
      }).success,
    ).toBe(true);
    expect(
      agentToolArgumentSchemas.listPaymentMethods.safeParse({
        query: null,
        paymentSurface: 'web_app',
      }).success,
    ).toBe(false);

    const definition = commerceToolDefinitions().find(
      ({ name }) => name === 'listPaymentMethods',
    );
    expect(JSON.stringify(definition?.schema)).toContain(
      'kfc_website_checkout',
    );
  });

  it('serializes both grounded response modes through the same subset', () => {
    for (const definition of [
      ordinaryGroundedResponseToolDefinition,
      selectedActionGroundedResponseToolDefinition,
    ]) {
      expect(definition.name).toBe(GROUNDED_RESPONSE_TOOL_NAME);
      expect(definition.schema).toMatchObject({ type: 'object' });
      const keywords = schemaKeywords(definition.schema);
      for (const forbidden of forbiddenKeywords) {
        expect(
          keywords,
          `${GROUNDED_RESPONSE_TOOL_NAME}:${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });

  it('publishes strict state-specific selected-action response contracts', () => {
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'factualClaims: { evidenceReferences, disclosedLimitations, hasUnsupportedFactualClaim }',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'For cited evidence with requiredLimitations matching a cited claim kind, add one factualClaims.disclosedLimitations object containing its exact limitationId, coverageStatus unknown_or_unverified, an evidenceSubject copied from that cited evidence, a customerCriterion copied verbatim from the latest customer request, an internal unverifiedAspect, and a natural customerDisclosure sentence in the customer language that states the relevant uncertainty and appears verbatim in customerText',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'Include no disclosedLimitations limitationId that is not required by cited evidence',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'For uncited_subjects_or_aspects_unknown, bind a concrete evidenceSubject from cited evidence and a concrete customerCriterion excerpt verbatim from the latest customer request in structured metadata, name the internal unverifiedAspect, and write customerDisclosure as a natural sentence in the customer language that states the relevant uncertainty without copying internal field names or enum values; never rank or recommend based on an unknown criterion, and never infer an attribute or likelihood from a product or component name, omitted field, or missing option',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'When a required limitation has subjectScope included_modifier_option_name, evidenceSubject must exactly equal the name of a nested included modifier option whose modifierId is present and whose default is true; never use the enclosing product name, a modifier-group name, or an unselected alternative',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'For composite-product advice, a verified criterion-matching option may support the recommendation; choose evidenceSubject for an included component whose criterion-relevant aspect remains unknown, not the option that already satisfies the criterion, and disclose that exact unresolved aspect without claiming it',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'hasUnsupportedFactualClaim is required inside factualClaims and is never a top-level field',
    );
    expect(ordinaryGroundedResponseToolDefinition.description).toContain(
      'Set selectedActionResponse to null',
    );
    for (const definition of [
      ordinaryGroundedResponseToolDefinition,
      selectedActionGroundedResponseToolDefinition,
    ]) {
      expect(definition.description).toContain(
        'For every cited publication evidence entry with privateData true, set privateDataDisclosure to authorized and include exactly one publication_evidence authority with the same evidenceId',
      );
      expect(definition.description).toContain(
        'current_user_message only authorizes private data explicitly supplied in the current user message, never facts learned from publication evidence',
      );
      expect(definition.description).toContain(
        'Do not add extra or duplicate disclosure authorities',
      );
      expect(definition.description).toContain(
        'With no cited private publication evidence, include no publication_evidence authority',
      );
    }
    expect(selectedActionGroundedResponseToolDefinition.description).toContain(
      'Copy responseContract.selectedActionResponse exactly; never derive it from publication evidence',
    );
    const ordinarySchema = schemaRecord(
      ordinaryGroundedResponseToolDefinition.schema,
      'ordinary grounded response schema',
    );
    const ordinaryProperties = schemaRecord(
      ordinarySchema.properties,
      'ordinary grounded response properties',
    );
    expect(
      stringArray(
        ordinarySchema.required,
        'ordinary grounded response required',
      ).sort(),
    ).toEqual(Object.keys(ordinaryProperties).sort());
    const factualClaims = schemaRecord(
      ordinaryProperties.factualClaims,
      'ordinary factual claims',
    );
    const factualClaimProperties = schemaRecord(
      factualClaims.properties,
      'ordinary factual claim properties',
    );
    expect(
      stringArray(
        factualClaims.required,
        'ordinary factual claims required',
      ).sort(),
    ).toEqual(Object.keys(factualClaimProperties).sort());
    const disclosedLimitations = schemaRecord(
      factualClaimProperties.disclosedLimitations,
      'ordinary disclosed limitations',
    );
    const disclosedLimitation = schemaRecord(
      disclosedLimitations.items,
      'ordinary disclosed limitation item',
    );
    const disclosedLimitationProperties = schemaRecord(
      disclosedLimitation.properties,
      'ordinary disclosed limitation properties',
    );
    expect(disclosedLimitation).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(
      stringArray(
        disclosedLimitation.required,
        'ordinary disclosed limitation required',
      ).sort(),
    ).toEqual(Object.keys(disclosedLimitationProperties).sort());
    expect(disclosedLimitationProperties).toMatchObject({
      limitationId: {
        type: 'string',
        enum: ['uncited_subjects_or_aspects_unknown'],
      },
      coverageStatus: {
        type: 'string',
        enum: ['unknown_or_unverified'],
      },
      evidenceSubject: {
        type: 'string',
        minLength: 1,
      },
      customerCriterion: {
        type: 'string',
        minLength: 1,
      },
      unverifiedAspect: {
        type: 'string',
        minLength: 1,
      },
      customerDisclosure: {
        type: 'string',
        minLength: 1,
      },
    });
    expect(ordinaryProperties.selectedActionResponse).toEqual({
      type: 'null',
    });

    const selectedActionSchema = schemaRecord(
      selectedActionGroundedResponseToolDefinition.schema,
      'selected-action grounded response schema',
    );
    const selectedActionProperties = schemaRecord(
      selectedActionSchema.properties,
      'selected-action grounded response properties',
    );
    expect(
      stringArray(
        selectedActionSchema.required,
        'selected-action grounded response required',
      ).sort(),
    ).toEqual(Object.keys(selectedActionProperties).sort());
    const objectBranch = schemaRecord(
      selectedActionProperties.selectedActionResponse,
      'selected action response',
    );
    expect(objectBranch).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(objectBranch).not.toHaveProperty('anyOf');
    const objectProperties = schemaRecord(
      objectBranch.properties,
      'selected action object properties',
    );
    expect(
      stringArray(
        objectBranch.required,
        'selected action object required',
      ).sort(),
    ).toEqual(Object.keys(objectProperties).sort());
  });

  it('dereferences and normalizes provider-incompatible schema keywords', () => {
    const sharedPositiveInteger = z.number().int().positive();
    const schema = z
      .object({
        selection: z.union([
          z
            .object({
              kind: z.literal('first'),
              count: sharedPositiveInteger,
            })
            .strict(),
          z
            .object({
              kind: z.literal('second'),
              count: sharedPositiveInteger,
              ratio: z.number().gt(0).lt(1),
            })
            .strict(),
        ]),
      })
      .strict();

    const portable = providerPortableToolSchema(schema);
    const serialized = JSON.stringify(portable);

    expect(portable).toMatchObject({
      type: 'object',
      properties: {
        selection: {
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
        },
      },
    });
    for (const forbidden of forbiddenKeywords) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it('leaves runtime Zod validation authoritative', () => {
    expect(
      agentToolArgumentSchemas.searchMenu.safeParse({
        scope: 'all',
        query: 'not-null',
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.acquireVoucher.safeParse({
        rewardId: 'reward-discount-10k',
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      groundedResponseSchema.safeParse({
        customerText: 'Unsupported raw response',
      }).success,
    ).toBe(false);
    expect(
      ordinaryGroundedResponseSchema.safeParse({
        customerText: 'Ordinary',
        projectionDigest: 'a'.repeat(64),
        factualClaims: {
          evidenceReferences: [],
          hasUnsupportedFactualClaim: false,
        },
        publicationDeclaration: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'none',
          disclosureAuthorities: [],
          disclosesInternalMetadata: false,
        },
        selectedActionResponse: {},
      }).success,
    ).toBe(false);
    expect(
      selectedActionGroundedResponseSchema.safeParse({
        customerText: 'Selected action',
        projectionDigest: 'a'.repeat(64),
        factualClaims: {
          evidenceReferences: [],
          hasUnsupportedFactualClaim: false,
        },
        publicationDeclaration: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'none',
          disclosureAuthorities: [],
          disclosesInternalMetadata: false,
        },
        selectedActionResponse: null,
      }).success,
    ).toBe(false);
  });

  it('publishes explicit menu intent to providers without making legacy checkpoints unreadable', () => {
    const schema = schemaRecord(
      providerPortableToolSchema(agentToolArgumentSchemas.searchMenu),
      'searchMenu',
    );
    expect(stringArray(schema.required, 'searchMenu.required')).toEqual(
      expect.arrayContaining(['scope', 'query', 'purpose']),
    );
    expect(
      schemaRecord(schema.properties, 'searchMenu.properties'),
    ).toHaveProperty('purpose');
    const legacyMenu = parseAgentToolArguments('searchMenu', {
      scope: 'all',
      query: null,
    });
    expect(legacyMenu.success ? legacyMenu.data : undefined).toEqual({
      scope: 'all',
      query: null,
      purpose: 'browse',
    });
  });

  it('rejects a non-object provider tool schema', () => {
    expect(() => providerPortableToolSchema(z.string())).toThrow(
      'provider_tool_schema_root_must_be_object',
    );
  });

  it('rejects a root anyOf instead of disguising it as an object', () => {
    const schema = z.union([
      z.object({ itemId: z.string() }).strict(),
      z.object({ quantity: z.number().int().positive() }).strict(),
    ]);

    expect(() => providerPortableToolSchema(schema)).toThrow(
      'provider_tool_schema_root_must_be_object',
    );
  });

  it('rejects an intersected object root instead of publishing allOf', () => {
    const schema = z.intersection(
      z.object({ itemId: z.string() }).strict(),
      z.object({ quantity: z.number().int().positive() }).strict(),
    );

    expect(() => providerPortableToolSchema(schema)).toThrow(
      'provider_tool_schema_all_of_unsupported',
    );
  });

  it.each(['oneOf', 'allOf'] as const)(
    'rejects nested %s composition',
    (keyword) => {
      const schema = {
        type: 'object' as const,
        properties: {
          selection: {
            [keyword]: [{ type: 'string' }, { type: 'number' }],
          },
        },
      };

      expect(() => providerPortableToolSchema(schema)).toThrow(
        `provider_tool_schema_${
          keyword === 'oneOf' ? 'one_of' : 'all_of'
        }_unsupported`,
      );
    },
  );

  it('rejects non-string const values instead of widening them to enum', () => {
    const schema = z
      .object({
        confirmed: z.literal(true),
      })
      .strict();

    expect(() => providerPortableToolSchema(schema)).toThrow(
      'provider_tool_schema_non_string_const_unsupported',
    );
  });
});
