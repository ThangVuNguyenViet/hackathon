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

  it('never waits for deferred trace work', async () => {
    const source = await readFile(
      new URL('../../scripts/run-live-scenario.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain(
      'await Promise.allSettled(deferredTraceTasks.map((task) => task()))',
    );
    expect(source).not.toContain('await deferredTraceTasks.settle()');
    expect(source).toContain('deferTrace: runDetachedWork');
  });
});
