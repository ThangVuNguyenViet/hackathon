import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps every generated scenario document byte-aligned with canonical JSON', () => {
  expect(() => execFileSync(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('scripts/generate-scenario-docs.ts'),
      '--check',
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  )).not.toThrow();
});
