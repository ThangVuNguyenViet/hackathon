import { describe, expect, it } from 'vitest';
import {
  EXPLICIT_CART_ACTION_CONTINUATION_FEEDBACK,
  explicitCartActionNeedsContinuation,
} from '../../src/agent/explicitCartActionContinuation.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';

function trace(toolName: ToolTraceEntry['toolName']): ToolTraceEntry {
  return {
    toolName,
    arguments: {},
    ok: true,
    resultSummary: 'ok',
    provenance: [],
  };
}

describe('explicit cart action continuation', () => {
  it('focuses modifier reads on the explicitly customized item', () => {
    expect(EXPLICIT_CART_ACTION_CONTINUATION_FEEDBACK).toContain(
      'only for the item with an explicitly requested customization',
    );
    expect(EXPLICIT_CART_ACTION_CONTINUATION_FEEDBACK).toContain(
      'Do not read or author optional modifiers for other items',
    );
  });

  it('continues an explicit quantified add request after catalog discovery', () => {
    expect(
      explicitCartActionNeedsContinuation({
        currentUserMessage:
          'Cho mình 1 combo gà cay; thêm 1 burger và 2 Pepsi.',
        currentTurnToolTrace: [
          trace('searchMenu'),
          trace('getModifierOptions'),
        ],
      }),
    ).toBe(true);
    expect(
      explicitCartActionNeedsContinuation({
        currentUserMessage: 'Cho mình 2 Pepsi.',
        currentTurnToolTrace: [],
      }),
    ).toBe(true);
  });

  it('does not reinterpret browsing or advice as a cart mutation', () => {
    expect(
      explicitCartActionNeedsContinuation({
        currentUserMessage: 'Cho mình xem toàn bộ menu trước.',
        currentTurnToolTrace: [trace('searchMenu')],
      }),
    ).toBe(false);
    expect(
      explicitCartActionNeedsContinuation({
        currentUserMessage: 'Gợi ý món cho 4 người.',
        currentTurnToolTrace: [trace('searchMenu')],
      }),
    ).toBe(false);
  });

  it('stops correcting after updateCart succeeds', () => {
    expect(
      explicitCartActionNeedsContinuation({
        currentUserMessage: 'Cho mình 2 Pepsi.',
        currentTurnToolTrace: [trace('searchMenu'), trace('updateCart')],
      }),
    ).toBe(false);
  });
});
