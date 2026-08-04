import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js';
import {
  AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST,
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationProblem,
  parseAutomaticRecommendationRequest,
  parseAutomaticRecommendationResponse,
  parseAutomaticScorerRequest,
  parseAutomaticScorerResponse,
} from '../../src/recommendations/contracts/automatic-recommendation.js';

const contractRoot = new URL(
  '../../../../contracts/automatic-recommendations/v1/',
  import.meta.url,
);

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(relativePath, contractRoot), 'utf8'),
  );
}

function isJsonSchema(value: unknown): value is AnySchema & { $id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    '$id' in value &&
    typeof value.$id === 'string'
  );
}

const openApiDocumentSchema = z
  .object({
    openapi: z.literal('3.1.0'),
    paths: z.record(
      z.string(),
      z.record(z.string(), z.object({ operationId: z.string() }).passthrough()),
    ),
  })
  .passthrough();

const contractManifestSchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-contract-manifest-v1'),
    canonicalDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    authorityFiles: z.array(z.string()).min(1),
    examples: z.array(
      z
        .object({
          file: z.string(),
          kind: z.enum([
            'local_favorite_request',
            'for_you_request',
            'modifier_upsell_request',
            'smart_cross_sell_request',
            'recommendation_response',
            'impression_request',
            'outcome_request',
            'problem_details',
            'inspection_response',
            'scorer_request',
            'scorer_response',
          ]),
        })
        .strict(),
    ),
    representations: z
      .object({
        node: z.string(),
        python: z.string(),
        dart: z.string(),
      })
      .strict(),
  })
  .strict();

const negativeExamples = [
  {
    file: 'examples/negative/request-missing-journey-reference.json',
    kind: 'local_favorite_request',
  },
  {
    file: 'examples/negative/outcome-generic-payload.json',
    kind: 'outcome_request',
  },
  {
    file: 'examples/negative/scorer-missing-provenance.json',
    kind: 'scorer_request',
  },
  {
    file: 'examples/negative/problem-status-code-mismatch.json',
    kind: 'problem_details',
  },
] as const;

describe('automatic recommendation wire authority', () => {
  it('publishes only the four decision, two event, and protected inspection operations', async () => {
    const document = openApiDocumentSchema.parse(
      await readJson('openapi.json'),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/admin/recommendations/{recommendationId}/inspection',
      '/v1/recommendations/for-you',
      '/v1/recommendations/local-favorites',
      '/v1/recommendations/modifier-upsells',
      '/v1/recommendations/smart-cross-sells',
      '/v1/recommendations/{recommendationId}/impressions',
      '/v1/recommendations/{recommendationId}/outcomes',
    ]);
    expect(document.paths).not.toHaveProperty('/v1/recommendations/decide');
    expect(
      document.paths['/v1/recommendations/local-favorites'],
    ).toHaveProperty('post.operationId', 'createLocalFavoriteRecommendation');
    expect(
      document.paths['/v1/admin/recommendations/{recommendationId}/inspection'],
    ).toHaveProperty('get.operationId', 'inspectAutomaticRecommendation');
  });

  it('binds the ordered OpenAPI and JSON Schema authority to one digest', async () => {
    const manifest = contractManifestSchema.parse(
      await readJson('contract-manifest.json'),
    );
    expect(manifest.authorityFiles).toEqual([
      'openapi.json',
      'schemas/automatic-recommendation.schema.json',
      'schemas/automatic-scorer.schema.json',
    ]);

    const digest = createHash('sha256');
    for (const relativePath of manifest.authorityFiles) {
      digest.update(relativePath);
      digest.update('\0');
      digest.update(await readFile(new URL(relativePath, contractRoot)));
      digest.update('\0');
    }
    expect(digest.digest('hex')).toBe(manifest.canonicalDigest);
  });

  it('validates every declared cross-language example through the Node boundary', async () => {
    const manifest = contractManifestSchema.parse(
      await readJson('contract-manifest.json'),
    );
    expect(manifest.examples).toHaveLength(16);

    for (const example of manifest.examples) {
      const value = await readJson(example.file);
      switch (example.kind) {
        case 'local_favorite_request':
          parseAutomaticRecommendationRequest('local_favorite', value);
          break;
        case 'for_you_request':
          parseAutomaticRecommendationRequest('for_you', value);
          break;
        case 'modifier_upsell_request':
          parseAutomaticRecommendationRequest('modifier_upsell', value);
          break;
        case 'smart_cross_sell_request':
          parseAutomaticRecommendationRequest('smart_cross_sell', value);
          break;
        case 'recommendation_response':
          parseAutomaticRecommendationResponse(value);
          break;
        case 'impression_request':
          parseAutomaticRecommendationImpression(value);
          break;
        case 'outcome_request':
          parseAutomaticRecommendationOutcome(value);
          break;
        case 'problem_details':
          parseAutomaticRecommendationProblem(value);
          break;
        case 'inspection_response':
          parseAutomaticRecommendationInspection(value);
          break;
        case 'scorer_request':
          parseAutomaticScorerRequest(value);
          break;
        case 'scorer_response':
          parseAutomaticScorerResponse(value);
          break;
      }
    }
  });

  it('rejects every canonical negative fixture through the Node boundary', async () => {
    for (const example of negativeExamples) {
      const value = await readJson(example.file);
      expect(() => {
        switch (example.kind) {
          case 'local_favorite_request':
            parseAutomaticRecommendationRequest('local_favorite', value);
            break;
          case 'outcome_request':
            parseAutomaticRecommendationOutcome(value);
            break;
          case 'scorer_request':
            parseAutomaticScorerRequest(value);
            break;
          case 'problem_details':
            parseAutomaticRecommendationProblem(value);
            break;
        }
      }).toThrow();
    }
  });

  it('resolves local JSON Schema references before validating every fixture', async () => {
    const manifest = contractManifestSchema.parse(
      await readJson('contract-manifest.json'),
    );
    const recommendationSchema = await readJson(
      'schemas/automatic-recommendation.schema.json',
    );
    const scorerSchema = await readJson('schemas/automatic-scorer.schema.json');
    if (!isJsonSchema(recommendationSchema) || !isJsonSchema(scorerSchema)) {
      throw new Error('Canonical JSON Schema must declare an absolute $id');
    }
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      allowUnionTypes: true,
    });
    ajv.addFormat('date-time', {
      type: 'string',
      validate: (value: string) => !Number.isNaN(Date.parse(value)),
    });
    ajv.addFormat('uri', {
      type: 'string',
      validate: (value: string) => URL.canParse(value),
    });
    ajv.addSchema(recommendationSchema);
    ajv.addSchema(scorerSchema);

    const definitionForKind = {
      local_favorite_request: 'LocalFavoriteRequest',
      for_you_request: 'ForYouRequest',
      modifier_upsell_request: 'ModifierUpsellRequest',
      smart_cross_sell_request: 'SmartCrossSellRequest',
      recommendation_response: 'RecommendationResponse',
      impression_request: 'ImpressionRequest',
      outcome_request: 'OutcomeRequest',
      problem_details: 'ProblemDetails',
      inspection_response: 'InspectionResponse',
      scorer_request: 'ScorerRequest',
      scorer_response: 'ScorerResponse',
    } as const;

    for (const example of manifest.examples) {
      const schema = example.kind.startsWith('scorer_')
        ? scorerSchema
        : recommendationSchema;
      const validator = ajv.getSchema(
        `${schema.$id}#/$defs/${definitionForKind[example.kind]}`,
      );
      expect(validator).toBeDefined();
      expect(validator!(await readJson(example.file))).toBe(true);
    }
  });

  it('binds the Node representation to the canonical contract digest', async () => {
    const manifest = contractManifestSchema.parse(
      await readJson('contract-manifest.json'),
    );

    expect(AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST).toBe(
      manifest.canonicalDigest,
    );
    expect(manifest.representations.node).toBe(
      'services/kfc-agent-backend/src/recommendations/contracts/automatic-recommendation.ts',
    );
  });
});
