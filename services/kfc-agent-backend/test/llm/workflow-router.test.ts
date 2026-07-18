import { describe, expect, it } from 'vitest';
import { workflowRouteSchema } from '../../src/domain/workflow.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  OpenAIWorkflowRouter,
  stateDerivedWorkflowRoute,
} from '../../src/llm/workflowRouter.js';

const input = {
  latestUserMessage: 'Cho mình xem món và các ưu đãi thành viên',
  recentTurns: [],
  verifiedState: {
    hasCart: false,
    hasAddress: false,
    hasFulfillment: false,
    hasOrderPreview: false,
    hasOrder: false,
    hasPaymentAttempt: false,
    hasHandoff: false,
  },
};

describe('workflow router', () => {
  it('parses strict multi-workflow output and removes duplicate labels', async () => {
    const requests: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          primaryWorkflows: ['catalog_cart', 'catalog_cart'],
          capabilities: ['membership', 'promotions_content', 'membership'],
          needsClarification: false,
        }),
      }));
    };
    const router = new OpenAIWorkflowRouter({ apiKey: 'test', fetchImpl });

    await expect(router.route(input)).resolves.toEqual({
      primaryWorkflows: ['catalog_cart'],
      capabilities: ['membership', 'promotions_content'],
      needsClarification: false,
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('rejects output outside the route contract', () => {
    expect(() => workflowRouteSchema.parse({
      primaryWorkflows: ['catalog_cart'],
      capabilities: [],
      needsClarification: false,
      responseText: 'not allowed',
    })).toThrow();
  });

  it('falls back only from trusted lifecycle state', () => {
    expect(stateDerivedWorkflowRoute({
      order: { id: 'order-1' },
    } as AgentGraphState)).toEqual({
      primaryWorkflows: ['post_order_support'],
      capabilities: [],
      needsClarification: false,
    });
    expect(stateDerivedWorkflowRoute({} as AgentGraphState)).toEqual({
      primaryWorkflows: [],
      capabilities: [],
      needsClarification: true,
    });
  });
});
