import { describe, expect, it } from 'vitest';
import { OpenAIToolPlanner, StaticToolPlanner } from '../../src/llm/toolPlanner.js';

describe('tool planners', () => {
  it('returns queued static plans for unit tests', async () => {
    const planner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      },
    ]);
    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'web_mock',
        latestUserMessage: 'Cho mình Combo Hợp Gu 99K',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['searchMenu'],
      recentTurns: [],
    });
    expect(output.toolCalls[0]?.toolName).toBe('searchMenu');
  });

  it('parses OpenAI Responses output JSON', async () => {
    let requestBody: unknown;
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'voucher',
              entities: { voucherText: 'KFC50' },
              toolCalls: [
                {
                  toolName: 'validateVoucher',
                  arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
                },
              ],
              responseClaims: ['promotion'],
              directResponse: null,
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'web_mock',
        latestUserMessage: 'Mình có mã KFC50',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['validateVoucher'],
      recentTurns: [],
    });
    expect(output.intent).toBe('voucher');
    expect(output.responseClaims).toContain('promotion');
    expect(output.directResponse).toBeUndefined();
    expect(requestBody).toMatchObject({
      input: expect.stringContaining('"toolArgumentExamples"'),
      instructions: expect.stringContaining('planningExamples'),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining('changing drinks'),
    });
    expect((requestBody as { instructions: string }).instructions).toContain('delivery address');
    const plannerRequest = requestBody as { input: string; instructions: string };
    const plannerInput = JSON.parse(plannerRequest.input) as {
      outputSchema: { toolCalls: Array<{ arguments: Record<string, unknown> }>; responseClaims: string[] };
      toolArgumentExamples: { searchMenu: { query?: string }; quoteFulfillment: { address?: unknown; itemCodes?: unknown } };
      planningExamples: Array<{ user: string; toolCalls: Array<{ toolName: string }> }>;
    };
    expect(plannerInput.outputSchema.toolCalls[0]?.arguments).toEqual({ query: '<customer menu text>' });
    expect(plannerInput.outputSchema.responseClaims).toEqual([]);
    expect(plannerInput.toolArgumentExamples.searchMenu.query).toBe('<customer menu text>');
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.address).toBeTruthy();
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.itemCodes).toEqual(['<verified_menu_item_code>']);
    expect(plannerInput.planningExamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.stringContaining('mã giảm giá'),
          toolCalls: expect.arrayContaining([expect.objectContaining({ toolName: 'validateVoucher' })]),
        }),
        expect.objectContaining({
          user: expect.stringContaining('200 combo'),
          toolCalls: expect.arrayContaining([expect.objectContaining({ toolName: 'handoff' })]),
        }),
      ]),
    );
    const plannerExamplesAndSchema = JSON.stringify({
      toolArgumentExamples: plannerInput.toolArgumentExamples,
      planningExamples: plannerInput.planningExamples,
      outputSchema: plannerInput.outputSchema,
    });
    expect(`${plannerRequest.instructions}\n${plannerExamplesAndSchema}`).not.toMatch(
      /20751|20748|41141|41086|Combo Hợp Gu|Xô Cùng Tiệc|Burger Gà Zinger|Pepsi \(Lon\)|Known demo catalog codes|KFC50|KFC-MOCK-1001|Công ty ABC|0312345678|finance@abc/i,
    );
    expect(plannerRequest.instructions).toContain('Never infer catalog codes from examples.');
    expect(plannerRequest.instructions).toContain('ask for the order id');
    expect(plannerRequest.instructions).not.toContain('For demo replay');
  });

  it('rejects model output with an unknown tool name', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'ordering',
              entities: {},
              toolCalls: [{ toolName: 'fakeTool', arguments: {} }],
              responseClaims: [],
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'web_mock',
          latestUserMessage: 'Gọi món giúp mình',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planner proposed unknown tool: fakeTool');
  });

  it('rejects model output with an unavailable tool name', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'voucher',
              entities: {},
              toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 1 } }],
              responseClaims: [],
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'web_mock',
          latestUserMessage: 'Mình có mã KFC50',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planner proposed unavailable tool: validateVoucher');
  });

  it('rejects blank Responses output text', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ output_text: '   ' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'web_mock',
          latestUserMessage: 'Xin chào',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planning returned no text');
  });

  it('surfaces OpenAI HTTP error messages', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: 'bad request' } }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'web_mock',
          latestUserMessage: 'Xin chào',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planning failed: bad request');
  });
});
