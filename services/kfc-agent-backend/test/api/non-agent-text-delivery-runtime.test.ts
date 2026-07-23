import { describe, expect, it, vi } from 'vitest';
import type {
  ChannelTextOutcomeClient,
  ChannelTextSendOutcome,
} from '../../src/clients/interfaces.js';
import { deliverNonAgentText } from '../../src/api/nonAgentTextDeliveryRuntime.js';
import {
  MemoryStore,
  type BeginNonAgentTextDeliveryAttemptInput,
  type CompleteNonAgentTextDeliveryAttemptInput,
  type ReserveNonAgentTextDeliveryInput,
} from '../../src/persistence/memoryStore.js';
import type {
  AppendConversationTurnInput,
} from '../../src/persistence/contracts.js';

class CapturingMemoryStore extends MemoryStore {
  requestKey: string | undefined;

  override async reserveNonAgentTextDelivery(
    input: ReserveNonAgentTextDeliveryInput,
  ) {
    this.requestKey = input.requestKey;
    return super.reserveNonAgentTextDelivery(input);
  }
}

class PausingBeginMemoryStore extends CapturingMemoryStore {
  private releaseBegin: (() => void) | undefined;
  private noteBeginStarted: () => void = () => undefined;
  readonly beginStarted = new Promise<void>((resolve) => {
    this.noteBeginStarted = resolve;
  });

  release(): void {
    this.releaseBegin?.();
  }

  override async beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ) {
    this.noteBeginStarted();
    await new Promise<void>((resolve) => {
      this.releaseBegin = resolve;
    });
    return super.beginNonAgentTextDeliveryAttempt(input);
  }
}

class FailingCompletionMemoryStore extends CapturingMemoryStore {
  private failed = false;

  override async completeNonAgentTextDeliveryAttempt(
    input: CompleteNonAgentTextDeliveryAttemptInput,
  ) {
    if (!this.failed) {
      this.failed = true;
      throw new Error('private database failure');
    }
    return super.completeNonAgentTextDeliveryAttempt(input);
  }
}

class FailingAppendMemoryStore extends CapturingMemoryStore {
  private failed = false;

  override async appendTurn(input: AppendConversationTurnInput) {
    if (!this.failed) {
      this.failed = true;
      throw new Error('private append failure');
    }
    return super.appendTurn(input);
  }
}

class PausingAppendMemoryStore extends CapturingMemoryStore {
  private releaseAppend: (() => void) | undefined;
  private noteAppendStarted: () => void = () => undefined;
  readonly appendStarted = new Promise<void>((resolve) => {
    this.noteAppendStarted = resolve;
  });

  release(): void {
    this.releaseAppend?.();
  }

  override async appendTurn(input: AppendConversationTurnInput) {
    this.noteAppendStarted();
    await new Promise<void>((resolve) => {
      this.releaseAppend = resolve;
    });
    return super.appendTurn(input);
  }
}

class CrashingAfterClaimMemoryStore extends CapturingMemoryStore {
  private crashed = false;

  override async beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ) {
    const result = await super.beginNonAgentTextDeliveryAttempt(input);
    if (!this.crashed && result.status === 'dispatch_authorized') {
      this.crashed = true;
      throw new Error('simulated process crash after dispatch claim');
    }
    return result;
  }
}

const baseInput = {
  channel: 'messenger' as const,
  sessionId: 'messenger:private-recipient',
  clientRequestId: 'dashboard-request-1',
  agentId: 'agent-private',
  expectedSessionAuthorityGeneration: 1,
  recipientId: 'private-recipient',
  text: 'Private human reply',
};

async function humanPaused<Store extends MemoryStore>(
  store: Store,
): Promise<Store> {
  await store.transitionSessionAuthority({
    sessionId: baseInput.sessionId,
    expectedGeneration: 0,
    agentMode: 'human_paused',
    assignedAgentId: baseInput.agentId,
  });
  return store;
}

describe('non-agent text delivery runtime', () => {
  it('replays confirmed delivery without redispatch and persists no raw binding data', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-1',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    const first = await deliverNonAgentText({ store, client, ...baseInput });
    const replay = await deliverNonAgentText({ store, client, ...baseInput });

    expect(first).toMatchObject({
      ok: true,
      created: true,
      replayed: false,
      externalMessageId: 'provider-message-1',
    });
    expect(replay).toMatchObject({
      ok: true,
      created: false,
      replayed: true,
      externalMessageId: 'provider-message-1',
      turn: { id: first.turn?.id },
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
    expect(await store.listTurns(baseInput.sessionId)).toHaveLength(1);

    const record = await store.getNonAgentTextDelivery(store.requestKey!);
    const persisted = JSON.stringify(record);
    expect(persisted).not.toContain(baseInput.text);
    expect(persisted).not.toContain(baseInput.agentId);
    expect(persisted).not.toContain(baseInput.sessionId);
    expect(record).not.toHaveProperty('recipientId');
    expect(record?.recipientBindingDigest).not.toBe(baseInput.recipientId);
    expect(record).toMatchObject({
      status: 'confirmed_sent',
      deliveryAttempt: 1,
      providerMessageId: 'provider-message-1',
    });
  });

  it('fails closed after an unknown provider outcome and never redispatches', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => {
      throw new Error('private provider timeout detail');
    });
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    const first = await deliverNonAgentText({ store, client, ...baseInput });
    const replay = await deliverNonAgentText({ store, client, ...baseInput });

    expect(first).toMatchObject({
      ok: false,
      created: true,
      replayed: false,
      errorCode: 'non_agent_delivery_outcome_unknown',
      turn: { deliveryStatus: 'outcome_unknown' },
    });
    expect(replay).toMatchObject({
      ok: false,
      created: false,
      replayed: true,
      errorCode: 'non_agent_delivery_outcome_unknown',
      turn: { id: first.turn?.id, deliveryStatus: 'outcome_unknown' },
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
    const record = await store.getNonAgentTextDelivery(store.requestKey!);
    expect(JSON.stringify(record)).not.toContain(
      'private provider timeout detail',
    );
  });

  it('authorizes only one concurrent dispatcher', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    let resolveOutcome:
      | ((outcome: ChannelTextSendOutcome) => void)
      | undefined;
    const sendTextWithOutcome = vi.fn(
      () =>
        new Promise<ChannelTextSendOutcome>((resolve) => {
          resolveOutcome = resolve;
        }),
    );
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    const owner = deliverNonAgentText({ store, client, ...baseInput });
    await vi.waitFor(() => expect(sendTextWithOutcome).toHaveBeenCalledOnce());
    const duplicate = await deliverNonAgentText({
      store,
      client,
      ...baseInput,
    });
    expect(duplicate).toMatchObject({
      ok: false,
      replayed: true,
      errorCode: 'human_message_delivery_in_progress',
    });
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({ status: 'sending', deliveryAttempt: 1 });

    resolveOutcome?.({
      status: 'confirmed_sent',
      messageId: 'provider-message-1',
    });
    await expect(owner).resolves.toMatchObject({ ok: true });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('retries only a confirmed-not-sent outcome', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    const sendTextWithOutcome = vi
      .fn<ChannelTextOutcomeClient['sendTextWithOutcome']>()
      .mockResolvedValueOnce({
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected',
        message: 'not sent',
      })
      .mockResolvedValueOnce({
        status: 'confirmed_sent',
        messageId: 'provider-message-2',
      });
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'non_agent_delivery_confirmed_not_sent',
      turn: { deliveryStatus: 'failed' },
    });
    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: true,
      externalMessageId: 'provider-message-2',
      turn: { deliveryStatus: 'sent' },
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(2);
    expect(await store.listTurns(baseInput.sessionId)).toHaveLength(1);
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({ status: 'confirmed_sent', deliveryAttempt: 2 });
  });

  it('keeps append failures pending and retries without duplicate turns', async () => {
    const store = await humanPaused(new FailingAppendMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-after-append-retry',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'human_message_turn_persistence_failed',
    });
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({
        status: 'pending',
        deliveryAttempt: 0,
      });
    expect(await store.listTurns(baseInput.sessionId)).toEqual([]);
    expect(sendTextWithOutcome).not.toHaveBeenCalled();

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: true,
      externalMessageId: 'provider-message-after-append-retry',
    });
    expect(await store.listTurns(baseInput.sessionId)).toHaveLength(1);
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing-client reservation pending and recoverable', async () => {
    const store = await humanPaused(new CapturingMemoryStore());

    await expect(
      deliverNonAgentText({ store, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'human_message_delivery_client_missing',
    });
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({
        status: 'pending',
        deliveryAttempt: 0,
      });
    expect(await store.listTurns(baseInput.sessionId)).toEqual([]);

    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-after-client-preflight',
    }));
    await expect(deliverNonAgentText({
      store,
      client: { sendTextWithOutcome },
      ...baseInput,
    })).resolves.toMatchObject({ ok: true });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
    expect(await store.listTurns(baseInput.sessionId)).toHaveLength(1);
  });

  it('serializes prepared-turn append with reset and leaves no stale turn', async () => {
    const store = await humanPaused(new PausingAppendMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'must-not-be-sent',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };
    const publication = deliverNonAgentText({ store, client, ...baseInput });
    await store.appendStarted;

    let resetSettled = false;
    const reset = store.resetSession(baseInput.sessionId).finally(() => {
      resetSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resetSettled).toBe(false);

    store.release();
    await expect(reset).resolves.toMatchObject({ agentMode: 'ai_active' });
    await expect(publication).resolves.toMatchObject({
      ok: false,
      errorCode: 'non_agent_delivery_abandoned_by_reset',
    });
    expect(await store.listTurns(baseInput.sessionId)).toEqual([]);
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({
        status: 'confirmed_not_sent',
        deliveryAttempt: 0,
        outcomeCode: 'non_agent_delivery_abandoned_by_reset',
      });
    expect(sendTextWithOutcome).not.toHaveBeenCalled();
  });

  it('never redispatches after a crash between claim and provider invocation', async () => {
    const store = await humanPaused(new CrashingAfterClaimMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'must-not-be-sent',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).rejects.toThrow('simulated process crash after dispatch claim');
    const sending = await store.getNonAgentTextDelivery(store.requestKey!);
    expect(sending).toMatchObject({
      status: 'sending',
      deliveryAttempt: 1,
    });
    expect(await store.listTurns(baseInput.sessionId)).toHaveLength(1);
    expect(sendTextWithOutcome).not.toHaveBeenCalled();
    await expect(store.resetSession(baseInput.sessionId)).rejects
      .toMatchObject({ code: 'session_reset_conflict' });
    if (!sending || sending.status !== 'sending') {
      throw new Error('expected sending delivery after simulated crash');
    }
    await expect(store.reconcileNonAgentTextDelivery({
      requestKey: sending.requestKey,
      sessionId: baseInput.sessionId,
      deliveryAttempt: sending.deliveryAttempt,
      deliveryAttemptToken: sending.deliveryAttemptToken,
      reason: 'sending_lease_expired',
      reconciledAt: '2099-07-20T00:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'reconciled',
      record: { status: 'outcome_unknown' },
    });
    await store.resetSession(baseInput.sessionId);

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      replayed: true,
      turn: undefined,
    });
    expect(sendTextWithOutcome).not.toHaveBeenCalled();
  });

  it('rejects reuse of a request ID with a different binding', async () => {
    const store = await humanPaused(new MemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-1',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };
    await deliverNonAgentText({ store, client, ...baseInput });

    await expect(deliverNonAgentText({
      store,
      client,
      ...baseInput,
      text: 'Different text',
    })).resolves.toMatchObject({
      ok: false,
      created: false,
      replayed: false,
      errorCode: 'human_message_idempotency_conflict',
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('replays a terminal journal after reset without requiring the deleted turn', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-1',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };
    await deliverNonAgentText({ store, client, ...baseInput });
    await store.resetSession(baseInput.sessionId);

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      externalMessageId: 'provider-message-1',
      turn: undefined,
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('abandons a crash-before-dispatch reservation during reset', async () => {
    const store = await humanPaused(new PausingBeginMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-1',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };
    const publication = deliverNonAgentText({ store, client, ...baseInput });
    await store.beginStarted;

    await expect(store.resetSession(baseInput.sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
    });
    expect(await store.getNonAgentTextDelivery(store.requestKey!))
      .toMatchObject({
        status: 'confirmed_not_sent',
        deliveryAttempt: 0,
        outcomeCode: 'non_agent_delivery_abandoned_by_reset',
      });
    store.release();
    await expect(publication).resolves.toMatchObject({
      ok: false,
      errorCode: 'non_agent_delivery_abandoned_by_reset',
    });
    expect(sendTextWithOutcome).not.toHaveBeenCalled();
  });

  it('blocks reset during an active send and preserves the terminal journal', async () => {
    const store = await humanPaused(new CapturingMemoryStore());
    let resolveOutcome:
      | ((outcome: ChannelTextSendOutcome) => void)
      | undefined;
    const sendTextWithOutcome = vi.fn(
      () =>
        new Promise<ChannelTextSendOutcome>((resolve) => {
          resolveOutcome = resolve;
        }),
    );
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };
    const publication = deliverNonAgentText({ store, client, ...baseInput });
    await vi.waitFor(() => expect(sendTextWithOutcome).toHaveBeenCalledOnce());

    await expect(store.resetSession(baseInput.sessionId)).rejects.toMatchObject({
      code: 'session_reset_conflict',
    });
    resolveOutcome?.({
      status: 'confirmed_sent',
      messageId: 'provider-message-1',
    });
    await expect(publication).resolves.toMatchObject({ ok: true });
    await store.resetSession(baseInput.sessionId);
    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({ ok: true, replayed: true, turn: undefined });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('reconciles completion persistence failure to unknown and never redispatches', async () => {
    const store = await humanPaused(new FailingCompletionMemoryStore());
    const sendTextWithOutcome = vi.fn(async () => ({
      status: 'confirmed_sent' as const,
      messageId: 'provider-message-1',
    }));
    const client: ChannelTextOutcomeClient = { sendTextWithOutcome };

    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      replayed: true,
      errorCode: 'non_agent_delivery_completion_persistence_failed',
    });
    await expect(
      deliverNonAgentText({ store, client, ...baseInput }),
    ).resolves.toMatchObject({
      ok: false,
      replayed: true,
      errorCode: 'non_agent_delivery_completion_persistence_failed',
    });
    expect(sendTextWithOutcome).toHaveBeenCalledTimes(1);
  });
});
