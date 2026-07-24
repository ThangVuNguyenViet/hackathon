import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

const removedRuntimeControls = [
  'KFC_COMMERCE_MODE',
  'KFC_COMMERCE_ENVIRONMENT',
  'KFC_MENU_API_URL',
  'CATALOG_TTL_SECONDS',
  'KFC_COMMERCE_GATEWAY_BASE_URL',
  'KFC_COMMERCE_GATEWAY_TOKEN',
  'KFC_POS_MODE',
  'KFC_POS_BASE_URL',
  'KFC_POS_TOKEN',
] as const;

describe('fixed demo commerce runtime', () => {
  it('ignores removed production-like controls and always reports fixture commerce', () => {
    const env = loadEnv({
      KFC_COMMERCE_MODE: 'gateway',
      KFC_COMMERCE_ENVIRONMENT: 'production',
      KFC_MENU_API_URL: 'https://production.invalid/menu',
      CATALOG_TTL_SECONDS: '30',
      KFC_COMMERCE_GATEWAY_BASE_URL: 'https://production.invalid',
      KFC_COMMERCE_GATEWAY_TOKEN: 'should-not-be-consumed',
      KFC_POS_MODE: 'http',
      KFC_POS_BASE_URL: 'https://production.invalid/pos',
      KFC_POS_TOKEN: 'should-not-be-consumed',
    });

    for (const control of removedRuntimeControls) {
      expect(env).not.toHaveProperty(control);
    }

    expect(buildServerOptionsFromEnv(env).readiness?.commerce).toEqual({
      mode: 'fixture',
    });
  });

  it('loads only the repository env file during local Worker development', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.dev).toBe(
      'wrangler dev --env-file ../../.env',
    );
    expect(packageJson.scripts.dev).not.toContain(
      'CLOUDFLARE_INCLUDE_PROCESS_ENV',
    );
  });
});
