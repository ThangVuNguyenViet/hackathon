import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { providerPortableToolSchema } from '../../src/agent/providerPortableToolSchema.js';
import {
  agentToolArgumentSchemas,
  toolArgumentSchemas,
} from '../../src/ordering/toolCatalog.js';
import { TOOL_NAMES } from '../../src/ordering/types.js';

describe('providerPortableToolSchema', () => {
  it('normalizes a Zod object schema into the provider-safe JSON schema subset', () => {
    expect(
      providerPortableToolSchema(
        z.object({
          code: z.literal('KFC50'),
          quantity: z.number().int().gt(0),
        }),
      ),
    ).toEqual({
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['KFC50'] },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['code', 'quantity'],
      additionalProperties: false,
    });
  });

  it('exposes structured menu discovery without provider-specific schema branches', () => {
    const schema = providerPortableToolSchema(
      agentToolArgumentSchemas.searchMenu,
    ) as Record<string, unknown>;

    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['search', 'full'] },
        queries: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        category: {},
        minPriceVnd: {},
        maxPriceVnd: {},
        maxPriceExclusiveVnd: {},
        partySize: {},
        modifierQueries: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
      },
      required: [
        'mode',
        'queries',
        'category',
        'minPriceVnd',
        'maxPriceVnd',
        'maxPriceExclusiveVnd',
        'partySize',
        'modifierQueries',
      ],
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty('oneOf');
    expect(schema).not.toHaveProperty('allOf');
  });

  it('exposes only semantic inputs for the three strict recommendation tools', () => {
    expect(
      agentToolArgumentSchemas.recommendStarter.parse({
        requestKind: 'proactive',
      }),
    ).toEqual({ requestKind: 'proactive' });
    expect(
      agentToolArgumentSchemas.recommendModifierUpsell.parse({
        requestKind: 'customer_requested',
        parentCartLineId: 'cart-line-001',
      }),
    ).toEqual({
      requestKind: 'customer_requested',
      parentCartLineId: 'cart-line-001',
    });
    expect(
      agentToolArgumentSchemas.recommendSmartCrossSell.parse({
        requestKind: 'proactive',
      }),
    ).toEqual({ requestKind: 'proactive' });

    for (const name of [
      'recommendStarter',
      'recommendModifierUpsell',
      'recommendSmartCrossSell',
    ] as const) {
      expect(
        agentToolArgumentSchemas[name].safeParse({
          requestKind: 'proactive',
          sessionId: 'model-authored-session',
          cartRevision: 'model-authored-cart',
        }).success,
      ).toBe(false);
      expect(
        providerPortableToolSchema(agentToolArgumentSchemas[name]),
      ).toEqual(providerPortableToolSchema(toolArgumentSchemas[name]));
    }

    expect(TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'recommendStarter',
        'recommendModifierUpsell',
        'recommendSmartCrossSell',
      ]),
    );
  });
});
