import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { buildServer } from '../../src/api/server.js';
import { loadEnv } from '../../src/config/env.js';
import { recommendationShadowReadiness } from '../../src/config/recommendationShadow.js';
import { checkWorkerReadiness } from '../../src/workerReadiness.js';

describe('recommendation shadow configuration', () => {
  it('defaults to non-authoritative baseline mode with no configured scorer', () => {
    const env = loadEnv({});

    expect(env).toMatchObject({
      KFC_RECOMMENDATION_SHADOW_URL: '',
      KFC_RECOMMENDATION_SHADOW_MODEL_REVISION: '',
      KFC_RECOMMENDATION_OUTPUT_MODE: 'baseline',
    });
    expect(
      buildServerOptionsFromEnv(env).readiness?.recommendationShadow,
    ).toEqual({
      ok: true,
      required: false,
      configured: false,
      outputMode: 'baseline',
      message: 'Recommendation shadow scoring is not configured',
    });
  });

  it('pins learned technical evidence to server configuration without publishing exact provenance', async () => {
    const env = loadEnv({
      KFC_RECOMMENDATION_SHADOW_URL: 'https://shadow.example',
      KFC_RECOMMENDATION_SHADOW_MODEL_REVISION: 'hf-revision-0123456789abcdef',
      KFC_RECOMMENDATION_OUTPUT_MODE: 'learned_technical',
    });
    const readiness =
      buildServerOptionsFromEnv(env).readiness?.recommendationShadow;

    expect(readiness).toEqual({
      ok: true,
      required: false,
      configured: true,
      outputMode: 'learned_technical',
    });
    expect(readiness).not.toHaveProperty('url');
    expect(readiness).not.toHaveProperty('modelRevision');

    const server = buildServer(buildServerOptionsFromEnv(env));
    try {
      const response = await server.inject({ method: 'GET', url: '/ready' });
      expect(response.json().checks.recommendationShadow).toEqual(readiness);
      expect(response.body).not.toContain('hf-revision-0123456789abcdef');
    } finally {
      await server.close();
    }
    expect(() =>
      loadEnv({ KFC_RECOMMENDATION_OUTPUT_MODE: 'customer_selected' }),
    ).toThrow();
    expect(() =>
      loadEnv({ KFC_RECOMMENDATION_SHADOW_URL: 'not-a-url' }),
    ).toThrow();
  });

  it('reports partial optional configuration without making readiness authoritative', () => {
    expect(
      recommendationShadowReadiness({
        shadowUrl: 'https://shadow.example',
        modelRevision: '',
        outputMode: 'baseline',
      }),
    ).toEqual({
      ok: true,
      required: false,
      configured: false,
      outputMode: 'baseline',
      message:
        'KFC_RECOMMENDATION_SHADOW_URL and KFC_RECOMMENDATION_SHADOW_MODEL_REVISION must be configured together',
    });
  });

  it('declares local and Worker bindings without committing a shadow endpoint or revision', async () => {
    const [example, wrangler] = await Promise.all([
      readFile(resolve(process.cwd(), '.env.example'), 'utf8'),
      readFile(resolve(process.cwd(), 'wrangler.toml'), 'utf8'),
    ]);

    expect(example).toContain('KFC_RECOMMENDATION_SHADOW_URL=');
    expect(example).toContain('KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=');
    expect(example).toContain('KFC_RECOMMENDATION_OUTPUT_MODE=baseline');
    expect(wrangler).toContain('KFC_RECOMMENDATION_SHADOW_URL = ""');
    expect(wrangler).toContain('KFC_RECOMMENDATION_SHADOW_MODEL_REVISION = ""');
    expect(wrangler).toContain('KFC_RECOMMENDATION_OUTPUT_MODE = "baseline"');
  });

  it('exposes only non-sensitive shadow status on the direct Worker readiness path', async () => {
    const readiness = await checkWorkerReadiness(
      {
        DB: {
          prepare: () => ({ first: async () => ({ ok: 1 }) }),
        },
        KFC_RECOMMENDATION_SHADOW_URL: 'https://shadow.example',
        KFC_RECOMMENDATION_SHADOW_MODEL_REVISION:
          'hf-revision-0123456789abcdef',
        KFC_RECOMMENDATION_OUTPUT_MODE: 'learned_technical',
      } as never,
      false,
      { configured: false, configurationError: true },
    );

    expect(readiness.checks.recommendationShadow).toEqual({
      ok: true,
      required: false,
      configured: true,
      outputMode: 'learned_technical',
    });
    expect(readiness.checks.recommendationShadow).not.toHaveProperty('url');
    expect(readiness.checks.recommendationShadow).not.toHaveProperty(
      'modelRevision',
    );
  });
});
