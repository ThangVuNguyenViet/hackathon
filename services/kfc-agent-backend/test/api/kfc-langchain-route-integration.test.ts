import { fakeModel } from '@langchain/core/testing';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { testAgent } from '../fixtures/testAgent.js';

describe('KFC LangChain route integration', () => {
  it('runs the trusted KFC pack and reports the neutral runtime', async () => {
    const server = buildServer({
      ...testAgent(
        fakeModel().respond(
          new AIMessage(
            JSON.stringify({
              customerText: 'Mình có thể giúp bạn chọn món KFC.',
              projectionDigest: 'a'.repeat(64),
              factualClaims: {
                evidenceReferences: [],
                disclosedLimitations: [],
                hasUnsupportedFactualClaim: false,
              },
              publicationDeclaration: {
                semanticRelevance: 'aligned',
                privateDataDisclosure: 'none',
                disclosureAuthorities: [],
                disclosesInternalMetadata: false,
              },
              selectedActionResponse: null,
            }),
          ),
        ),
      ),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:langchain_route_customer',
        customerId: 'langchain_route_customer',
        clientMessageId: 'langchain_route_message_1',
        text: 'Tôi cần trợ giúp chọn món.',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      responseText: 'Mình có thể giúp bạn chọn món KFC.',
      agentRuntime: 'langchain-create-agent',
      sessionId: 'kfc:langchain_route_customer',
      customerId: 'langchain_route_customer',
      replayed: false,
    });
  });
});
