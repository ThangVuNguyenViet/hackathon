import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { directAgentSdkBoundaryViolations } from '../../scripts/check-direct-agent-sdk-boundaries.mjs';

describe('direct Agents SDK architecture boundary', () => {
  it('accepts the production direct agent runtime', async () => {
    const source = await readFile(
      new URL('../../src/agent/openAiKfcAgent.ts', import.meta.url),
      'utf8',
    );

    expect(directAgentSdkBoundaryViolations(source)).toEqual([]);
  });

  it.each([
    ['raw Responses loop', 'client.responses.create({})'],
    ['manual function output', "type: 'function_call_output'"],
    ['forced semantic tool choice', "tool_choice: 'required'"],
    ['custom generic loop', 'runResponsesToolLoop(input)'],
  ])('rejects %s orchestration', (_label, source) => {
    expect(directAgentSdkBoundaryViolations(source)).not.toEqual([]);
  });
});
