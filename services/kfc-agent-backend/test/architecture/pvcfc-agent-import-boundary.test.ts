import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
    (match) => match[1]!,
  );
}

describe('PVCFC agent import boundary', () => {
  it('depends on the neutral Responses executor and SDK tool contracts only', async () => {
    const [packSource, toolsSource] = await Promise.all([
      readFile(
        new URL('../../src/businesses/pvcfc/pack.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../../src/businesses/pvcfc/tools.ts', import.meta.url),
        'utf8',
      ),
    ]);
    const agentImports = [
      ...moduleSpecifiers(packSource),
      ...moduleSpecifiers(toolsSource),
    ].filter((specifier) => specifier.includes('/agent/'));

    expect(agentImports).toContain('../../agent/openAiResponsesExecutor.js');
    expect(agentImports).toContain('../../agent/openAiSdkTool.js');
    expect(agentImports).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/(?:^|\/)kfc/iu)]),
    );
  });
});
