import { describe, expect, it } from 'vitest';
import type { AgentState } from '../../src/agent/agentState.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';

describe('atomic modifier GenUI selection', () => {
  it('publishes one one-shot apply action', () => {
    const state = {
      sessionId: 'kfc:atomic-modifier',
      customerId: 'atomic-modifier',
      channel: 'kfc',
      latestUserMessage: 'Tùy chỉnh món',
      escalationReasons: [],
      retrievedEvidence: [],
      menuModifierOptions: {
        itemCode: 'combo',
        itemId: 'combo',
        productCode: 'combo',
        name: 'Combo',
        provenance: {
          sourceFile: 'fixture',
          fixtureMode: 'public_crawl_seed',
        },
        modifierGroups: [
          {
            groupId: 'main',
            name: 'Món chính',
            min: 1,
            max: 1,
            depth: 0,
            options: [
              {
                modifierId: 'burger',
                name: 'Burger',
                priceDeltaVnd: 0,
                default: true,
                quantity: 1,
                posItemId: 'burger',
                imageName: '',
                modifierGroups: [],
              },
            ],
          },
        ],
      },
    } as unknown as AgentState;

    const attachment = selectKfcGenUiAttachment({
      state,
      turnToolNames: ['getModifierOptions'],
      issuedAt: new Date('2026-07-24T00:00:00.000Z'),
    });

    expect(attachment).toMatchObject({
      widgetKind: 'modifierPicker',
      actions: [{ id: 'apply_modifiers', label: 'Áp dụng', intent: 'primary' }],
      authority: { actionLifecycle: 'one_shot' },
    });
  });
});
