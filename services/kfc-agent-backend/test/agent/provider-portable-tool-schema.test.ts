import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { providerPortableToolSchema } from '../../src/agent/providerPortableToolSchema.js';

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
});
