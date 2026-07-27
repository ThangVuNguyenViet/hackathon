import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { createKfcGroundedReviewMiddleware } from '../../src/businessPacks/kfcVietnam/kfcGroundedReviewMiddleware.js';

describe('KFC grounded response review middleware', () => {
  it('requests one tool-free review after a grounded draft', async () => {
    const middleware = createKfcGroundedReviewMiddleware({
      enabled: true,
      hasCurrentTurnToolEvidence: () => true,
    });
    if (
      typeof middleware.afterModel !== 'object' ||
      !middleware.afterModel ||
      typeof middleware.afterModel.hook !== 'function' ||
      !middleware.wrapModelCall
    ) {
      throw new Error('Expected middleware lifecycle hooks');
    }

    const first = await middleware.afterModel.hook({
      messages: [new AIMessage('draft')],
    }, {} as never);
    expect(first).toMatchObject({ jumpTo: 'model' });
    expect(String(first?.messages?.[0]?.content)).toContain(
      'Honor the customer requested output scope',
    );
    expect(String(first?.messages?.[0]?.content)).toContain(
      'Do not infer taste, spice level',
    );
    expect(String(first?.messages?.[0]?.content)).toContain(
      'suitability claim about a combo as a whole',
    );

    const handler = vi.fn(async () => new AIMessage('reviewed'));
    await middleware.wrapModelCall(
      {
        model: {} as never,
        messages: [],
        tools: [{ name: 'searchMenu' }] as never,
        toolChoice: 'auto',
        systemPrompt: '',
        systemMessage: new SystemMessage(''),
        state: { messages: [] },
        runtime: {} as never,
      },
      handler,
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [], toolChoice: 'none' }),
    );

    expect(
      middleware.afterModel.hook({
        messages: [new AIMessage('reviewed')],
      }, {} as never),
    ).toBeUndefined();
    expect(
      middleware.afterModel.hook({
        messages: [new AIMessage('must not review twice')],
      }, {} as never),
    ).toBeUndefined();
  });

  it('does not add a review pass without current-turn tool evidence', async () => {
    const middleware = createKfcGroundedReviewMiddleware({
      enabled: true,
      hasCurrentTurnToolEvidence: () => false,
    });
    if (
      typeof middleware.afterModel !== 'object' ||
      !middleware.afterModel ||
      typeof middleware.afterModel.hook !== 'function'
    ) {
      throw new Error('Expected middleware afterModel hook');
    }

    expect(
      middleware.afterModel.hook({
        messages: [new AIMessage('ordinary answer')],
      }, {} as never),
    ).toBeUndefined();
  });
});
