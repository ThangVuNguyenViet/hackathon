import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutomaticScorerUnavailableError,
  createPersistentAutomaticScorerClient,
} from '../../src/recommendations/serving/scorer-client.js';
import type { AutomaticScorerRequest } from '../../src/recommendations/automatic-core/index.js';

const digest = (value: string) => value.repeat(64);
const request: AutomaticScorerRequest = {
  schemaVersion: 'kfc-automatic-scorer-v1',
  requestId: 'request-serving-1',
  recommendationType: 'local_favorite',
  model: {
    bundleId: 'bundle-1',
    bundleDigest: digest('a'),
    modelRevision: 'model-1',
    calibratorRevision: 'calibrator-1',
    featureSchemaDigest: digest('b'),
    thresholdRevision: 'threshold-1',
    composerContractDigest: digest('c'),
    qualificationRunId: 'qualification-1',
    qualificationEvidenceDigest: digest('d'),
  },
  candidates: [],
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

it('reuses one persistent localhost connection and preserves exact provenance', async () => {
  const sockets = new Set<object>();
  const server = createServer((incoming, outgoing) => {
    incoming.socket.on('close', () => sockets.delete(incoming.socket));
    sockets.add(incoming.socket);
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        body === null ||
        typeof body !== 'object' ||
        !('schemaVersion' in body) ||
        !('requestId' in body) ||
        !('model' in body)
      ) {
        throw new Error('invalid test scorer request');
      }
      outgoing.setHeader('content-type', 'application/json');
      outgoing.end(
        JSON.stringify({
          schemaVersion: body.schemaVersion,
          requestId: body.requestId,
          model: body.model,
          scores: [],
        }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('missing port');
  const client = createPersistentAutomaticScorerClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    maxConcurrency: 2,
    timeoutMs: 500,
  });
  closers.push(async () => client.close());

  expect(await client.score(request)).toMatchObject({ model: request.model });
  expect(
    await client.score({ ...request, requestId: 'request-serving-2' }),
  ).toMatchObject({ requestId: 'request-serving-2' });
  expect(sockets.size).toBe(1);
});

it('fails saturated requests immediately without invoking a substitute scorer', async () => {
  const server = createServer((_incoming, _outgoing) => undefined);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(
    () =>
      new Promise(
        (resolve) =>
          server.closeAllConnections() ?? server.close(() => resolve()),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('missing port');
  const client = createPersistentAutomaticScorerClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    maxConcurrency: 1,
    timeoutMs: 50,
  });
  closers.push(async () => client.close());
  const first = client.score(request).catch((error: unknown) => error);
  await expect(
    client.score({ ...request, requestId: 'request-serving-2' }),
  ).rejects.toMatchObject({ code: 'scorer_saturated', retryable: true });
  await expect(first).resolves.toBeInstanceOf(AutomaticScorerUnavailableError);
});

it('rejects zero, fractional, and non-finite timeout or response limits', () => {
  for (const timeoutMs of [0, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() =>
      createPersistentAutomaticScorerClient({
        baseUrl: 'http://127.0.0.1:8081',
        maxConcurrency: 1,
        timeoutMs,
      }),
    ).toThrow('timeoutMs');
  }
  expect(() =>
    createPersistentAutomaticScorerClient({
      baseUrl: 'http://127.0.0.1:8081',
      maxConcurrency: 1,
      timeoutMs: 50,
      maxResponseBytes: 0,
    }),
  ).toThrow('maxResponseBytes');
});
