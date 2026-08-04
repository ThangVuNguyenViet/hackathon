import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
