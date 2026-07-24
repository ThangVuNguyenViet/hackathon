import { describe, expect, it, vi } from 'vitest';
import {
  runLiveScenarioCommandStream,
  type LiveScenarioProtocolSession,
} from '../../src/liveEvidence/liveScenarioProtocol.js';

describe('live scenario JSONL protocol', () => {
  it('accepts improvised messages one at a time until an explicit finish', async () => {
    const session: LiveScenarioProtocolSession = {
      submitUserMessage: vi
        .fn()
        .mockResolvedValueOnce({ responseText: 'First response' })
        .mockResolvedValueOnce({ responseText: 'Second response' }),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    const output: string[] = [];

    await runLiveScenarioCommandStream({
      session,
      lines: from([
        JSON.stringify({ type: 'user', text: 'Improvised first turn' }),
        JSON.stringify({ type: 'user', text: 'Follow the flow' }),
        JSON.stringify({ type: 'finish', note: 'Goal explored' }),
      ]),
      writeLine(line) {
        output.push(line);
      },
    });

    expect(session.submitUserMessage).toHaveBeenNthCalledWith(
      1,
      'Improvised first turn',
    );
    expect(session.submitUserMessage).toHaveBeenNthCalledWith(
      2,
      'Follow the flow',
    );
    expect(session.finish).toHaveBeenCalledWith('Goal explored');
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { type: 'assistant', text: 'First response' },
      { type: 'assistant', text: 'Second response' },
      { type: 'finished' },
    ]);
  });

  it('reports malformed input without converting it into a customer turn', async () => {
    const session: LiveScenarioProtocolSession = {
      submitUserMessage: vi.fn(),
      finish: vi.fn(),
    };
    const output: string[] = [];

    await runLiveScenarioCommandStream({
      session,
      lines: from(['not json', JSON.stringify({ type: 'unknown' })]),
      writeLine(line) {
        output.push(line);
      },
    });

    expect(session.submitUserMessage).not.toHaveBeenCalled();
    expect(session.finish).not.toHaveBeenCalled();
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { type: 'protocol_error', error: 'invalid_json' },
      { type: 'protocol_error', error: 'invalid_command' },
    ]);
  });
});

async function* from(values: string[]): AsyncIterable<string> {
  yield* values;
}
