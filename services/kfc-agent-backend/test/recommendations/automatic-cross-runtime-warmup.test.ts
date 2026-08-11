import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  type AutomaticScorerRequest,
} from '../../src/recommendations/automatic-core/index.js';
import { AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST } from '../../src/recommendations/contracts/automatic-recommendation.js';
import { parseAutomaticScorerRequest } from '../../src/recommendations/contracts/automatic-scorer.js';
import { createPersistentAutomaticScorerClient } from '../../src/recommendations/serving/scorer-client.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((entry) => entry())));

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

it('warms readiness through the canonical Node to Python scoring boundary', async () => {
  const scorerRoot = resolve(process.cwd(), '../kfc-recommendation-scorer');
  const bundleRoot = await mkdtemp(join(tmpdir(), 'kfc-qualified-warmup-'));
  cleanup.push(() => rm(bundleRoot, { recursive: true, force: true }));
  const composerDigest = 'c'.repeat(64);
  const build = spawnSync(
    'python3',
    [
      '-c',
      [
        'import json,sys',
        'from pathlib import Path',
        'from qualified_bundle_fixture import build_test_qualified_bundle',
        'print(json.dumps(build_test_qualified_bundle(Path(sys.argv[1]), contract_digest=sys.argv[2], feature_digest=sys.argv[3], composer_digest=sys.argv[4])))',
      ].join(';'),
      bundleRoot,
      AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST,
      AUTOMATIC_FEATURE_SCHEMA_DIGEST,
      composerDigest,
    ],
    {
      cwd: scorerRoot,
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: 'src:tests' },
    },
  );
  expect(build.status, build.stderr).toBe(0);
  const manifest = z
    .object({
      bundleDigest: z.string(),
      configurationDigest: z.string(),
      qualificationEvidenceDigest: z.string(),
      payloadDigests: z.record(z.string()),
    })
    .parse(JSON.parse(build.stdout));
  const payloads = manifest.payloadDigests;
  const prefix = 'models/local_favorite';
  const example = parseAutomaticScorerRequest(
    JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          '../../contracts/automatic-recommendations/v1/examples/scorer-request.json',
        ),
        'utf8',
      ),
    ),
  );
  const warmup: AutomaticScorerRequest = {
    ...example,
    requestId: 'readiness-warmup-1',
    model: {
      bundleId: `bundle:${manifest.bundleDigest}`,
      bundleDigest: manifest.bundleDigest,
      modelRevision: digest([
        payloads[`${prefix}/selection/model.json`],
        payloads[`${prefix}/joint/model.json`],
      ]),
      calibratorRevision: digest([
        payloads[`${prefix}/selection-calibrator.json`],
        payloads[`${prefix}/joint-calibrator.json`],
      ]),
      featureSchemaDigest: AUTOMATIC_FEATURE_SCHEMA_DIGEST,
      thresholdRevision: payloads[`${prefix}/abstention-threshold.json`]!,
      composerContractDigest: composerDigest,
      qualificationRunId: `qualification:${manifest.configurationDigest}`,
      qualificationEvidenceDigest: manifest.qualificationEvidenceDigest,
    },
  };
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (address === null || typeof address === 'string')
    throw new Error('port unavailable');
  const port = address.port;
  await new Promise<void>((resolveClose) =>
    reservation.close(() => resolveClose()),
  );
  const python = spawn('python3', ['-m', 'kfc_recommendation_scorer'], {
    cwd: scorerRoot,
    env: {
      ...process.env,
      PYTHONPATH: 'src',
      QUALIFIED_BUNDLE_PATH: bundleRoot,
      QUALIFIED_BUNDLE_DIGEST: manifest.bundleDigest,
      AUTOMATIC_CONTRACT_DIGEST: AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST,
      AUTOMATIC_FEATURE_DIGEST: AUTOMATIC_FEATURE_SCHEMA_DIGEST,
      AUTOMATIC_COMPOSER_DIGEST: composerDigest,
      SCORER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanup.push(async () => {
    if (python.exitCode === null) {
      python.kill('SIGTERM');
      await once(python, 'exit');
    }
  });
  const client = createPersistentAutomaticScorerClient({
    baseUrl: `http://127.0.0.1:${port}`,
    maxConcurrency: 2,
    timeoutMs: 2_000,
  });
  cleanup.push(async () => client.close());
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    ready = await client.warmup(warmup);
    if (!ready) await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  expect(ready).toBe(true);
  expect(
    await client.warmup({
      ...warmup,
      model: { ...warmup.model, bundleDigest: 'f'.repeat(64) },
    }),
  ).toBe(false);
});
