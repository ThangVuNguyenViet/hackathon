import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

describe('loadScenarioScript', () => {
  it('loads metadata, turns, and expectations from scenario JSON', async () => {
    const script = await loadScenarioScript(
      join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.json'),
    );

    expect(script.id).toBe('08-thanh-toan-loi-va-don-bat-thuong');
    expect(script.channel).toBe('kfc');
    expect(script.finalState).toBe('human_review_required');
    expect(script.useCases).toEqual(['UC-18', 'UC-39']);
    expect(script.userTurns).toHaveLength(4);
    expect(script.turns.some((turn) => turn.useCases.includes('Filler'))).toBe(true);
    expect(script.expectations).toContain('Đơn số lượng rất lớn kích hoạt `human_review_required`.');
  });

  it('loads the combo conversion and accepted upsize contract', async () => {
    const script = await loadScenarioScript(
      join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json'),
    );

    expect(script.finalState).toBe('cart_ready');
    expect(script.userTurns.map((turn) => turn.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('10 miếng gà'),
        expect.stringContaining('đổi sang 2 Combo Đẫy Đà 129K'),
        expect.stringContaining('nâng cả 4 Pepsi lên size đại'),
      ]),
    );
    expect(script.expectations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('146.000đ'),
        expect.stringContaining('286.000đ'),
        expect.stringContaining('không tự đổi'),
      ]),
    );
    expect(script.acceptance).toEqual({
      noCartMutationBeforeUserTurn: 5,
      cartAfterUserTurn: {
        '5': {
          includedItems: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404000,
        },
      },
      assistantAfterUserTurnContains: {
        '5': ['2 Combo Đẫy Đà 129K', '146.000'],
      },
      finalCart: {
        includedItems: [{ itemCode: '20752', quantity: 2, unitPriceVnd: 143000 }],
        excludedItemCodes: ['41037', '41035', '41074'],
        totalVnd: 286000,
      },
    });
  });
});
