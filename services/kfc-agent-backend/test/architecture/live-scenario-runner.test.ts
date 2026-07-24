import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('live scenario runner', () => {
  it('starts the TypeScript runner without shell-sourcing environment files', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['scenario:live']).toBe(
      'tsx scripts/run-live-scenario.ts',
    );
  });
});
