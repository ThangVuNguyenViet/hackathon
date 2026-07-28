import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(process.cwd(), '../..');
const workerScript = resolve(
  rootDir,
  'scripts/deploy-backend-cloudflare-worker.sh',
);
const deploymentRunbook = resolve(
  rootDir,
  'docs/deployment/hackathon-free-deploy.md',
);
const candidateIds = [
  'openai-gpt-4.1-mini',
  'deepseek-v4-flash',
  'qwen3.7-max',
  'minimax-m3',
  'google-gemini-3.1-flash-lite',
] as const;

function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.KFC_AGENT_PROVIDER;
  delete env.KFC_AGENT_MODEL;
  delete env.KFC_MONITOR_PROVIDER;
  delete env.KFC_MONITOR_MODEL;
  return { ...env, ...extra };
}

function workerEnvFile(lines: readonly string[]) {
  const directory = mkdtempSync(resolve(tmpdir(), 'kfc-worker-preflight-'));
  const path = resolve(directory, '.env');
  writeFileSync(
    path,
    [
      'LANGSMITH_API_KEY=test-langsmith',
      'LANGSMITH_PROJECT=test-project',
      'LANGSMITH_ENDPOINT=https://example.test',
      'META_APP_SECRET=test-meta',
      'KFC_RECOMMENDATION_SHADOW_URL=https://tunnel.example.test',
      `KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=${'a'.repeat(40)}`,
      'KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE=local_docker_cloudflare_tunnel',
      'KFC_RECOMMENDATION_OUTPUT_MODE=baseline',
      'SANITY_PROJECT_ID=abc123xy',
      'SANITY_DATASET=production',
      'SANITY_API_VERSION=2026-07-27',
      ...lines,
    ].join('\n'),
  );
  return path;
}

function runWorkerPreflight(lines: readonly string[]) {
  return spawnSync('bash', [workerScript], {
    encoding: 'utf8',
    env: cleanEnv({
      ALLOW_NON_MAIN_DEPLOY: 'true',
      KFC_DEPLOY_PREFLIGHT_ONLY: 'true',
      ENV_FILE: workerEnvFile(lines),
    }),
  });
}

describe('deployment model candidate configuration', () => {
  it('documents Worker-only backend deployment without stale Cloud Run references', () => {
    const source = readFileSync(deploymentRunbook, 'utf8');

    expect(source).toContain('./scripts/deploy-backend-cloudflare-worker.sh');
    expect(source).not.toContain('deploy-backend-cloud-run.sh');
    expect(source).not.toContain('Google Cloud Run');
  });

  it('keeps the Worker deployment aligned to the fixed candidate roster', () => {
    const source = readFileSync(workerScript, 'utf8');
    for (const candidateId of candidateIds) {
      expect(source).toContain(candidateId);
    }
    expect(source).toContain(
      'KFC_AGENT_CANDIDATE="${KFC_AGENT_CANDIDATE:-openai-gpt-4.1-mini}"',
    );
    expect(source).toContain('KFC_MONITOR_CANDIDATE');
  });

  it('passes candidate variables and OpenCode credentials without stale runtime variables', () => {
    const workerSource = readFileSync(workerScript, 'utf8');

    expect(workerSource).toContain('--var "KFC_AGENT_CANDIDATE:');
    expect(workerSource).toContain('versions secret put OPENCODE_API_KEY');
    expect(workerSource).not.toContain('--var "KFC_AGENT_PROVIDER:');
    expect(workerSource).not.toContain('--var "KFC_AGENT_MODEL:');
  });

  it('has no deploy-time commerce, environment, or POS mode controls', () => {
    const workerSource = readFileSync(workerScript, 'utf8');

    for (const removedControl of [
      'KFC_COMMERCE_MODE',
      'KFC_COMMERCE_ENVIRONMENT',
      'KFC_MENU_API_URL',
      'KFC_COMMERCE_GATEWAY_BASE_URL',
      'KFC_COMMERCE_GATEWAY_TOKEN',
      'KFC_POS_MODE',
      'KFC_POS_BASE_URL',
      'KFC_POS_TOKEN',
    ]) {
      expect(workerSource).not.toContain(removedControl);
    }
  });

  it('accepts OpenCode candidates during non-deploying preflight without logging keys', () => {
    const secret = 'test-opencode-secret-do-not-log';
    const worker = runWorkerPreflight([
      'KFC_AGENT_CANDIDATE=minimax-m3',
      `OPENCODE_API_KEY=${secret}`,
    ]);

    expect(worker.status, worker.stderr).toBe(0);
    expect(`${worker.stdout}${worker.stderr}`).not.toContain(secret);
  });

  it('rejects an acceptance deployment without complete public recommendation bindings', () => {
    const worker = runWorkerPreflight([
      'OPENAI_API_KEY=test-openai',
      'KFC_RECOMMENDATION_SHADOW_URL=',
      'KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=',
      'SANITY_PROJECT_ID=',
      'SANITY_DATASET=',
      'SANITY_API_VERSION=',
    ]);

    expect(worker.status).toBe(64);
    expect(worker.stderr).toContain('KFC_RECOMMENDATION_SHADOW_URL');
  });

  it('accepts complete public recommendation bindings without logging credentials', () => {
    const secret = 'test-sanity-read-secret-do-not-log';
    const worker = runWorkerPreflight([
      'OPENAI_API_KEY=test-openai',
      'KFC_RECOMMENDATION_SHADOW_URL=https://tunnel.example.test',
      `KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=${'a'.repeat(40)}`,
      'KFC_RECOMMENDATION_OUTPUT_MODE=baseline',
      'SANITY_PROJECT_ID=abc123xy',
      'SANITY_DATASET=production',
      'SANITY_API_VERSION=2026-07-27',
      `SANITY_READ_TOKEN=${secret}`,
    ]);

    expect(worker.status, worker.stderr).toBe(0);
    expect(`${worker.stdout}${worker.stderr}`).not.toContain(secret);
  });

  it('rejects a recommendation runtime profile outside the approved free path', () => {
    const worker = runWorkerPreflight([
      'OPENAI_API_KEY=test-openai',
      'KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE=hugging_face_space',
    ]);

    expect(worker.status).toBe(64);
    expect(worker.stderr).toContain(
      'KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE',
    );
  });

  it('rejects unknown candidates before deployment', () => {
    const worker = runWorkerPreflight([
      'KFC_AGENT_CANDIDATE=unknown-candidate',
    ]);

    expect(worker.status).toBe(64);
  });

  it('rejects stale provider and model variables before deployment', () => {
    const worker = runWorkerPreflight([
      'KFC_AGENT_PROVIDER=openai',
      'KFC_AGENT_MODEL=gpt-4.1-mini',
    ]);

    expect(worker.status).toBe(64);
    expect(worker.stderr).toContain('no longer supported');
  });
});
