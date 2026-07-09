import { describe, expect, it } from 'vitest';
import type { ConversationTurn } from '../../src/domain/types.js';
import { evaluateLiveScenarioProof } from '../../src/proof/liveScenarioProof.js';
import type { ScenarioScript } from '../../src/scenarios/scenarioScript.js';

describe('live scenario proof evaluation', () => {
  it('fails a non-handoff scenario when any customer turn is missing a following assistant reply', () => {
    const result = evaluateLiveScenarioProof({
      script: scenarioScript(),
      sessionId: 'messenger:psid_1',
      workerUrl: 'https://worker.local',
      endpointChecks: [
        { name: 'ready', ok: true, status: 200 },
        { name: 'ready:deep', ok: true, status: 200 },
        { name: 'dashboard:turns', ok: true, status: 200 },
      ],
      sessionControl: {
        sessionId: 'messenger:psid_1',
        agentMode: 'ai_active',
        assignedAgentId: null,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      turns: [
        turn('turn_1', 'user', 'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.'),
        turn('turn_2', 'assistant', 'Mình đã thêm món vào giỏ.'),
        turn('turn_3', 'user', 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?'),
      ],
      dashboardEvents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('Missing assistant reply after customer turn 2.');
    expect(result.replyChecks).toEqual([
      expect.objectContaining({ userTurnIndex: 1, ok: true }),
      expect.objectContaining({ userTurnIndex: 2, ok: false }),
    ]);
  });

  it('fails early when the live session is still human paused', () => {
    const result = evaluateLiveScenarioProof({
      script: scenarioScript(),
      sessionId: 'messenger:psid_1',
      workerUrl: 'https://worker.local',
      endpointChecks: [{ name: 'ready', ok: true, status: 200 }],
      sessionControl: {
        sessionId: 'messenger:psid_1',
        agentMode: 'human_paused',
        assignedAgentId: 'agent_1',
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      turns: [],
      dashboardEvents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('Session messenger:psid_1 is human_paused.');
  });

  it('rejects customer turns injected by proof harnesses instead of real Messenger', () => {
    const result = evaluateLiveScenarioProof({
      script: scenarioScript(),
      sessionId: 'messenger:psid_1',
      workerUrl: 'https://worker.local',
      endpointChecks: [{ name: 'ready', ok: true, status: 200 }],
      sessionControl: {
        sessionId: 'messenger:psid_1',
        agentMode: 'ai_active',
        assignedAgentId: null,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      turns: [
        turn(
          'm_liveproof20260709213457_normal',
          'user',
          'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.',
        ),
        turn('turn_2', 'assistant', 'Mình đã thêm món vào giỏ.'),
        turn(
          'm_pausedproof20260709213549_paused',
          'user',
          'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?',
        ),
        turn('turn_4', 'assistant', 'Mình kiểm tra phí ship nhé.'),
      ],
      dashboardEvents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'Customer turn 1 was not sent through real Messenger (m_liveproof20260709213457_normal).',
        'Customer turn 2 was not sent through real Messenger (m_pausedproof20260709213549_paused).',
      ]),
    );
  });
});

function scenarioScript(): ScenarioScript {
  const turns = [
    {
      index: 1,
      speaker: 'User' as const,
      text: 'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.',
      useCases: ['UC-01'],
    },
    {
      index: 2,
      speaker: 'User' as const,
      text: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?',
      useCases: ['UC-02'],
    },
  ];
  return {
    id: '01-dat-mon-ro-rang-giao-hang',
    title: 'Đặt món rõ ràng và giao hàng',
    channel: 'messenger_mock',
    goal: 'Order delivery',
    useCases: ['UC-01', 'UC-02'],
    finalState: 'order_created',
    turns,
    userTurns: turns,
    expectations: [],
  };
}

function turn(id: string, role: ConversationTurn['role'], text: string): ConversationTurn {
  return {
    id,
    sessionId: 'messenger:psid_1',
    channel: 'messenger',
    role,
    text,
    externalMessageId: id,
    externalUserId: 'psid_1',
    deliveryStatus: role === 'assistant' ? 'sent' : 'received',
    metadata: null,
    createdAt: `2026-07-09T00:00:0${id.at(-1)}.000Z`,
  };
}
