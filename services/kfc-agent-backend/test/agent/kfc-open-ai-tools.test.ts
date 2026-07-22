import { describe, expect, it } from 'vitest';
import {
  createKfcOpenAiTools,
  createKfcToolSession,
  verifiedKfcToolSessionContext,
} from '../../src/agent/kfcOpenAiTools.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('KFC OpenAI tools', () => {
  it('teaches the model to supply intent rather than relying on backend intent parsing', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:search_guidance');
    const searchMenu = createKfcOpenAiTools({ clients, session }).find(
      (tool) => tool.definition.name === 'searchMenu',
    );

    expect(searchMenu?.definition.description).toContain('concise');
    expect(searchMenu?.definition.description).toContain('one searchMenu call');
    expect(searchMenu?.definition.description).toContain('same user turn');
    expect(searchMenu?.definition.description).toContain('category');
    expect(searchMenu?.definition.description).toContain('exact item code');
    expect(searchMenu?.definition.description).toContain(
      'positive option terms',
    );
    expect(searchMenu?.definition.description).toContain('Absence of a match');
    expect(searchMenu?.definition.description).toContain(
      'Keep search terms in Vietnamese',
    );
    expect(searchMenu?.definition.description).toContain(
      '["không cay", "phô mai"]',
    );
    expect(searchMenu?.definition.description).toContain(
      'matchesAllModifierQueries',
    );
    expect(searchMenu?.definition.parameters.properties).toHaveProperty(
      'modifierQueries',
    );
  });

  it('exposes every canonical tool and keeps fixture commerce state inside the toolbox', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:customer_1');
    const tools = createKfcOpenAiTools({ clients, session });

    expect(tools.map((tool) => tool.definition.name)).toEqual(toolNames);
    expect(
      tools.every((tool) => tool.definition.parameters.type === 'object'),
    ).toBe(true);
    expect(
      tools.every((tool) => !('anyOf' in tool.definition.parameters)),
    ).toBe(true);

    const updateCart = tools.find(
      (tool) => tool.definition.name === 'updateCart',
    );
    const previewCart = tools.find(
      (tool) => tool.definition.name === 'previewCart',
    );
    const quoteFulfillment = tools.find(
      (tool) => tool.definition.name === 'quoteFulfillment',
    );
    expect(updateCart).toBeDefined();
    expect(previewCart).toBeDefined();
    expect(quoteFulfillment).toBeDefined();
    expect(
      quoteFulfillment!.definition.parameters.properties,
    ).not.toHaveProperty('itemCodes');

    const updateResult = await updateCart!.execute({
      itemCode: '20751',
      quantity: 2,
    });
    const previewResult = await previewCart!.execute({});

    expect(updateResult).toMatchObject({ ok: true, toolName: 'updateCart' });
    expect(previewResult).toMatchObject({
      ok: true,
      toolName: 'previewCart',
      value: {
        id: 'cart_kfc:customer_1',
        items: [{ itemCode: '20751', quantity: 2 }],
      },
    });
    expect(verifiedKfcToolSessionContext(session)).toMatchObject({
      cart: {
        items: [{ itemCode: '20751', quantity: 2 }],
        totalVnd: 198000,
      },
    });

    const quoteResult = await quoteFulfillment!.execute({
      method: 'delivery',
      address: {
        label: 'Nhà',
        line1: '60 Phạm Văn Nghị',
        district: 'Quận 7',
        city: 'TP.HCM',
      },
      itemCodes: ['INVENTED_CODE'],
    });
    expect(quoteResult).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        availability: { checkedItemIds: ['20751'] },
      },
    });
  });
});
