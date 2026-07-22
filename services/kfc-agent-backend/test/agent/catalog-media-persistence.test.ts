import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { groundedResponseModelReply } from '../fixtures/groundedResponse.js';
import { runAgentTurn } from '../fixtures/runAgentTurn.js';

describe('catalog media persistence', () => {
  it('persists and presents the exact cited current item-detail intent', async () => {
    const store = new MemoryStore();
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: {
            scope: 'filtered',
            query: 'Combo Hợp Gu 99K',
            purpose: 'browse',
          },
        },
      ])
      .respondWithTools([
        {
          name: 'getItemDetails',
          args: { code: '20751' },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'Combo Hợp Gu 99K đang có giá 99.000đ.',
          evidenceReferences: (publication) =>
            publication.evidence
              .filter(({ evidenceId }) =>
                evidenceId.startsWith('current:getItemDetails:'),
              )
              .map(({ evidenceId }) => ({
                evidenceId,
                claimKinds: ['product', 'price'],
              })),
        }),
      );

    const output = await runAgentTurn({
      sessionId: 'messenger:catalog-media-persistence',
      customerId: 'catalog-media-persistence',
      channel: 'messenger',
      text: 'Cho mình xem Combo Hợp Gu 99K.',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(output.presentation).toMatchObject({
      profile: 'social',
      media: [
        {
          key: 'catalog:20751:0',
          title: 'Combo Hợp Gu 99K',
        },
      ],
    });
    const assistantTurn = (
      await store.listTurns('messenger:catalog-media-persistence')
    ).find((turn) => turn.role === 'assistant');
    expect(assistantTurn?.metadata?.catalogMediaIntent).toMatchObject({
      schemaVersion: 'kfc-catalog-media-intent-v1',
      toolName: 'getItemDetails',
      outcome: 'selected',
      media: [{ key: 'catalog:20751:0' }],
    });
  });
});
