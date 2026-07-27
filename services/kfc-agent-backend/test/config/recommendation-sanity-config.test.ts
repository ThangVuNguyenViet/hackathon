import type { ClientConfig, SanityClient } from '@sanity/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import policySnapshot from '../../fixtures/recommendations/sanity-policy-snapshot-v1.json' with { type: 'json' };
import { buildServer } from '../../src/api/server.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';
import { checkWorkerReadiness } from '../../src/workerReadiness.js';

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function publishedDocuments() {
  return policySnapshot.policies.map((policy, index) => ({
    ...policy,
    _id: `recommendationPolicy.${policy.policyId}`,
    _rev: `published-revision-${index + 1}`,
    _updatedAt: `2026-07-27T09:00:0${index}Z`,
  }));
}

describe('Sanity merchandising runtime configuration', () => {
  it('uses public published reads with retries disabled and reports sanitized provenance', async () => {
    let clientConfig: ClientConfig | undefined;
    let fetchOptions: unknown;
    const client = {
      fetch: async (_query: string, _params: unknown, options: unknown) => {
        fetchOptions = options;
        return publishedDocuments();
      },
    } as unknown as SanityClient;
    const env = loadEnv({
      SANITY_PROJECT_ID: 'public-project-id',
      SANITY_DATASET: 'production',
      SANITY_API_VERSION: '2025-02-19',
    });
    const options = buildServerOptionsFromEnv(env, {
      sanityClientFactory: (config) => {
        clientConfig = config;
        return client;
      },
    });

    expect(options.recommendations).toBeDefined();
    expect(clientConfig).toMatchObject({
      projectId: 'public-project-id',
      dataset: 'production',
      apiVersion: '2025-02-19',
      useCdn: true,
      perspective: 'published',
      maxRetries: 0,
    });
    expect(clientConfig?.token).toBeUndefined();
    expect(fetchOptions).toBeUndefined();

    const server = buildServer(options);
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: '/ready?deep=1',
    });
    expect(fetchOptions).toEqual({ perspective: 'published' });
    const body = response.json();
    expect(body.checks.recommendationSanity).toMatchObject({
      ok: true,
      required: true,
      configured: true,
      authority: 'sanity',
      reachable: true,
      policyCount: 5,
    });
    expect(body.proof.versions.recommendationSanity).toMatchObject({
      authority: 'sanity',
      configured: true,
      reachable: true,
      snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const publishedReadiness = JSON.stringify(body.checks.recommendationSanity);
    expect(publishedReadiness).not.toContain('public-project-id');
    expect(publishedReadiness).not.toContain('production');
    expect(publishedReadiness).not.toContain('2025-02-19');
  });

  it('fails closed when configuration is absent or incomplete', async () => {
    const absent = buildServerOptionsFromEnv(loadEnv({}));
    const incomplete = buildServerOptionsFromEnv(
      loadEnv({ SANITY_PROJECT_ID: 'project-only' }),
    );

    expect(absent.recommendations).toBeUndefined();
    expect(incomplete.recommendations).toBeUndefined();
    await expect(absent.readiness?.recommendationSanity?.()).resolves.toEqual({
      ok: false,
      required: true,
      configured: false,
      authority: 'sanity',
      message: 'Sanity merchandising authority is not configured',
    });
    await expect(
      incomplete.readiness?.recommendationSanity?.(),
    ).resolves.toEqual({
      ok: false,
      required: true,
      configured: false,
      authority: 'sanity',
      message: 'Sanity merchandising configuration is incomplete',
    });
  });

  it('does not leak read tokens or upstream errors from unreachable readiness', async () => {
    const secret = 'secret-read-token';
    const upstream = 'https://secret-project.api.sanity.io/query failed';
    let clientConfig: ClientConfig | undefined;
    const options = buildServerOptionsFromEnv(
      loadEnv({
        SANITY_PROJECT_ID: 'private-project-id',
        SANITY_DATASET: 'production',
        SANITY_API_VERSION: '2025-02-19',
        SANITY_READ_TOKEN: secret,
      }),
      {
        sanityClientFactory: (config) => {
          clientConfig = config;
          return {
            fetch: async () => {
              throw new Error(upstream);
            },
          } as unknown as SanityClient;
        },
      },
    );

    expect(clientConfig).toMatchObject({
      token: secret,
      useCdn: false,
      maxRetries: 0,
    });
    const readiness = await options.readiness?.recommendationSanity?.();
    const serialized = JSON.stringify(readiness);
    expect(readiness).toEqual({
      ok: false,
      required: true,
      configured: true,
      authority: 'sanity',
      reachable: false,
      message: 'Sanity merchandising authority is unreachable or invalid',
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(upstream);
  });

  it('gates direct Worker readiness on the same published Sanity authority', async () => {
    const client = {
      fetch: async () => publishedDocuments(),
    } as unknown as SanityClient;
    const readiness = await checkWorkerReadiness(
      {
        DB: {
          prepare: () => ({ first: async () => ({ ok: 1 }) }),
        },
        SANITY_PROJECT_ID: 'worker-project-id',
        SANITY_DATASET: 'production',
        SANITY_API_VERSION: '2025-02-19',
        SANITY_CLIENT: client,
      } as never,
      true,
      { configured: false, configurationError: true },
    );

    expect(readiness.checks.recommendationSanity).toMatchObject({
      ok: true,
      required: true,
      configured: true,
      authority: 'sanity',
      reachable: true,
      policyCount: 5,
    });
    expect(readiness.proof?.versions).toMatchObject({
      recommendationSanity: {
        authority: 'sanity',
        configured: true,
        reachable: true,
        snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    const serialized = JSON.stringify(readiness.checks.recommendationSanity);
    expect(serialized).not.toContain('worker-project-id');
    expect(serialized).not.toContain('production');
    expect(serialized).not.toContain('2025-02-19');
  });
});
