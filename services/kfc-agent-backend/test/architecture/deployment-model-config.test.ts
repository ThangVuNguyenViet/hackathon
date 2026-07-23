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
const cloudRunScript = resolve(rootDir, 'scripts/deploy-backend-cloud-run.sh');
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

function runCloudRunPreflight(extra: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [cloudRunScript], {
    encoding: 'utf8',
    env: cleanEnv({
      GCP_PROJECT_ID: 'test-project',
      META_PAGE_ID: 'test-page',
      KFC_DEPLOY_PREFLIGHT_ONLY: 'true',
      ...extra,
    }),
  });
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
      'KFC_COMMERCE_MODE=fixture',
      'KFC_COMMERCE_ENVIRONMENT=sandbox',
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
  it('keeps both deployment scripts aligned to the fixed candidate roster', () => {
    for (const scriptPath of [workerScript, cloudRunScript]) {
      const source = readFileSync(scriptPath, 'utf8');
      for (const candidateId of candidateIds) {
        expect(source).toContain(candidateId);
      }
      expect(source).toContain(
        'KFC_AGENT_CANDIDATE="${KFC_AGENT_CANDIDATE:-openai-gpt-4.1-mini}"',
      );
      expect(source).toContain('KFC_MONITOR_CANDIDATE');
    }
  });

  it('passes candidate variables and OpenCode credentials without stale runtime variables', () => {
    const workerSource = readFileSync(workerScript, 'utf8');
    const cloudRunSource = readFileSync(cloudRunScript, 'utf8');

    expect(workerSource).toContain('--var "KFC_AGENT_CANDIDATE:');
    expect(workerSource).toContain(
      'versions secret put OPENCODE_API_KEY',
    );
    expect(cloudRunSource).toContain(
      '"KFC_AGENT_CANDIDATE=$KFC_AGENT_CANDIDATE"',
    );
    expect(cloudRunSource).toContain(
      '"OPENCODE_API_KEY=OPENCODE_API_KEY:latest"',
    );
    expect(workerSource).not.toContain('--var "KFC_AGENT_PROVIDER:');
    expect(workerSource).not.toContain('--var "KFC_AGENT_MODEL:');
    expect(cloudRunSource).not.toContain(
      '"KFC_AGENT_PROVIDER=$KFC_AGENT_PROVIDER"',
    );
    expect(cloudRunSource).not.toContain(
      '"KFC_AGENT_MODEL=$KFC_AGENT_MODEL"',
    );
  });

  it('accepts OpenCode candidates during non-deploying preflight without logging keys', () => {
    const secret = 'test-opencode-secret-do-not-log';
    const worker = runWorkerPreflight([
      'KFC_AGENT_CANDIDATE=minimax-m3',
      `OPENCODE_API_KEY=${secret}`,
    ]);
    const cloudRun = runCloudRunPreflight({
      KFC_AGENT_CANDIDATE: 'minimax-m3',
    });

    expect(worker.status, worker.stderr).toBe(0);
    expect(cloudRun.status, cloudRun.stderr).toBe(0);
    expect(`${worker.stdout}${worker.stderr}`).not.toContain(secret);
  });

  it('rejects unknown candidates before deployment', () => {
    const worker = runWorkerPreflight([
      'KFC_AGENT_CANDIDATE=unknown-candidate',
    ]);
    const cloudRun = runCloudRunPreflight({
      KFC_AGENT_CANDIDATE: 'unknown-candidate',
    });

    expect(worker.status).toBe(64);
    expect(cloudRun.status).toBe(64);
  });

  it('rejects stale provider and model variables before deployment', () => {
    const worker = runWorkerPreflight([
      'KFC_AGENT_PROVIDER=openai',
      'KFC_AGENT_MODEL=gpt-4.1-mini',
    ]);
    const cloudRun = runCloudRunPreflight({
      KFC_AGENT_PROVIDER: 'openai',
      KFC_AGENT_MODEL: 'gpt-4.1-mini',
    });

    expect(worker.status).toBe(64);
    expect(cloudRun.status).toBe(64);
    expect(worker.stderr).toContain('no longer supported');
    expect(cloudRun.stderr).toContain('no longer supported');
  });
});
