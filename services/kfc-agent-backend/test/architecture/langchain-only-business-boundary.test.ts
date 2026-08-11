import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const forbiddenBoundaryDependency =
  /(?:openai-agents|openAi|langgraph|StructuredTool|FunctionTool)/u;

describe('framework-neutral business-pack boundary', () => {
  it('does not expose agent-framework dependencies from shared dispatch modules', async () => {
    const sources = await Promise.all([
      readFile(new URL('../../src/business/agentPack.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../../src/agent/agentTurnRunner.ts', import.meta.url),
        'utf8',
      ),
    ]);

    for (const source of sources) {
      expect(source).not.toMatch(forbiddenBoundaryDependency);
    }
  });
});
