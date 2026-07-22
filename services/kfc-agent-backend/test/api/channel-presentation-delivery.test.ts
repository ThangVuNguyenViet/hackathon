import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { createRouteHandlers } from '../../src/api/routeHandlers.js';
import { agentRunExecutionFence } from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { groundedResponseModelReply } from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

function directAgent(responseText: string): OpenAiKfcAgent {
  return new OpenAiKfcAgent({
    client: {
      responses: {
        create: async () => ({ output: [], output_text: responseText }),
      },
    },
    model: 'gpt-4.1-mini',
  });
}

describe('channel presentation delivery compatibility', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs Messenger agent turns through the configured direct Responses agent', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:direct_responses_user';
    const externalUserId = 'direct_responses_user';
    const externalMessageId = 'mid_direct_responses';
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_direct_responses',
      sessionId,
      channel: 'messenger',
      externalMessageId,
      externalUserId,
      text: 'Gợi ý món gà.',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-22T00:00:00.000Z',
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: externalMessageId,
      externalThreadId: externalUserId,
      externalUserId,
      sessionId,
      receivedAt: pending.turn.receivedAt,
      payload: {
        eventType: 'message',
        text: pending.turn.text,
        receivedAt: pending.turn.receivedAt,
      },
    });
    await store.createAgentRun({
      id: 'run_direct_responses',
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId,
      status: 'scheduled',
      coalescedInputText: pending.turn.text,
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-22T00:00:01.000Z',
    });
    await store.linkAgentRunTurn({
      runId: 'run_direct_responses',
      turnId: pending.turn.turnId,
      sequence: 0,
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: 'run_direct_responses',
      generation: 1,
      debounceDeadlineAt: null,
    });
    const requests: Array<Record<string, unknown>> = [];
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request) => {
            requests.push(request);
            return {
              output: [],
              output_text: 'Mình gợi ý món gà phù hợp nhé.',
              usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });
    const messengerFetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.body) {
          return Response.json({ first_name: 'Direct', last_name: 'User' });
        }
        const body = JSON.parse(String(init.body)) as {
          message?: { text?: string };
        };
        return Response.json(
          body.message
            ? { message_id: 'mid_direct_responses_reply' }
            : { recipient_id: externalUserId },
        );
      },
    );
    const handlers = createRouteHandlers({
      store,
      fixtures: createTestFixtures(),
      openAiAgent,
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });

    await expect(
      handlers.processMessengerAgentRun('run_direct_responses'),
    ).resolves.toEqual({ status: 'processed' });
    expect(requests).toHaveLength(1);
    await expect(
      store.getAgentRun('run_direct_responses'),
    ).resolves.toMatchObject({
      status: 'completed',
      deliveryStatus: 'sent',
      deliveryExternalMessageId: 'mid_direct_responses_reply',
    });
    expect(
      (await store.listTurns(sessionId)).map((turn) => ({
        role: turn.role,
        text: turn.text,
        deliveryStatus: turn.deliveryStatus,
      })),
    ).toEqual([
      {
        role: 'user',
        text: 'Gợi ý món gà.',
        deliveryStatus: 'received',
      },
      {
        role: 'assistant',
        text: 'Mình gợi ý món gà phù hợp nhé.',
        deliveryStatus: 'sent',
      },
    ]);
  });

  it('suppresses a stale agent run before its presentation is delivered', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            !init?.body
              ? { first_name: 'Stale', last_name: 'User' }
              : typeof (
                    JSON.parse(String(init.body)) as {
                      sender_action?: unknown;
                    }
                  ).sender_action === 'string'
                ? { recipient_id: 'stale_user' }
                : { message_id: 'must_not_send' },
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_stale_1',
      sessionId: 'messenger:stale_user',
      channel: 'messenger',
      externalMessageId: 'mid_stale_1',
      externalUserId: 'stale_user',
      text: 'Tin nhắn cũ',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-11T00:00:00.000Z',
    });
    await store.createAgentRun({
      id: 'run_stale_1',
      sessionId: 'messenger:stale_user',
      generation: 1,
      channel: 'messenger',
      externalUserId: 'stale_user',
      status: 'scheduled',
      coalescedInputText: 'Tin nhắn cũ',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-11T00:00:01.000Z',
    });
    await store.linkAgentRunTurn({
      runId: 'run_stale_1',
      turnId: pending.turn.turnId,
      sequence: 0,
    });
    await store.setSessionAgentState({
      sessionId: 'messenger:stale_user',
      currentRunId: 'run_stale_1',
      generation: 1,
      debounceDeadlineAt: '2026-07-11T00:00:01.000Z',
    });

    const appendTurn = store.appendTurn.bind(store);
    vi.spyOn(store, 'appendTurn').mockImplementation(async (input) => {
      const result = await appendTurn(input);
      if (input.role === 'assistant') {
        await store.setSessionAgentState({
          sessionId: 'messenger:stale_user',
          currentRunId: 'run_newer',
          generation: 2,
          debounceDeadlineAt: '2026-07-11T00:00:02.000Z',
        });
      }
      return result;
    });
    const handlers = createRouteHandlers({
      store,
      fixtures: createTestFixtures(),
      openAiAgent: directAgent('Phản hồi của lượt cũ.'),
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });

    await expect(
      handlers.processMessengerAgentRun('run_stale_1'),
    ).resolves.toMatchObject({
      status: 'skipped',
      errorCode: 'stale_agent_run',
    });
    expect(messengerFetchImpl).toHaveBeenCalledTimes(4);
    expect(
      messengerFetchImpl.mock.calls
        .filter(([, init]) => typeof init?.body === 'string')
        .map(([, init]) => {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          expect(body.message).toBeUndefined();
          return body.sender_action;
        }),
    ).toEqual(['mark_seen', 'typing_on', 'typing_off']);
    await expect(store.getAgentRun('run_stale_1')).resolves.toMatchObject({
      status: 'superseded',
      deliveryStatus: 'suppressed',
    });
    expect(
      handlers.dashboard
        .getEvents('messenger:stale_user')
        .some((event) => event.type === 'agent_run_delivery_suppressed'),
    ).toBe(true);
  });

  it('does not persist raw provider delivery errors in AgentRun state', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:redacted_delivery_user';
    const externalUserId = 'redacted_delivery_user';
    const externalMessageId = 'mid_redacted_delivery';
    const providerSentinel =
      'RAW_PROVIDER_SENTINEL bearer=provider-secret customer=private';
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_redacted_delivery',
      sessionId,
      channel: 'messenger',
      externalMessageId,
      externalUserId,
      text: 'Cho mình xem thực đơn.',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-20T06:00:00.000Z',
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: externalMessageId,
      externalThreadId: externalUserId,
      externalUserId,
      sessionId,
      receivedAt: pending.turn.receivedAt,
      payload: {
        eventType: 'message',
        text: pending.turn.text,
        receivedAt: pending.turn.receivedAt,
      },
    });
    await store.createAgentRun({
      id: 'run_redacted_delivery',
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId,
      status: 'scheduled',
      coalescedInputText: pending.turn.text,
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-20T06:00:01.000Z',
    });
    await store.linkAgentRunTurn({
      runId: 'run_redacted_delivery',
      turnId: pending.turn.turnId,
      sequence: 0,
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: 'run_redacted_delivery',
      generation: 1,
      debounceDeadlineAt: null,
    });
    const messengerFetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.body) {
          return new Response(
            JSON.stringify({
              first_name: 'Delivery',
              last_name: 'Failure',
            }),
            { status: 200 },
          );
        }
        const body = JSON.parse(String(init.body)) as {
          sender_action?: string;
          message?: { text?: string };
        };
        if (body.message) {
          return new Response(
            JSON.stringify({
              error: {
                code: 123,
                message: providerSentinel,
              },
            }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ recipient_id: externalUserId }), {
          status: 200,
        });
      },
    );
    const handlers = createRouteHandlers({
      store,
      fixtures: createTestFixtures(),
      openAiAgent: directAgent('Đây là thực đơn hiện có.'),
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });

    await expect(
      handlers.processMessengerAgentRun('run_redacted_delivery'),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'messenger_send_failed',
      errorMessage: providerSentinel,
    });
    const persistedRun = await store.getAgentRun('run_redacted_delivery');
    expect(persistedRun).toMatchObject({
      status: 'failed',
      deliveryStatus: 'failed',
      errorCode: 'assistant_reply_delivery_failed',
      errorMessage: 'Assistant reply delivery failed',
    });
    expect(JSON.stringify(persistedRun)).not.toContain(providerSentinel);
    const webhookDelivery = await store.getWebhookDelivery(
      'messenger',
      externalMessageId,
    );
    expect(webhookDelivery).toMatchObject({
      status: 'failed',
      lastError: 'messenger_send_failed',
    });
    expect(JSON.stringify(webhookDelivery)).not.toContain(providerSentinel);
  });

  it('redacts unexpected AgentRun processing errors from durable state and results', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:redacted_processing_user';
    const externalUserId = 'redacted_processing_user';
    const providerSentinel = 'PROCESSING_SECRET bearer=private-upstream-token';
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_redacted_processing',
      sessionId,
      channel: 'messenger',
      externalMessageId: 'mid_redacted_processing',
      externalUserId,
      text: 'Cho mình xem thực đơn.',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-20T06:00:00.000Z',
    });
    await store.createAgentRun({
      id: 'run_redacted_processing',
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId,
      status: 'scheduled',
      coalescedInputText: pending.turn.text,
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-20T06:00:01.000Z',
    });
    await store.linkAgentRunTurn({
      runId: 'run_redacted_processing',
      turnId: pending.turn.turnId,
      sequence: 0,
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: 'run_redacted_processing',
      generation: 1,
      debounceDeadlineAt: null,
    });
    vi.spyOn(store, 'findTurnByExternalMessage').mockRejectedValueOnce(
      new Error(providerSentinel),
    );
    const messengerFetchImpl = vi.fn();
    const handlers = createRouteHandlers({
      store,
      checkpointer: new MemorySaver(),
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      ...testAgent(
        fakeModel().respond(
          groundedResponseModelReply({
            customerText: 'This model must not be invoked.',
          }),
        ),
      ),
    });

    const result = await handlers.processMessengerAgentRun(
      'run_redacted_processing',
    );
    expect(result).toEqual({
      status: 'failed',
      errorCode: 'agent_run_processing_failed',
      errorMessage: 'Agent run processing failed',
    });
    const persistedRun = await store.getAgentRun('run_redacted_processing');
    expect(persistedRun).toMatchObject({
      status: 'failed',
      deliveryStatus: 'failed',
      errorCode: 'agent_run_processing_failed',
      errorMessage: 'Agent run processing failed',
    });
    await expect(store.listPendingCustomerTurns(sessionId)).resolves.toEqual([
      expect.objectContaining({
        turnId: pending.turn.turnId,
        status: 'ignored',
        claimedRunId: 'run_redacted_processing',
      }),
    ]);
    expect(messengerFetchImpl).not.toHaveBeenCalled();
    expect(
      JSON.stringify({
        result,
        persistedRun,
        events: handlers.dashboard.getEvents(sessionId),
      }),
    ).not.toContain(providerSentinel);
  });

  it('reclaims the exact AgentRun assistant authority without rerunning the model before delivery intent creation', async () => {
    const initialNow = Date.parse('2026-07-20T06:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(initialNow);
    const store = new MemoryStore();
    const sessionId = 'messenger:pre_intent_reclaim';
    const externalUserId = 'pre_intent_reclaim';
    const externalMessageId = 'mid_pre_intent_reclaim';
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_pre_intent_reclaim',
      sessionId,
      channel: 'messenger',
      externalMessageId,
      externalUserId,
      text: 'Cho mình xem thực đơn.',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: new Date(Date.now() - 180_000).toISOString(),
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: externalMessageId,
      externalThreadId: externalUserId,
      externalUserId,
      sessionId,
      receivedAt: pending.turn.receivedAt,
      payload: {
        eventType: 'message',
        text: pending.turn.text,
        receivedAt: pending.turn.receivedAt,
      },
    });
    await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'user',
      text: pending.turn.text,
      externalMessageId,
      externalUserId,
      deliveryStatus: 'received',
      metadata: null,
      createdAt: pending.turn.receivedAt,
    });
    const assistantTurn = await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Đây là phản hồi đã được tạo và lưu bền vững.',
      externalMessageId: null,
      externalUserId,
      deliveryStatus: 'pending',
      metadata: null,
    });
    await store.createAgentRun({
      id: 'run_pre_intent_reclaim',
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId,
      status: 'scheduled',
      coalescedInputText: pending.turn.text,
      deliveryStatus: 'pending',
      scheduledAt: new Date(Date.now() - 170_000).toISOString(),
    });
    await store.linkAgentRunTurn({
      runId: 'run_pre_intent_reclaim',
      turnId: pending.turn.turnId,
      sequence: 0,
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: 'run_pre_intent_reclaim',
      generation: 1,
      debounceDeadlineAt: null,
    });
    const firstClaim = await store.claimAgentRunExecution({
      runId: 'run_pre_intent_reclaim',
      sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: new Date().toISOString(),
      executionLeaseToken: '00000000-0000-4000-8000-000000000071',
      executionLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    if (firstClaim.status !== 'claimed') {
      throw new Error('test_first_execution_claim_failed');
    }
    await expect(
      store.updateAgentRunIfExecutionCurrent({
        sessionId,
        fence: agentRunExecutionFence(firstClaim.run),
        patch: { assistantTurnId: assistantTurn.id },
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    vi.setSystemTime(initialNow + 120_000);
    await expect(
      store.getAgentRunTextDelivery('run_pre_intent_reclaim'),
    ).resolves.toBeUndefined();

    const messengerFetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.body) {
          return new Response(
            JSON.stringify({
              first_name: 'Pre-intent',
              last_name: 'Recovery',
            }),
            { status: 200 },
          );
        }
        const body = JSON.parse(String(init.body)) as {
          sender_action?: string;
          message?: { text?: string };
        };
        return new Response(
          JSON.stringify(
            body.message
              ? { message_id: 'mid_pre_intent_reply' }
              : { recipient_id: externalUserId },
          ),
          { status: 200 },
        );
      },
    );
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'This response must not be invoked.',
      }),
    );
    const modelInvoke = vi.spyOn(model, 'invoke');
    const handlers = createRouteHandlers({
      store,
      checkpointer: new MemorySaver(),
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      ...testAgent(model),
    });

    const recovered = await handlers.processMessengerAgentRun(
      'run_pre_intent_reclaim',
    );
    expect(recovered).toEqual({ status: 'processed' });
    expect(modelInvoke).not.toHaveBeenCalled();
    expect(
      messengerFetchImpl.mock.calls
        .map(([, init]) =>
          init?.body
            ? (JSON.parse(String(init.body)) as {
                message?: { text?: string };
              })
            : {},
        )
        .find((body) => body.message)?.message?.text,
    ).toBe(assistantTurn.text);
    await expect(
      store.getAgentRun('run_pre_intent_reclaim'),
    ).resolves.toMatchObject({
      status: 'completed',
      executionAttempt: 2,
      assistantTurnId: assistantTurn.id,
      deliveryStatus: 'sent',
    });
    await expect(
      store.getAgentRunTextDelivery('run_pre_intent_reclaim'),
    ).resolves.toMatchObject({
      assistantTurnId: assistantTurn.id,
      status: 'confirmed_sent',
      providerMessageId: 'mid_pre_intent_reply',
      runExecutionAttempt: 2,
    });
    expect(
      (await store.listTurns(sessionId)).filter(
        (turn) => turn.role === 'assistant',
      ),
    ).toEqual([
      expect.objectContaining({
        id: assistantTurn.id,
        text: assistantTurn.text,
        deliveryStatus: 'sent',
      }),
    ]);
  });
});
