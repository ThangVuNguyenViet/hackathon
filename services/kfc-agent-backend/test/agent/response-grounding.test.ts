import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { createKfcAgentStateGraph } from '../../src/agent/agentStateGraph.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  responseRequiresOnlineVerification,
} from '../../src/agent/responseGrounding.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function graphInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
  verifierClaims = groundedResponseClaims(),
) {
  return {
    sessionId,
    customerId: 'response-grounding-customer',
    channel: 'kfc' as const,
    text: 'Show me the menu',
    externalMessageId: `${sessionId}-message`,
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    checkpointer: new MemorySaver(),
    agentModel: model,
    responseVerifierModel: groundedResponseVerifierModel(
      verifierClaims,
    ),
  };
}

describe('grounded response submission', () => {
  it('binds the same schema through the OpenAI and Google adapters', () => {
    const models = [
      new ChatOpenAI({
        apiKey: 'test-openai-key',
        model: 'gpt-4.1-mini',
        maxRetries: 0,
      }),
      new ChatGoogle({
        apiKey: 'test-google-key',
        model: 'gemini-3.1-flash-lite',
        maxRetries: 0,
      }),
    ];

    for (const model of models) {
      expect(() => createKfcAgentStateGraph({
        model,
        checkpointer: new MemorySaver(),
      })).not.toThrow();
    }
  });

  it('completes from one typed final action bound to the live publication', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product', 'price'],
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Here is the complete verified menu.',
        ...claims,
      }));
    const input = graphInput(
      model,
      'response-grounding-supported',
      claims,
    );

    const output = await runAgentTurn(input);

    expect(output.responseText).toBe('Here is the complete verified menu.');
    expect(output.state.activeMenuCollection?.result.complete).toBe(true);
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
    ]);
    expect(model.callCount).toBe(2);
  });

  it('uses the one semantic correction for malformed typed output', async () => {
    const model = fakeModel()
      .respond(new AIMessage({
        content: '',
        tool_calls: [{
          name: GROUNDED_RESPONSE_TOOL_NAME,
          args: { customerText: 'Missing publication binding.' },
        }],
      }))
      .respond(groundedResponseModelReply({
        customerText: 'How can I help?',
      }));
    const input = graphInput(model, 'response-grounding-malformed');

    await expect(runAgentTurn(input)).resolves.toMatchObject({
      responseText: 'How can I help?',
    });
    expect(model.callCount).toBe(2);
  });

  it('fails closed after one correction for unsupported claims', async () => {
    const unsupported = groundedResponseModelReply({
      customerText: 'An unsupported product exists.',
      hasUnsupportedFactualClaim: true,
    });
    const model = fakeModel()
      .respond(unsupported)
      .respond(unsupported);
    const input = graphInput(model, 'response-grounding-unsupported');

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_semantic_correction_limit_exceeded',
    );
    expect(model.callCount).toBe(2);
    await expect(
      input.store.listEvents(input.sessionId),
    ).resolves.toContainEqual(
      expect.objectContaining({
        sourceType: 'agent:failed_closed',
        payload: expect.objectContaining({
          errorCode: 'agent_semantic_correction_limit_exceeded',
        }),
      }),
    );
  });

  it('fails closed after one independent verifier rejection without retry', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'A response requiring independent verification.',
    }));
    const input = {
      ...graphInput(model, 'response-grounding-verifier-rejection'),
      responseVerifierModel: groundedResponseVerifierModel({
        hasUnsupportedFactualClaim: true,
      }),
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_response_grounding_rejected',
    );
    expect(model.callCount).toBe(1);
    const failure = (await input.store.listEvents(input.sessionId)).find(
      ({ sourceType }) => sourceType === 'agent:failed_closed',
    );
    expect(failure?.payload).toMatchObject({
      errorCode: 'agent_response_grounding_rejected',
      responseVerification: {
        calls: 1,
        latencyMs: expect.any(Number),
        providerAttempt: {
          outcome: 'invalid_response',
          purpose: 'response_verification',
        },
      },
    });
  });

  it('fails closed after one malformed independent verifier result', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'A response requiring independent verification.',
    }));
    const input = {
      ...graphInput(model, 'response-grounding-verifier-malformed'),
      responseVerifierModel: groundedResponseVerifierModel({
        rawOutput: { invalid: true },
      }),
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_response_grounding_rejected',
    );
    expect(model.callCount).toBe(1);
  });

  it('accepts governed allergen claims with exact official provenance', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'active_collection:answerAllergenQuestion:0',
        claimKinds: ['allergen', 'source'],
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'answerAllergenQuestion',
        args: { query: 'cheese' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The verified allergen source covers cheese.',
        ...claims,
      }));
    const input = graphInput(
      model,
      'response-grounding-allergen-source',
      claims,
    );

    const output = await runAgentTurn(input);

    expect(output.responseText).toBe(
      'The verified allergen source covers cheese.',
    );
    expect(output.state.contentEvidence).toEqual([
      expect.objectContaining({
        kind: 'allergen',
        approvalStatus: 'approved',
        audience: 'customer_public',
      }),
    ]);
  });

  it('uses the one semantic correction for a raw final response', async () => {
    const model = fakeModel()
      .respond(new AIMessage('Raw responses are not accepted.'))
      .respond(groundedResponseModelReply({
        customerText: 'How can I help?',
      }));
    const input = graphInput(model, 'response-grounding-raw');

    await expect(runAgentTurn(input)).resolves.toMatchObject({
      responseText: 'How can I help?',
    });
    expect(model.callCount).toBe(2);
  });

  it('requires independent verification for all free-form customer prose', () => {
    expect(responseRequiresOnlineVerification({
      customerText: 'Customer-facing prose.',
    })).toBe(true);
  });
});
