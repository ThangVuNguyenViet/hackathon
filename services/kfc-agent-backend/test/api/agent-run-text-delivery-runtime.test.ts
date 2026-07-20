import { describe, expect, it, vi } from 'vitest';
import {
  deliverChannelAssistantReply,
  sendChannelTextWithAgentRunDelivery,
} from '../../src/api/agentRunTextDeliveryRuntime.js';
import type {
  ChannelTextOutcomeClient,
  ChannelTextSendOutcome,
} from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  AGENT_RUN_EXECUTION_LEASE_TTL_MS,
  agentRunExecutionFence,
} from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { textOnlyPresentation } from '../../src/presentation/channelPresentation.js';

async function claimedAgentRun(store: MemoryStore) {
  const run = await store.createAgentRun({
    id: 'delivery-runtime-run',
    sessionId: 'messenger:delivery-runtime-user',
    generation: 1,
    channel: 'messenger',
    externalUserId: 'delivery-runtime-user',
    status: 'scheduled',
    coalescedInputText: 'hello',
    deliveryStatus: 'pending',
    scheduledAt: new Date().toISOString(),
  });
  await store.setSessionAgentState({
    sessionId: run.sessionId,
    currentRunId: run.id,
    generation: run.generation,
    debounceDeadlineAt: null,
  });
  const claimedAt = new Date();
  const claimed = await store.claimAgentRunExecution({
    runId: run.id,
    sessionId: run.sessionId,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken: crypto.randomUUID(),
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + AGENT_RUN_EXECUTION_LEASE_TTL_MS,
    ).toISOString(),
  });
  if (claimed.status !== 'claimed') {
    throw new Error(`test_agent_run_claim_failed:${claimed.status}`);
  }
  const assistantTurn = await store.appendTurn({
    sessionId: run.sessionId,
    channel: 'messenger',
    role: 'assistant',
    text: 'Verified reply',
    externalMessageId: null,
    externalUserId: run.externalUserId,
    deliveryStatus: 'pending',
    metadata: null,
  });
  const fence = agentRunExecutionFence(claimed.run);
  const bound = await store.updateAgentRunIfExecutionCurrent({
    sessionId: run.sessionId,
    fence,
    patch: { assistantTurnId: assistantTurn.id },
  });
  if (bound.status !== 'committed') {
    throw new Error('test_agent_run_assistant_authority_failed');
  }
  return {
    run: bound.run,
    fence,
    assistantTurn,
  };
}

function outcomeClient(
  implementation: () =>
    | ChannelTextSendOutcome
    | Promise<ChannelTextSendOutcome>,
): ChannelTextOutcomeClient {
  return {
    sendTextWithOutcome: vi.fn(async () => implementation()),
  };
}

function channelClients(client: ChannelTextOutcomeClient) {
  return {
    messenger: {
      ...client,
      async sendText() {
        throw new Error('legacy_send_must_not_be_called');
      },
      async sendSenderAction(recipientId: string) {
        return {
          ok: true as const,
          value: { recipientId },
          message: 'sent',
        };
      },
      async getProfile() {
        return {
          ok: false as const,
          errorCode: 'not_needed',
          message: 'not needed',
        };
      },
    },
    zalo: {
      ...client,
      async sendText() {
        throw new Error('legacy_send_must_not_be_called');
      },
      async getProfile() {
        return {
          ok: false as const,
          errorCode: 'not_needed',
          message: 'not needed',
        };
      },
    },
  };
}

describe('AgentRun channel text delivery runtime', () => {
  it('fails closed without an AgentRun execution fence', async () => {
    const store = new MemoryStore();
    const client = outcomeClient(() => ({
      status: 'confirmed_sent',
      messageId: 'must-not-send',
    }));

    const result = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: 'recipient',
      text: 'reply',
      assistantTurnId: 'assistant-turn',
    });

    expect(result).toMatchObject({
      outcome: {
        status: 'not_dispatched',
        errorCode: 'agent_run_delivery_fence_required',
      },
    });
    expect(client.sendTextWithOutcome).not.toHaveBeenCalled();
  });

  it('persists sending authority before dispatch and never redispatches confirmed delivery', async () => {
    const store = new MemoryStore();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    const client = outcomeClient(() => ({
      status: 'confirmed_sent',
      messageId: 'provider-message-1',
    }));

    const first = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: run.externalUserId,
      text: assistantTurn.text,
      assistantTurnId: assistantTurn.id,
      commitFence: fence,
    });
    const replay = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: run.externalUserId,
      text: assistantTurn.text,
      assistantTurnId: assistantTurn.id,
      commitFence: fence,
    });

    expect(first).toMatchObject({
      outcome: {
        status: 'confirmed_sent',
        messageId: 'provider-message-1',
      },
      replayed: false,
    });
    expect(replay).toMatchObject({
      outcome: {
        status: 'confirmed_sent',
        messageId: 'provider-message-1',
      },
      replayed: true,
    });
    expect(client.sendTextWithOutcome).toHaveBeenCalledTimes(1);
    await expect(store.getAgentRunTextDelivery(run.id)).resolves
      .toMatchObject({
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-1',
      });
  });

  it('records an ambiguous provider outcome as reconciliation-required and never retries it', async () => {
    const store = new MemoryStore();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    const client = outcomeClient(() => ({
      status: 'delivery_outcome_unknown',
      errorCode: 'provider_timeout',
      message: 'The provider may have accepted the send',
    }));

    const first = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: run.externalUserId,
      text: assistantTurn.text,
      assistantTurnId: assistantTurn.id,
      commitFence: fence,
    });
    const replay = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: run.externalUserId,
      text: assistantTurn.text,
      assistantTurnId: assistantTurn.id,
      commitFence: fence,
    });

    expect(first.outcome.status).toBe('delivery_outcome_unknown');
    expect(replay.outcome.status).toBe('delivery_outcome_unknown');
    expect(client.sendTextWithOutcome).toHaveBeenCalledTimes(1);
    await expect(store.getAgentRun(run.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      errorCode: 'agent_run_delivery_outcome_unknown',
    });
  });

  it('converts a throwing custom transport into an ambiguous durable outcome', async () => {
    const store = new MemoryStore();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    const client = outcomeClient(() => {
      throw new Error('socket closed after request write');
    });

    const result = await sendChannelTextWithAgentRunDelivery({
      store,
      client,
      channel: 'messenger',
      recipientId: run.externalUserId,
      text: assistantTurn.text,
      assistantTurnId: assistantTurn.id,
      commitFence: fence,
    });

    expect(result.outcome).toMatchObject({
      status: 'delivery_outcome_unknown',
      errorCode: 'messenger_delivery_outcome_unknown',
    });
    await expect(store.getAgentRun(run.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
  });

  it('projects an ambiguous outcome explicitly instead of calling it failed', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    const client = outcomeClient(() => ({
      status: 'delivery_outcome_unknown',
      errorCode: 'provider_timeout',
      message: 'The provider may have accepted the send',
    }));

    const result = await deliverChannelAssistantReply({
      store,
      dashboard,
      delivery: {
        clients: channelClients(client),
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation: textOnlyPresentation(
          assistantTurn.text,
          'messenger',
        ),
        channel: 'messenger',
        assistantTurnId: assistantTurn.id,
        runGuard: {
          isCurrent: async () => true,
          commitFence: fence,
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'provider_timeout',
    });
    await expect(store.listTurns(run.sessionId)).resolves
      .toContainEqual(expect.objectContaining({
        id: assistantTurn.id,
        deliveryStatus: 'outcome_unknown',
      }));
    expect(
      dashboard.getEvents(run.sessionId).at(-1),
    ).toMatchObject({
      type: 'assistant_reply_sent',
      payload: {
        deliveryStatus: 'outcome_unknown',
        textDeliveryOutcome: 'delivery_outcome_unknown',
      },
    });
  });

  it('does not send when session ownership becomes stale before delivery', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    await store.setSessionAgentState({
      sessionId: run.sessionId,
      currentRunId: 'newer-run',
      generation: run.generation + 1,
      debounceDeadlineAt: null,
    });
    const client = outcomeClient(() => ({
      status: 'confirmed_sent',
      messageId: 'must-not-send',
    }));

    const result = await deliverChannelAssistantReply({
      store,
      dashboard,
      delivery: {
        clients: channelClients(client),
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation: textOnlyPresentation(
          assistantTurn.text,
          'messenger',
        ),
        channel: 'messenger',
        assistantTurnId: assistantTurn.id,
        runGuard: {
          isCurrent: async () => false,
          commitFence: fence,
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      suppressed: true,
      errorCode: 'stale_agent_run',
    });
    expect(client.sendTextWithOutcome).not.toHaveBeenCalled();
    await expect(store.getAgentRunTextDelivery(run.id)).resolves
      .toBeUndefined();
  });

  it('does not infer missing AgentRun authority from the latest pending assistant turn', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const { run, fence, assistantTurn } =
      await claimedAgentRun(store);
    const unrelatedLatest = await store.appendTurn({
      sessionId: run.sessionId,
      channel: run.channel,
      role: 'assistant',
      text: 'Unrelated latest assistant reply',
      externalMessageId: null,
      externalUserId: run.externalUserId,
      deliveryStatus: 'pending',
      metadata: null,
    });
    const client = outcomeClient(() => ({
      status: 'confirmed_sent',
      messageId: 'must-not-send',
    }));

    const result = await deliverChannelAssistantReply({
      store,
      dashboard,
      delivery: {
        clients: channelClients(client),
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation: textOnlyPresentation(
          unrelatedLatest.text,
          run.channel,
        ),
        channel: run.channel,
        assistantTurnId: '',
        runGuard: {
          isCurrent: async () => true,
          commitFence: fence,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errorCode: 'agent_run_delivery_assistant_authority_invalid',
      errorMessage:
        'AgentRun assistant delivery authority is invalid',
    });
    const mismatched = await deliverChannelAssistantReply({
      store,
      dashboard,
      delivery: {
        clients: channelClients(client),
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation: textOnlyPresentation(
          unrelatedLatest.text,
          run.channel,
        ),
        channel: run.channel,
        assistantTurnId: unrelatedLatest.id,
        runGuard: {
          isCurrent: async () => true,
          commitFence: fence,
        },
      },
    });
    expect(mismatched).toEqual({
      ok: false,
      errorCode: 'agent_run_delivery_assistant_authority_invalid',
      errorMessage:
        'AgentRun assistant delivery authority is invalid',
    });
    expect(client.sendTextWithOutcome).not.toHaveBeenCalled();
    await expect(store.getAgentRunTextDelivery(run.id)).resolves
      .toBeUndefined();
    await expect(store.getAgentRun(run.id)).resolves.toMatchObject({
      assistantTurnId: assistantTurn.id,
    });
    await expect(store.listTurns(run.sessionId)).resolves
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: assistantTurn.id,
          deliveryStatus: 'pending',
        }),
        expect.objectContaining({
          id: unrelatedLatest.id,
          deliveryStatus: 'pending',
        }),
      ]));
  });
});
