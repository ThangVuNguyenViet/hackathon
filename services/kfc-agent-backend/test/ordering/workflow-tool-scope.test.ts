import { describe, expect, it } from 'vitest';
import type { WorkflowRoute } from '../../src/domain/workflow.js';
import {
  toolMetadata,
  toolMatchesWorkflowRoute,
  toolNames,
  toolRouteMetadata,
} from '../../src/ordering/toolCatalog.js';

describe('workflow tool scope', () => {
  it('annotates every registered tool', () => {
    expect(Object.keys(toolRouteMetadata).sort()).toEqual([...toolNames].sort());
  });

  it('declares risk and confirmation metadata for every tool', () => {
    for (const toolName of toolNames) {
      expect(['read', 'protected', 'irreversible']).toContain(toolMetadata[toolName].riskLevel);
      expect(typeof toolMetadata[toolName].requiresConfirmation).toBe('boolean');
    }
    expect(toolMetadata.searchMenu).toMatchObject({
      riskLevel: 'read',
      requiresConfirmation: false,
    });
    expect(toolMetadata.updateCart).toMatchObject({
      riskLevel: 'protected',
      requiresConfirmation: false,
    });
    expect(toolMetadata.placeOrder).toMatchObject({
      riskLevel: 'irreversible',
      requiresConfirmation: true,
    });
  });

  it('takes the union for mixed workflows and capabilities', () => {
    const route: WorkflowRoute = {
      primaryWorkflows: ['catalog_cart', 'fulfillment'],
      capabilities: ['membership', 'food_safety'],
      needsClarification: false,
    };
    const allowed = toolNames.filter((toolName) => toolMatchesWorkflowRoute(toolName, route));

    expect(allowed).toEqual(expect.arrayContaining([
      'searchMenu',
      'updateCart',
      'findStores',
      'quoteFulfillment',
      'getMembershipProfile',
      'answerAllergenQuestion',
    ]));
    expect(allowed).not.toContain('placeOrder');
    expect(allowed).not.toContain('getOrderStatus');
  });

  it('exposes no tools when clarification is required', () => {
    const route: WorkflowRoute = {
      primaryWorkflows: [],
      capabilities: [],
      needsClarification: true,
    };
    expect(toolNames.filter((toolName) => toolMatchesWorkflowRoute(toolName, route))).toEqual([]);
  });
});
