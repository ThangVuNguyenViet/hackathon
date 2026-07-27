import { describe, expect, it, vi } from 'vitest';
import {
  runLiveScenarioCommandStream,
  type LiveScenarioProtocolSession,
} from '../../src/liveEvidence/liveScenarioProtocol.js';

describe('live scenario JSONL protocol', () => {
  it('forwards improvised messages and exact observed action references until finish', async () => {
    const session: LiveScenarioProtocolSession = {
      submitUserMessage: vi
        .fn()
        .mockResolvedValueOnce({
          responseText: 'First response',
          assistantTurnId: 'assistant-turn-1',
          genUi: {
            id: 'attachment-1',
            actions: [{ id: 'recommendation_select:action-1' }],
          },
          renderedActionReferences: [
            {
              assistantTurnId: 'assistant-turn-1',
              attachmentId: 'attachment-1',
              actionId: 'recommendation_select:action-1',
            },
          ],
        })
        .mockResolvedValueOnce({ responseText: 'Second response' }),
      submitAction: vi.fn().mockResolvedValue({
        responseText: 'Action response',
        assistantTurnId: 'assistant-turn-2',
      }),
      recordAssistantRendered: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
      finalizeTerminal: vi.fn().mockResolvedValue(undefined),
      recordProtocolError: vi.fn(),
      interrupt: vi.fn(),
    };
    const output: string[] = [];

    await runLiveScenarioCommandStream({
      session,
      lines: from([
        JSON.stringify({ type: 'user', text: '  Improvised first turn  ' }),
        JSON.stringify({
          type: 'action',
          assistantTurnId: 'assistant-turn-1',
          attachmentId: 'attachment-1',
          actionId: 'recommendation_select:action-1',
        }),
        JSON.stringify({ type: 'user', text: 'Follow the flow' }),
        JSON.stringify({ type: 'finish', note: 'Goal explored' }),
      ]),
      writeLine(line) {
        output.push(line);
      },
    });

    expect(session.submitUserMessage).toHaveBeenNthCalledWith(
      1,
      '  Improvised first turn  ',
    );
    expect(session.submitUserMessage).toHaveBeenNthCalledWith(
      2,
      'Follow the flow',
    );
    expect(session.submitAction).toHaveBeenCalledWith({
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionId: 'recommendation_select:action-1',
    });
    expect(session.recordAssistantRendered).toHaveBeenCalledTimes(3);
    expect(session.recordAssistantRendered).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assistantTurnId: 'assistant-turn-1',
        renderedActionReferences: [
          {
            assistantTurnId: 'assistant-turn-1',
            attachmentId: 'attachment-1',
            actionId: 'recommendation_select:action-1',
          },
        ],
      }),
    );
    expect(session.finish).toHaveBeenCalledWith('Goal explored');
    expect(session.finalizeTerminal).toHaveBeenCalledTimes(1);
    expect(session.interrupt).not.toHaveBeenCalled();
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        type: 'assistant',
        text: 'First response',
        assistantTurnId: 'assistant-turn-1',
        genUi: {
          id: 'attachment-1',
          actions: [{ id: 'recommendation_select:action-1' }],
        },
        renderedActionReferences: [
          {
            assistantTurnId: 'assistant-turn-1',
            attachmentId: 'attachment-1',
            actionId: 'recommendation_select:action-1',
          },
        ],
      },
      {
        type: 'assistant',
        text: 'Action response',
        assistantTurnId: 'assistant-turn-2',
      },
      { type: 'assistant', text: 'Second response' },
      { type: 'finished' },
    ]);
  });

  it('reports malformed input without converting it into a customer turn', async () => {
    const session: LiveScenarioProtocolSession = {
      submitUserMessage: vi.fn(),
      submitAction: vi.fn(),
      recordAssistantRendered: vi.fn(),
      finish: vi.fn(),
      finalizeTerminal: vi.fn(),
      recordProtocolError: vi.fn(),
      interrupt: vi.fn(),
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
    expect(session.submitAction).not.toHaveBeenCalled();
    expect(session.finish).not.toHaveBeenCalled();
    expect(session.recordProtocolError).toHaveBeenNthCalledWith(
      1,
      'invalid_json',
    );
    expect(session.recordProtocolError).toHaveBeenNthCalledWith(
      2,
      'invalid_command',
    );
    expect(session.interrupt).toHaveBeenCalledWith('stdin_eof');
    expect(session.finalizeTerminal).toHaveBeenCalledTimes(1);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { type: 'protocol_error', error: 'invalid_json' },
      { type: 'protocol_error', error: 'invalid_command' },
    ]);
  });

  it('persists a turn control error and abandons the stream on stdout failure', async () => {
    const session: LiveScenarioProtocolSession = {
      submitUserMessage: vi
        .fn()
        .mockRejectedValue(new TypeError('private provider failure')),
      submitAction: vi.fn(),
      recordAssistantRendered: vi.fn(),
      finish: vi.fn(),
      finalizeTerminal: vi.fn(),
      recordProtocolError: vi.fn(),
      interrupt: vi.fn(),
    };

    await expect(
      runLiveScenarioCommandStream({
        session,
        lines: from([
          JSON.stringify({ type: 'user', text: 'trigger failure' }),
        ]),
        writeLine() {
          throw new Error('stdout closed');
        },
      }),
    ).rejects.toThrow('stdout closed');

    expect(session.recordProtocolError).toHaveBeenCalledWith(
      'turn_error',
      'TypeError',
    );
    expect(session.recordProtocolError).toHaveBeenCalledWith(
      'control_error',
      'Error',
    );
    expect(session.interrupt).toHaveBeenCalledWith('control_error');
    expect(session.finalizeTerminal).toHaveBeenCalledTimes(1);
  });
});

async function* from(values: string[]): AsyncIterable<string> {
  yield* values;
}
