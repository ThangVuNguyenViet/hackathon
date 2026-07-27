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

  it('is a thin HTTP/D1 bridge and never constructs or invokes a model locally', async () => {
    const source = await readFile(
      new URL('../../scripts/run-live-scenario.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('createLiveScenarioHttpClient');
    expect(source).not.toContain('createConfiguredAgentChatModel');
    expect(source).not.toContain('runAgentTurn');
    expect(source).not.toContain('createMockClients');
    expect(source).not.toContain('MemoryStore');
    expect(source).not.toContain('OPENAI_API_KEY');
  });
});
