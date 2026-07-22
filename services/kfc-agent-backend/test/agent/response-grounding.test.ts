import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { createKfcAgentStateGraph } from '../../src/agent/agentStateGraph.js';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import { createKfcCreateAgentTools } from '../../src/agent/kfcCreateAgentTools.js';
import {
  AGENT_SYSTEM_PROMPT,
  providerFailureReportCode,
  providerRetryUpdate,
  requiredAgentToolChoice,
  routeAgentModelResult,
} from '../../src/agent/agentModelInvocation.js';
import { classifyProviderFailure } from '../../src/agent/agentBoundaryPolicy.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  ordinaryGroundedResponseToolDefinition,
  selectedActionGroundedResponseToolDefinition,
} from '../../src/agent/responseGrounding.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function graphInput(model: ReturnType<typeof fakeModel>, sessionId: string) {
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
  };
}

describe('grounded response submission', () => {
  it('instructs the model to keep approval-required calls terminal and singular', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'An approval-required tool must be the only call in its tool-call batch',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Complete reads and reversible operations in earlier model rounds',
    );
  });

  it('keeps internal response contracts out of customer-facing prose', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Write only customer-useful prose in the customer language',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Never expose schema field names, enum values, evidence identifiers, source labels, validation bookkeeping, tool terminology, or graph state terminology',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Render uncertainty naturally without copying internal labels',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'If the customer asks for advice without an action, comply silently instead of repeating that no cart or order change occurred',
    );
  });

  it('distinguishes full-menu browsing, category browsing, and focused recommendations', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Use all-scope menu browsing only when the customer asks for the entire menu',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'For a category browse, use the filtered provider query. The mock provider returns every verified match without truncation; the compact widget presents up to five choices. In prose, name no more than three representative items',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Request recommendation media only for a focused item or modifier suggestion',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'cite active_collection:searchMenu with claimKinds containing only status, and leave disclosedLimitations empty',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Do not include modifier unless customerText states a verified modifier fact',
    );
  });
  it('keeps historical cart confirmation in model policy, not deterministic text routing', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'present that exact verified candidate and obtain explicit customer confirmation in a later turn before changing the cart',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Do not call catalog, discovery, or recommendation tools merely to re-find, refresh, or validate that candidate',
    );
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Additional reads are justified only when the customer separately requests current catalog, availability, details, or promotions',
    );

    for (const content of [
      'Repeat a historical selection.',
      'Use a personalized suggestion.',
    ]) {
      expect(
        routeAgentModelResult({
          failure: null,
          providerFailure: null,
          messages: [new AIMessage(content)],
        }),
      ).toBe('finalize_response');
    }
    expect(
      routeAgentModelResult({
        failure: null,
        providerFailure: null,
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: 'getRecentOrder',
                args: {},
                id: 'model-authored-read',
              },
            ],
          }),
        ],
      }),
    ).toBe('validate_tool_calls');
  });

  it('serializes the same schema through the bound OpenAI and Google adapters', () => {
    const openai = new ChatOpenAI({
      apiKey: 'test-openai-key',
      model: 'gpt-5-mini-2025-08-07',
      maxRetries: 0,
      supportsStrictToolCalling: true,
      useResponsesApi: true,
    });
    const google = new ChatGoogle({
      apiKey: 'test-google-key',
      model: 'gemini-3.1-flash-lite',
      maxRetries: 0,
    });
    const ordinaryToolNames = [
      'getOrderStatus',
      'checkPaymentStatus',
      GROUNDED_RESPONSE_TOOL_NAME,
    ] as const;
    const ordinaryToolDefinitions = [
      ...commerceToolDefinitions(['getOrderStatus', 'checkPaymentStatus']),
      ordinaryGroundedResponseToolDefinition,
    ];
    const ordinaryChoice = requiredAgentToolChoice(ordinaryToolNames);

    const openaiBinding = openai.bindTools(ordinaryToolDefinitions, {
      tool_choice: ordinaryChoice,
    });
    if (!(openaiBinding instanceof ChatOpenAI)) {
      throw new Error('expected_bound_openai_model');
    }
    // The pinned adapter stores bindTools options on the cloned model.
    const openaiParams = openaiBinding.invocationParams();
    expect(
      openaiParams.tools?.map((tool) =>
        tool.type === 'function' && 'name' in tool ? tool.name : null,
      ),
    ).toEqual(ordinaryToolNames);
    expect(openaiParams.tool_choice).toEqual(ordinaryChoice);
    expect(openaiParams.tools).toContainEqual(
      expect.objectContaining({
        type: 'function',
        name: GROUNDED_RESPONSE_TOOL_NAME,
        parameters: expect.objectContaining({
          properties: expect.objectContaining({
            selectedActionResponse: { type: 'null' },
          }),
        }),
      }),
    );

    expect(() =>
      google.bindTools?.(ordinaryToolDefinitions, {
        tool_choice: ordinaryChoice,
      }),
    ).not.toThrow();
    for (const model of [openai, google]) {
      expect(() =>
        model.bindTools?.([selectedActionGroundedResponseToolDefinition], {
          tool_choice: GROUNDED_RESPONSE_TOOL_NAME,
        }),
      ).not.toThrow();
      expect(() =>
        createKfcAgentStateGraph({
          model,
          checkpointer: new MemorySaver(),
        }),
      ).not.toThrow();
    }
    const googleOrdinaryParams = google.invocationParams({
      tools: ordinaryToolDefinitions,
      tool_choice: ordinaryChoice,
    });
    expect(googleOrdinaryParams.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY' },
    });
    expect(
      googleOrdinaryParams.tools?.[0]?.functionDeclarations?.map(
        ({ name }) => name,
      ),
    ).toEqual(ordinaryToolNames);
    expect(
      googleOrdinaryParams.tools?.[0]?.functionDeclarations?.at(-1)?.parameters,
    ).toMatchObject({
      properties: {
        selectedActionResponse: { type: 'null' },
      },
    });

    const quoteDefinition = createKfcCreateAgentTools().filter(
      ({ name }) => name === 'quoteFulfillment',
    );
    const openaiQuote = openai.bindTools(quoteDefinition);
    if (!(openaiQuote instanceof ChatOpenAI)) {
      throw new Error('expected_bound_openai_quote_model');
    }
    const openaiQuoteTool = openaiQuote.invocationParams().tools?.[0];
    expect(openaiQuoteTool).toMatchObject({
      type: 'function',
      name: 'quoteFulfillment',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['address', 'savedAddressRef', 'method'],
      },
    });
    expect(
      openaiQuoteTool &&
        'parameters' in openaiQuoteTool &&
        openaiQuoteTool.parameters,
    ).not.toHaveProperty('anyOf');
    const googleQuote = google.invocationParams({ tools: quoteDefinition });
    expect(
      googleQuote.tools?.[0]?.functionDeclarations?.[0]?.parameters,
    ).toMatchObject({
      type: 'object',
      required: ['address', 'savedAddressRef', 'method'],
    });
    expect(
      googleQuote.tools?.[0]?.functionDeclarations?.[0]?.parameters,
    ).not.toHaveProperty('anyOf');
  });

  it('surfaces only safe diagnostics from the actual Google request boundary', async () => {
    const privateProviderDetail =
      'PRIVATE-GOOGLE-DETAIL-MUST-NEVER-ENTER-DIAGNOSTICS';
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        capturedUrl = request.url;
        capturedBody = await request.clone().json();
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: privateProviderDetail,
            },
          }),
          {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );
    try {
      const google = new ChatGoogle({
        apiKey: 'test-google-key',
        model: 'gemini-3.1-flash-lite',
        maxRetries: 0,
        thinkingLevel: 'HIGH',
      });
      const ordinaryToolNames = [
        'getOrderStatus',
        'checkPaymentStatus',
        GROUNDED_RESPONSE_TOOL_NAME,
      ] as const;
      const bound = google.bindTools(
        [
          ...commerceToolDefinitions(['getOrderStatus', 'checkPaymentStatus']),
          ordinaryGroundedResponseToolDefinition,
        ],
        {
          tool_choice: requiredAgentToolChoice(ordinaryToolNames),
        },
      );
      let providerError: unknown;
      try {
        await bound.invoke([new HumanMessage('safe structural probe')]);
      } catch (error) {
        providerError = error;
      }

      expect(capturedUrl).toContain(
        '/v1beta/models/gemini-3.1-flash-lite:generateContent',
      );
      expect(capturedBody).toMatchObject({
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        generationConfig: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: 'HIGH',
          },
        },
        tools: [
          {
            functionDeclarations: expect.arrayContaining([
              expect.objectContaining({
                name: GROUNDED_RESPONSE_TOOL_NAME,
                parameters: expect.objectContaining({
                  properties: expect.objectContaining({
                    selectedActionResponse: { type: 'null' },
                  }),
                }),
              }),
            ]),
          },
        ],
      });
      const failure = classifyProviderFailure(providerError);
      expect(failure).toEqual({
        errorClass: 'client_error',
        retryable: false,
        diagnostic: {
          stage: 'model_invoke',
          httpStatus: 400,
          errorType: 'request_error',
        },
      });
      const stableFailure = providerRetryUpdate({
        providerFailure: failure,
        providerRetries: 0,
        providerAttempts: 1,
        turnDeadlineAt: Date.now() + 10_000,
      });
      expect(stableFailure).toEqual({
        failure: 'agent_provider_call_failed:client_error',
      });
      if (!stableFailure.failure) {
        throw new Error('expected_stable_provider_failure');
      }
      expect(
        providerFailureReportCode(stableFailure.failure, failure.diagnostic),
      ).toBe(
        'agent_provider_call_failed:client_error:http_400:request_error:model_invoke',
      );
      expect(
        providerFailureReportCode(
          'agent_turn_deadline_exceeded',
          failure.diagnostic,
        ),
      ).toBe('agent_turn_deadline_exceeded');
      expect(JSON.stringify(failure)).not.toContain(privateProviderDetail);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('completes from one typed final action bound to the live publication', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'active_collection:searchMenu',
          claimKinds: ['product', 'price'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: { scope: 'all', query: null, purpose: 'browse' },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'Here is the complete verified menu.',
          ...claims,
        }),
      );
    const input = graphInput(model, 'response-grounding-supported');

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
      .respond(
        new AIMessage(
          JSON.stringify({
            customerText: 'Missing publication binding.',
          }),
        ),
      )
      .respond(
        groundedResponseModelReply({
          customerText: 'How can I help?',
        }),
      );
    const input = graphInput(model, 'response-grounding-malformed');

    await expect(runAgentTurn(input)).resolves.toMatchObject({
      responseText: 'How can I help?',
    });
    expect(model.callCount).toBe(2);
  });

  it('uses the one semantic correction for unsupported claims', async () => {
    const unsupported = groundedResponseModelReply({
      customerText: 'An unsupported product exists.',
      hasUnsupportedFactualClaim: true,
    });
    const model = fakeModel().respond(unsupported).respond(unsupported);
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

  it('uses one author call and no verifier call for a safe response', async () => {
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'How can I help?',
      }),
    );
    const input = graphInput(model, 'response-grounding-no-verifier');

    await expect(runAgentTurn(input)).resolves.toMatchObject({
      responseText: 'How can I help?',
    });
    expect(model.callCount).toBe(1);
  });

  it('fails closed directly for an unsafe publication declaration', async () => {
    const unsafe = groundedResponseModelReply({
      customerText: 'Internal publication metadata follows.',
      publicationDeclaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: true,
      },
    });
    const model = fakeModel().respond(unsafe).respond(unsafe);
    const input = graphInput(model, 'response-grounding-unsafe-declaration');

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_response_publication_rejected',
    );
    expect(model.callCount).toBe(1);
  });

  it('accepts governed allergen claims with exact official provenance', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'active_collection:answerAllergenQuestion:0',
          claimKinds: ['allergen', 'source'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'answerAllergenQuestion',
          args: { query: 'cheese' },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'The verified allergen source covers cheese.',
          ...claims,
        }),
      );
    const input = graphInput(model, 'response-grounding-allergen-source');

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

  it('uses the one semantic correction when a governed allergen claim omits source provenance', async () => {
    const unsupportedGovernedClaim = groundedResponseModelReply({
      customerText: 'The allergen evidence covers cheese.',
      evidenceReferences: [
        {
          evidenceId: 'active_collection:answerAllergenQuestion:0',
          claimKinds: ['allergen'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'answerAllergenQuestion',
          args: { query: 'cheese' },
        },
      ])
      .respond(unsupportedGovernedClaim)
      .respond(unsupportedGovernedClaim);
    const input = graphInput(
      model,
      'response-grounding-allergen-source-required',
    );

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_semantic_correction_limit_exceeded',
    );
    expect(model.callCount).toBe(3);
  });

  it('uses the one semantic correction for a raw final response', async () => {
    const model = fakeModel()
      .respond(new AIMessage('Raw responses are not accepted.'))
      .respond(
        groundedResponseModelReply({
          customerText: 'How can I help?',
        }),
      );
    const input = graphInput(model, 'response-grounding-raw');

    await expect(runAgentTurn(input)).resolves.toMatchObject({
      responseText: 'How can I help?',
    });
    expect(model.callCount).toBe(2);
  });

  it('rejects a selected-action reference on an ordinary graph turn', async () => {
    const forgedResponse = groundedResponseModelReply({
      customerText: 'This ordinary response claims a selected action.',
      selectedActionResponse: {
        schemaVersion: 'kfc-selected-action-response-reference-v1',
        actionDigest: 'a'.repeat(64),
        selection: {
          entityIds: ['forged:ordinary-selection'],
          verifiedRevision: 'b'.repeat(64),
        },
        effect: {
          effectId: 'forged:ordinary-effect',
          outcome: 'presentation_ready',
          verifiedRevision: 'c'.repeat(64),
        },
        assertion: 'outcome_acknowledged',
      },
    });
    const model = fakeModel().respond(forgedResponse).respond(forgedResponse);
    const input = graphInput(
      model,
      'response-grounding-ordinary-selected-action-forgery',
    );

    await expect(runAgentTurn(input)).rejects.toThrow(
      'selected_action_response_authority_missing',
    );
    expect(model.callCount).toBe(1);
    expect(
      (await input.store.listTurns(input.sessionId)).filter(
        ({ role }) => role === 'assistant',
      ),
    ).toEqual([]);
  });
});
