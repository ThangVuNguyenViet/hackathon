import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('PVCFC agent import boundary', () => {
  it('uses LangChain and PVCFC-owned modules without direct SDK, LangGraph, or KFC runtime imports', async () => {
    const sources = await Promise.all(
      ['pack.ts', 'tools.ts'].map((file) =>
        readFile(
          new URL(`../../src/businesses/pvcfc/${file}`, import.meta.url),
          'utf8',
        ),
      ),
    );
    const source = sources.join('\n');

    expect(source).toContain("from 'langchain'");
    expect(source).not.toMatch(/from\s+['"]openai['"]/u);
    expect(source).not.toMatch(/@langchain\/langgraph/u);
    expect(source).not.toMatch(/(?:^|\/)kfc[A-Z/]/u);
    expect(source).not.toMatch(/OpenAiResponsesExecutor|sdkSessionMutation/u);
  });
});
