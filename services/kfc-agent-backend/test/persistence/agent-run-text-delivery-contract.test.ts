import { describe, expect, it } from 'vitest';
import type {
  ChannelTextSendOutcome,
} from '../../src/clients/interfaces.js';
import {
  agentRunTextDeliveryRecordSchema,
  beginAgentRunTextDeliveryAttempt,
  completeAgentRunTextDeliveryAttempt,
  createPendingAgentRunTextDelivery,
  MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS,
  rebindRetryableAgentRunTextDelivery,
  type AgentRunTextDeliveryExecutionBinding,
  type AgentRunTextDeliveryRecord,
} from '../../src/persistence/agentRunTextDelivery.js';

const createdAt = '2026-07-20T02:00:00.000Z';
const firstAttemptAt = '2026-07-20T02:00:01.000Z';
const firstOutcomeAt = '2026-07-20T02:00:02.000Z';
const secondAttemptAt = '2026-07-20T02:00:03.000Z';
const execution: AgentRunTextDeliveryExecutionBinding = {
  runId: 'agent-run-delivery-1',
  executionAttempt: 2,
  executionLeaseToken: 'run-execution-lease-token-2',
};
const reboundExecution: AgentRunTextDeliveryExecutionBinding = {
  runId: execution.runId,
  executionAttempt: execution.executionAttempt + 1,
  executionLeaseToken: 'run-execution-lease-token-3',
};

function rebindInput(
  overrides: Partial<Parameters<
    typeof rebindRetryableAgentRunTextDelivery
  >[1]> = {},
) {
  return {
    execution: reboundExecution,
    channel: 'messenger' as const,
    assistantTurnId: 'assistant-turn-1',
    recipientId: 'private-recipient-sentinel',
    presentationText: 'Private presentation sentinel',
    updatedAt: secondAttemptAt,
    ...overrides,
  };
}

async function pendingDelivery() {
  return createPendingAgentRunTextDelivery({
    execution,
    channel: 'messenger',
    assistantTurnId: 'assistant-turn-1',
    recipientId: 'private-recipient-sentinel',
    presentationText: 'Private presentation sentinel',
    createdAt,
  });
}

async function sendingDelivery() {
  const pending = await pendingDelivery();
  const result = beginAgentRunTextDeliveryAttempt(pending, {
    execution,
    nextDeliveryAttempt: 1,
    deliveryAttemptToken: 'delivery-attempt-token-1',
    updatedAt: firstAttemptAt,
  });
  if (result.status !== 'dispatch_authorized') {
    throw new Error(`test_sending_transition_failed:${result.reason}`);
  }
  return result.record;
}

async function completedDelivery(
  outcome: ChannelTextSendOutcome,
) {
  const sending = await sendingDelivery();
  const result = completeAgentRunTextDeliveryAttempt(sending, {
    execution,
    deliveryAttempt: 1,
    deliveryAttemptToken: 'delivery-attempt-token-1',
    outcome,
    updatedAt: firstOutcomeAt,
  });
  if (result.status !== 'transitioned') {
    throw new Error(`test_completion_transition_failed:${result.reason}`);
  }
  return result.record;
}

describe('durable AgentRun text-delivery contract', () => {
  it('persists only domain-separated binding digests, never raw recipient or presentation data', async () => {
    const record = await pendingDelivery();
    const replay = await pendingDelivery();
    const changedRecipient = await createPendingAgentRunTextDelivery({
      execution,
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'different-private-recipient',
      presentationText: 'Private presentation sentinel',
      createdAt,
    });
    const changedPresentation = await createPendingAgentRunTextDelivery({
      execution,
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient-sentinel',
      presentationText: 'Different private presentation',
      createdAt,
    });

    expect(record).toEqual(replay);
    expect(record).toMatchObject({
      status: 'pending',
      deliveryAttempt: 0,
      deliveryAttemptToken: null,
      priorDeliveryAttemptTokens: [],
      providerMessageId: null,
      outcomeCode: null,
    });
    expect(record.recipientBindingDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.presentationBindingDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.deliveryBindingDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(record)).not.toContain(
      'private-recipient-sentinel',
    );
    expect(JSON.stringify(record)).not.toContain(
      'Private presentation sentinel',
    );
    expect(changedRecipient.recipientBindingDigest).not.toBe(
      record.recipientBindingDigest,
    );
    expect(changedRecipient.presentationBindingDigest).toBe(
      record.presentationBindingDigest,
    );
    expect(changedRecipient.deliveryBindingDigest).not.toBe(
      record.deliveryBindingDigest,
    );
    expect(changedPresentation.presentationBindingDigest).not.toBe(
      record.presentationBindingDigest,
    );
    expect(changedPresentation.deliveryBindingDigest).not.toBe(
      record.deliveryBindingDigest,
    );
  });

  it('strictly rejects impossible durable states and raw-data extensions', async () => {
    const pending = await pendingDelivery();

    expect(agentRunTextDeliveryRecordSchema.safeParse({
      ...pending,
      recipientId: 'must-not-be-durable',
    }).success).toBe(false);
    expect(agentRunTextDeliveryRecordSchema.safeParse({
      ...pending,
      deliveryAttempt: 1,
    }).success).toBe(false);
    expect(agentRunTextDeliveryRecordSchema.safeParse({
      ...pending,
      status: 'confirmed_sent',
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      priorDeliveryAttemptTokens: [],
      providerMessageId: '   ',
    }).success).toBe(false);
  });

  it('authorizes the first pending attempt without mutating the input record', async () => {
    const pending = Object.freeze(await pendingDelivery());

    const result = beginAgentRunTextDeliveryAttempt(pending, {
      execution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: firstAttemptAt,
    });

    expect(result).toEqual({
      status: 'dispatch_authorized',
      record: {
        ...pending,
        status: 'sending',
        deliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-attempt-token-1',
        lastDeliveryRunExecutionAttempt: execution.executionAttempt,
        updatedAt: firstAttemptAt,
      },
    });
    expect(pending.status).toBe('pending');
  });

  it.each([
    [
      'run id',
      { ...execution, runId: 'different-run' },
    ],
    [
      'execution attempt',
      { ...execution, executionAttempt: execution.executionAttempt + 1 },
    ],
    [
      'execution lease token',
      { ...execution, executionLeaseToken: 'different-run-lease' },
    ],
  ] satisfies Array<[
    string,
    AgentRunTextDeliveryExecutionBinding,
  ]>)(
    'blocks dispatch when exact %s authority does not match',
    async (_field, wrongExecution) => {
      const pending = await pendingDelivery();

      expect(beginAgentRunTextDeliveryAttempt(pending, {
        execution: wrongExecution,
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-attempt-token-1',
        updatedAt: firstAttemptAt,
      })).toEqual({
        status: 'dispatch_blocked',
        reason: 'execution_binding_mismatch',
      });
    },
  );

  it.each([
    ['same attempt', 0, 'delivery-attempt-token-1', 'delivery_attempt_not_next'],
    ['skipped attempt', 2, 'delivery-attempt-token-1', 'delivery_attempt_not_next'],
    ['blank token', 1, '   ', 'delivery_attempt_token_invalid'],
    [
      'run lease reused as delivery token',
      1,
      execution.executionLeaseToken,
      'delivery_attempt_token_invalid',
    ],
  ] as const)(
    'blocks an invalid pending dispatch claim: %s',
    async (_case, nextDeliveryAttempt, deliveryAttemptToken, reason) => {
      const pending = await pendingDelivery();

      expect(beginAgentRunTextDeliveryAttempt(pending, {
        execution,
        nextDeliveryAttempt,
        deliveryAttemptToken,
        updatedAt: firstAttemptAt,
      })).toEqual({
        status: 'dispatch_blocked',
        reason,
      });
    },
  );

  it('allows retry only after confirmed-not-sent with the next attempt and a new opaque token', async () => {
    const rejected = await completedDelivery({
      status: 'confirmed_not_sent',
      errorCode: 'provider_rejected',
      message: 'Definitively not sent',
    });

    expect(beginAgentRunTextDeliveryAttempt(rejected, {
      execution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-2',
      updatedAt: secondAttemptAt,
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    expect(beginAgentRunTextDeliveryAttempt(rejected, {
      execution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: secondAttemptAt,
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    const rebound = await rebindRetryableAgentRunTextDelivery(
      rejected,
      rebindInput(),
    );
    if (rebound.status !== 'rebound') {
      throw new Error(`test_delivery_rebind_failed:${rebound.reason}`);
    }
    expect(beginAgentRunTextDeliveryAttempt(rebound.record, {
      execution: reboundExecution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    expect(beginAgentRunTextDeliveryAttempt(rebound.record, {
      execution: reboundExecution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-attempt-token-2',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        status: 'sending',
        deliveryAttempt: 2,
        deliveryAttemptToken: 'delivery-attempt-token-2',
      },
    });
  });

  it('caps confirmed-not-sent retries at three delivery attempts', async () => {
    expect(MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS).toBe(3);
    const originExecution: AgentRunTextDeliveryExecutionBinding = {
      runId: 'agent-run-max-delivery-attempts',
      executionAttempt: 1,
      executionLeaseToken: 'max-attempts-execution-lease-1',
    };
    let record: AgentRunTextDeliveryRecord =
      await createPendingAgentRunTextDelivery({
        execution: originExecution,
        channel: 'messenger',
        assistantTurnId: 'assistant-turn-max-attempts',
        recipientId: 'private-recipient-max-attempts',
        presentationText: 'Private presentation max attempts',
        createdAt,
      });
    let activeExecution = originExecution;

    for (
      let deliveryAttempt = 1;
      deliveryAttempt <= MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS;
      deliveryAttempt += 1
    ) {
      if (deliveryAttempt > 1) {
        activeExecution = {
          ...originExecution,
          executionAttempt: deliveryAttempt,
          executionLeaseToken:
            `max-attempts-execution-lease-${deliveryAttempt}`,
        };
        const rebound = await rebindRetryableAgentRunTextDelivery(
          record,
          {
            execution: activeExecution,
            channel: 'messenger',
            assistantTurnId: 'assistant-turn-max-attempts',
            recipientId: 'private-recipient-max-attempts',
            presentationText: 'Private presentation max attempts',
            updatedAt:
              `2026-07-20T02:00:0${deliveryAttempt * 3 - 3}.000Z`,
          },
        );
        if (rebound.status !== 'rebound') {
          throw new Error(
            `test_delivery_rebind_${deliveryAttempt}_failed:${rebound.reason}`,
          );
        }
        record = rebound.record;
      }
      const sending = beginAgentRunTextDeliveryAttempt(record, {
        execution: activeExecution,
        nextDeliveryAttempt: deliveryAttempt,
        deliveryAttemptToken:
          `delivery-attempt-token-${deliveryAttempt}`,
        updatedAt:
          `2026-07-20T02:00:0${deliveryAttempt * 3 - 2}.000Z`,
      });
      if (sending.status !== 'dispatch_authorized') {
        throw new Error(
          `test_delivery_attempt_${deliveryAttempt}_failed:${sending.reason}`,
        );
      }
      const completed = completeAgentRunTextDeliveryAttempt(
        sending.record,
        {
          execution: activeExecution,
          deliveryAttempt,
          deliveryAttemptToken:
            `delivery-attempt-token-${deliveryAttempt}`,
          outcome: {
            status: 'confirmed_not_sent',
            errorCode: 'provider_rejected',
            message: 'Definitively not sent',
          },
          updatedAt:
            `2026-07-20T02:00:0${deliveryAttempt * 3 - 1}.000Z`,
        },
      );
      if (completed.status !== 'transitioned') {
        throw new Error(
          `test_delivery_completion_${deliveryAttempt}_failed:${completed.reason}`,
        );
      }
      record = completed.record;
    }

    expect(beginAgentRunTextDeliveryAttempt(record, {
      execution: activeExecution,
      nextDeliveryAttempt:
        MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS + 1,
      deliveryAttemptToken: 'delivery-attempt-token-4',
      updatedAt: '2026-07-20T02:00:09.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'attempts_exhausted',
    });
    expect(agentRunTextDeliveryRecordSchema.safeParse({
      ...record,
      deliveryAttempt:
        MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS + 1,
      deliveryAttemptToken: 'delivery-attempt-token-4',
    }).success).toBe(false);
  });

  it('rejects reusing the first attempt token for the third attempt', async () => {
    const originExecution: AgentRunTextDeliveryExecutionBinding = {
      runId: 'agent-run-token-reuse',
      executionAttempt: 1,
      executionLeaseToken: 'token-reuse-execution-lease-1',
    };
    const pending = await createPendingAgentRunTextDelivery({
      execution: originExecution,
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-token-reuse',
      recipientId: 'private-recipient-token-reuse',
      presentationText: 'Private presentation token reuse',
      createdAt,
    });
    const firstSending = beginAgentRunTextDeliveryAttempt(pending, {
      execution: originExecution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: firstAttemptAt,
    });
    if (firstSending.status !== 'dispatch_authorized') {
      throw new Error(
        `test_first_delivery_attempt_failed:${firstSending.reason}`,
      );
    }
    const firstRejected = completeAgentRunTextDeliveryAttempt(
      firstSending.record,
      {
        execution: originExecution,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-attempt-token-1',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'Definitively not sent',
        },
        updatedAt: firstOutcomeAt,
      },
    );
    if (firstRejected.status !== 'transitioned') {
      throw new Error(
        `test_first_delivery_completion_failed:${firstRejected.reason}`,
      );
    }
    const secondExecution = {
      ...originExecution,
      executionAttempt: 2,
      executionLeaseToken: 'token-reuse-execution-lease-2',
    };
    const secondRebound = await rebindRetryableAgentRunTextDelivery(
      firstRejected.record,
      {
        execution: secondExecution,
        channel: 'messenger',
        assistantTurnId: 'assistant-turn-token-reuse',
        recipientId: 'private-recipient-token-reuse',
        presentationText: 'Private presentation token reuse',
        updatedAt: secondAttemptAt,
      },
    );
    if (secondRebound.status !== 'rebound') {
      throw new Error(
        `test_second_delivery_rebind_failed:${secondRebound.reason}`,
      );
    }
    const secondSending = beginAgentRunTextDeliveryAttempt(
      secondRebound.record,
      {
        execution: secondExecution,
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'delivery-attempt-token-2',
        updatedAt: '2026-07-20T02:00:04.000Z',
      },
    );
    if (secondSending.status !== 'dispatch_authorized') {
      throw new Error(
        `test_second_delivery_attempt_failed:${secondSending.reason}`,
      );
    }
    expect(secondSending.record.priorDeliveryAttemptTokens).toEqual([
      'delivery-attempt-token-1',
    ]);
    const secondRejected = completeAgentRunTextDeliveryAttempt(
      secondSending.record,
      {
        execution: secondExecution,
        deliveryAttempt: 2,
        deliveryAttemptToken: 'delivery-attempt-token-2',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'Definitively not sent',
        },
        updatedAt: '2026-07-20T02:00:05.000Z',
      },
    );
    if (secondRejected.status !== 'transitioned') {
      throw new Error(
        `test_second_delivery_completion_failed:${secondRejected.reason}`,
      );
    }

    const thirdExecution = {
      ...originExecution,
      executionAttempt: 3,
      executionLeaseToken: 'token-reuse-execution-lease-3',
    };
    const thirdRebound = await rebindRetryableAgentRunTextDelivery(
      secondRejected.record,
      {
        execution: thirdExecution,
        channel: 'messenger',
        assistantTurnId: 'assistant-turn-token-reuse',
        recipientId: 'private-recipient-token-reuse',
        presentationText: 'Private presentation token reuse',
        updatedAt: '2026-07-20T02:00:06.000Z',
      },
    );
    if (thirdRebound.status !== 'rebound') {
      throw new Error(
        `test_third_delivery_rebind_failed:${thirdRebound.reason}`,
      );
    }
    expect(beginAgentRunTextDeliveryAttempt(thirdRebound.record, {
      execution: thirdExecution,
      nextDeliveryAttempt: 3,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: '2026-07-20T02:00:07.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    expect(agentRunTextDeliveryRecordSchema.safeParse({
      ...thirdRebound.record,
      priorDeliveryAttemptTokens: [],
    }).success).toBe(false);
  });

  it('rebinds a pending delivery to a newer exact execution without changing its durable content', async () => {
    const pending = await pendingDelivery();
    const rebound = await rebindRetryableAgentRunTextDelivery(
      pending,
      rebindInput(),
    );

    expect(rebound).toMatchObject({
      status: 'rebound',
      record: {
        status: 'pending',
        runId: pending.runId,
        runExecutionAttempt: reboundExecution.executionAttempt,
        runExecutionLeaseToken:
          reboundExecution.executionLeaseToken,
        channel: pending.channel,
        assistantTurnId: pending.assistantTurnId,
        recipientBindingDigest: pending.recipientBindingDigest,
        presentationBindingDigest:
          pending.presentationBindingDigest,
        deliveryAttempt: 0,
        deliveryAttemptToken: null,
        providerMessageId: null,
        outcomeCode: null,
        createdAt: pending.createdAt,
        updatedAt: secondAttemptAt,
      },
    });
    if (rebound.status !== 'rebound') {
      throw new Error(`test_delivery_rebind_failed:${rebound.reason}`);
    }
    expect(rebound.record.deliveryBindingDigest).not.toBe(
      pending.deliveryBindingDigest,
    );
    expect(beginAgentRunTextDeliveryAttempt(rebound.record, {
      execution: reboundExecution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-rebound',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        runExecutionAttempt: reboundExecution.executionAttempt,
        deliveryAttempt: 1,
      },
    });
    expect(beginAgentRunTextDeliveryAttempt(rebound.record, {
      execution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-stale',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_binding_mismatch',
    });
  });

  it('requires a new execution after a failed first attempt dispatched from a rebound pending record', async () => {
    const firstExecution: AgentRunTextDeliveryExecutionBinding = {
      runId: 'agent-run-pending-rebind-before-dispatch',
      executionAttempt: 1,
      executionLeaseToken: 'pending-rebind-execution-lease-1',
    };
    const secondExecution: AgentRunTextDeliveryExecutionBinding = {
      ...firstExecution,
      executionAttempt: 2,
      executionLeaseToken: 'pending-rebind-execution-lease-2',
    };
    const thirdExecution: AgentRunTextDeliveryExecutionBinding = {
      ...firstExecution,
      executionAttempt: 3,
      executionLeaseToken: 'pending-rebind-execution-lease-3',
    };
    const pending = await createPendingAgentRunTextDelivery({
      execution: firstExecution,
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-pending-rebind',
      recipientId: 'private-recipient-pending-rebind',
      presentationText: 'Private presentation pending rebind',
      createdAt,
    });
    const reboundPending =
      await rebindRetryableAgentRunTextDelivery(pending, {
        execution: secondExecution,
        channel: 'messenger',
        assistantTurnId: 'assistant-turn-pending-rebind',
        recipientId: 'private-recipient-pending-rebind',
        presentationText: 'Private presentation pending rebind',
        updatedAt: firstAttemptAt,
      });
    if (reboundPending.status !== 'rebound') {
      throw new Error(
        `test_pending_rebind_failed:${reboundPending.reason}`,
      );
    }
    const firstSending = beginAgentRunTextDeliveryAttempt(
      reboundPending.record,
      {
        execution: secondExecution,
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: 'pending-rebind-delivery-attempt-1',
        updatedAt: firstOutcomeAt,
      },
    );
    if (firstSending.status !== 'dispatch_authorized') {
      throw new Error(
        `test_pending_rebind_dispatch_failed:${firstSending.reason}`,
      );
    }
    expect(firstSending.record.lastDeliveryRunExecutionAttempt).toBe(
      secondExecution.executionAttempt,
    );
    const firstRejected = completeAgentRunTextDeliveryAttempt(
      firstSending.record,
      {
        execution: secondExecution,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'pending-rebind-delivery-attempt-1',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'Definitively not sent',
        },
        updatedAt: secondAttemptAt,
      },
    );
    if (firstRejected.status !== 'transitioned') {
      throw new Error(
        `test_pending_rebind_completion_failed:${firstRejected.reason}`,
      );
    }

    expect(beginAgentRunTextDeliveryAttempt(firstRejected.record, {
      execution: secondExecution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'pending-rebind-delivery-attempt-2',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    const reboundRejected =
      await rebindRetryableAgentRunTextDelivery(
        firstRejected.record,
        {
          execution: thirdExecution,
          channel: 'messenger',
          assistantTurnId: 'assistant-turn-pending-rebind',
          recipientId: 'private-recipient-pending-rebind',
          presentationText: 'Private presentation pending rebind',
          updatedAt: '2026-07-20T02:00:04.000Z',
        },
      );
    if (reboundRejected.status !== 'rebound') {
      throw new Error(
        `test_failed_delivery_rebind_failed:${reboundRejected.reason}`,
      );
    }
    expect(beginAgentRunTextDeliveryAttempt(
      reboundRejected.record,
      {
        execution: thirdExecution,
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'pending-rebind-delivery-attempt-2',
        updatedAt: '2026-07-20T02:00:05.000Z',
      },
    )).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        lastDeliveryRunExecutionAttempt:
          thirdExecution.executionAttempt,
      },
    });
  });

  it('rebinds confirmed-not-sent while preserving its retry history and outcome', async () => {
    const rejected = await completedDelivery({
      status: 'confirmed_not_sent',
      errorCode: 'provider_rejected',
      message: 'Definitively not sent',
    });
    const rebound = await rebindRetryableAgentRunTextDelivery(
      rejected,
      rebindInput(),
    );

    expect(rebound).toMatchObject({
      status: 'rebound',
      record: {
        status: 'confirmed_not_sent',
        deliveryAttempt: rejected.deliveryAttempt,
        deliveryAttemptToken: rejected.deliveryAttemptToken,
        providerMessageId: null,
        outcomeCode: 'provider_rejected',
        createdAt: rejected.createdAt,
        updatedAt: secondAttemptAt,
      },
    });
    if (rebound.status !== 'rebound') {
      throw new Error(`test_delivery_rebind_failed:${rebound.reason}`);
    }
    expect(beginAgentRunTextDeliveryAttempt(rebound.record, {
      execution: reboundExecution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-attempt-token-2',
      updatedAt: '2026-07-20T02:00:04.000Z',
    })).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        deliveryAttempt: 2,
        deliveryAttemptToken: 'delivery-attempt-token-2',
      },
    });
  });

  it.each([
    ['same execution attempt', {
      execution,
    }, 'execution_attempt_not_newer'],
    ['older execution attempt', {
      execution: { ...execution, executionAttempt: 1 },
    }, 'execution_attempt_not_newer'],
    ['reused execution lease', {
      execution: {
        ...reboundExecution,
        executionLeaseToken: execution.executionLeaseToken,
      },
    }, 'execution_lease_token_reused'],
    ['non-monotonic updated time', {
      updatedAt: '2026-07-20T01:59:59.000Z',
    }, 'updated_at_invalid'],
    ['different run', {
      execution: { ...reboundExecution, runId: 'different-run' },
    }, 'delivery_identity_mismatch'],
    ['different channel', {
      channel: 'zalo',
    }, 'delivery_identity_mismatch'],
    ['different assistant turn', {
      assistantTurnId: 'assistant-turn-2',
    }, 'delivery_identity_mismatch'],
    ['different recipient', {
      recipientId: 'different-private-recipient',
    }, 'delivery_identity_mismatch'],
    ['different presentation', {
      presentationText: 'Different private presentation',
    }, 'delivery_identity_mismatch'],
    ['invalid presentation', {
      presentationText: '   ',
    }, 'binding_input_invalid'],
  ] as const)(
    'blocks retryable delivery rebind with %s',
    async (_case, overrides, reason) => {
      const pending = await pendingDelivery();

      expect(await rebindRetryableAgentRunTextDelivery(
        pending,
        rebindInput(overrides),
      )).toEqual({
        status: 'rebind_blocked',
        reason,
      });
    },
  );

  it.each(['pending', 'confirmed_not_sent'] as const)(
    'rejects A-to-B-to-A execution lease lineage reuse for %s',
    async (status) => {
      const firstExecution: AgentRunTextDeliveryExecutionBinding = {
        runId: 'agent-run-lineage',
        executionAttempt: 1,
        executionLeaseToken: 'historical-execution-lease-a',
      };
      const secondExecution: AgentRunTextDeliveryExecutionBinding = {
        ...firstExecution,
        executionAttempt: 2,
        executionLeaseToken: 'historical-execution-lease-b',
      };
      const thirdExecution: AgentRunTextDeliveryExecutionBinding = {
        ...firstExecution,
        executionAttempt: 3,
      };
      const initialPending =
        await createPendingAgentRunTextDelivery({
          execution: firstExecution,
          channel: 'messenger',
          assistantTurnId: 'assistant-turn-lineage',
          recipientId: 'private-recipient-lineage',
          presentationText: 'Private presentation lineage',
          createdAt,
        });
      expect(await rebindRetryableAgentRunTextDelivery(
        initialPending,
        {
          execution: {
            ...firstExecution,
            executionAttempt: 3,
            executionLeaseToken: 'historical-execution-lease-c',
          },
          channel: 'messenger',
          assistantTurnId: 'assistant-turn-lineage',
          recipientId: 'private-recipient-lineage',
          presentationText: 'Private presentation lineage',
          updatedAt: firstAttemptAt,
        },
      )).toEqual({
        status: 'rebind_blocked',
        reason: 'execution_attempt_not_next',
      });
      let initial: AgentRunTextDeliveryRecord = initialPending;
      if (status === 'confirmed_not_sent') {
        const sending = beginAgentRunTextDeliveryAttempt(
          initialPending,
          {
            execution: firstExecution,
            nextDeliveryAttempt: 1,
            deliveryAttemptToken: 'delivery-lineage-attempt-1',
            updatedAt: firstAttemptAt,
          },
        );
        if (sending.status !== 'dispatch_authorized') {
          throw new Error(
            `test_lineage_sending_failed:${sending.reason}`,
          );
        }
        const completed = completeAgentRunTextDeliveryAttempt(
          sending.record,
          {
            execution: firstExecution,
            deliveryAttempt: 1,
            deliveryAttemptToken: 'delivery-lineage-attempt-1',
            outcome: {
              status: 'confirmed_not_sent',
              errorCode: 'provider_rejected',
              message: 'Definitively not sent',
            },
            updatedAt: firstOutcomeAt,
          },
        );
        if (completed.status !== 'transitioned') {
          throw new Error(
            `test_lineage_completion_failed:${completed.reason}`,
          );
        }
        initial = completed.record;
      }
      const rebound = await rebindRetryableAgentRunTextDelivery(
        initial,
        {
          execution: secondExecution,
          channel: 'messenger',
          assistantTurnId: 'assistant-turn-lineage',
          recipientId: 'private-recipient-lineage',
          presentationText: 'Private presentation lineage',
          updatedAt: secondAttemptAt,
        },
      );
      if (rebound.status !== 'rebound') {
        throw new Error(
          `test_lineage_first_rebind_failed:${rebound.reason}`,
        );
      }
      expect(rebound.record.priorRunExecutionLeaseTokenDigests)
        .toHaveLength(1);
      expect(JSON.stringify(rebound.record)).not.toContain(
        firstExecution.executionLeaseToken,
      );
      expect(agentRunTextDeliveryRecordSchema.safeParse({
        ...rebound.record,
        priorRunExecutionLeaseTokenDigests: [],
      }).success).toBe(false);
      expect(agentRunTextDeliveryRecordSchema.safeParse({
        ...rebound.record,
        priorRunExecutionLeaseTokenDigests: [
          rebound.record.runExecutionLeaseTokenDigest,
        ],
      }).success).toBe(false);

      expect(await rebindRetryableAgentRunTextDelivery(
        rebound.record,
        {
          execution: thirdExecution,
          channel: 'messenger',
          assistantTurnId: 'assistant-turn-lineage',
          recipientId: 'private-recipient-lineage',
          presentationText: 'Private presentation lineage',
          updatedAt: '2026-07-20T02:00:04.000Z',
        },
      )).toEqual({
        status: 'rebind_blocked',
        reason: status === 'pending'
          ? 'execution_lease_token_reused'
          : 'execution_already_rebound',
      });
    },
  );

  it.each([
    ['sending', async () => sendingDelivery()],
    ['confirmed sent', async () => completedDelivery({
      status: 'confirmed_sent',
      messageId: 'provider-message-1',
    })],
    ['unknown', async () => completedDelivery({
      status: 'delivery_outcome_unknown',
      errorCode: 'provider_timeout',
      message: 'Outcome unknown',
    })],
  ] satisfies Array<[
    string,
    () => Promise<AgentRunTextDeliveryRecord>,
  ]>)(
    'never rebinds a %s delivery',
    async (_status, createRecord) => {
      expect(await rebindRetryableAgentRunTextDelivery(
        await createRecord(),
        rebindInput(),
      )).toEqual({
        status: 'rebind_blocked',
        reason: 'delivery_not_retryable',
      });
    },
  );

  it.each([
    ['sending replay', 'sending_in_progress'],
    ['confirmed sent', 'confirmed_sent'],
    ['unknown outcome', 'delivery_outcome_unknown'],
  ] as const)(
    'never authorizes dispatch from %s',
    async (source, reason) => {
      const record = source === 'sending replay'
        ? await sendingDelivery()
        : source === 'confirmed sent'
          ? await completedDelivery({
              status: 'confirmed_sent',
              messageId: 'provider-message-1',
            })
          : await completedDelivery({
              status: 'delivery_outcome_unknown',
              errorCode: 'provider_timeout',
              message: 'Outcome unknown',
            });

      expect(beginAgentRunTextDeliveryAttempt(record, {
        execution,
        nextDeliveryAttempt: record.deliveryAttempt + 1,
        deliveryAttemptToken: 'delivery-attempt-token-next',
        updatedAt: secondAttemptAt,
      })).toEqual({
        status: 'dispatch_blocked',
        reason,
      });
    },
  );

  it.each([
    [
      'explicit rejection',
      {
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected',
        message: 'Private provider message sentinel',
      },
      'confirmed_not_sent',
      'provider_rejected',
    ],
    [
      'local non-dispatch',
      {
        status: 'not_dispatched',
        errorCode: 'missing_configuration',
        message: 'Private configuration message sentinel',
      },
      'confirmed_not_sent',
      'missing_configuration',
    ],
    [
      'ambiguous outcome',
      {
        status: 'delivery_outcome_unknown',
        errorCode: 'provider_timeout',
        message: 'Private timeout message sentinel',
      },
      'delivery_outcome_unknown',
      'provider_timeout',
    ],
  ] satisfies Array<[
    string,
    ChannelTextSendOutcome,
    AgentRunTextDeliveryRecord['status'],
    string,
  ]>)(
    'durably maps %s without retaining raw transport messages',
    async (_case, outcome, status, outcomeCode) => {
      const record = await completedDelivery(outcome);

      expect(record).toMatchObject({ status, outcomeCode });
      expect(record.providerMessageId).toBeNull();
      expect(JSON.stringify(record)).not.toContain(outcome.message);
    },
  );

  it.each([
    ['', 'provider_message_id_invalid'],
    ['   ', 'provider_message_id_invalid'],
    [' provider-message-1 ', 'provider_message_id_invalid'],
  ] as const)(
    'rejects a non-trimmed or empty confirmed provider ID',
    async (messageId, reason) => {
      const sending = await sendingDelivery();

      expect(completeAgentRunTextDeliveryAttempt(sending, {
        execution,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-attempt-token-1',
        outcome: {
          status: 'confirmed_sent',
          messageId,
        },
        updatedAt: firstOutcomeAt,
      })).toEqual({
        status: 'transition_blocked',
        reason,
      });
    },
  );

  it('persists the exact trimmed provider ID and makes confirmed sent terminal', async () => {
    const sent = await completedDelivery({
      status: 'confirmed_sent',
      messageId: 'provider-message-1',
    });

    expect(sent).toMatchObject({
      status: 'confirmed_sent',
      providerMessageId: 'provider-message-1',
      outcomeCode: null,
    });
    expect(beginAgentRunTextDeliveryAttempt(sent, {
      execution,
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-attempt-token-2',
      updatedAt: secondAttemptAt,
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'confirmed_sent',
    });
  });

  it.each([
    [
      'wrong execution binding',
      { ...execution, executionAttempt: 4 },
      1,
      'delivery-attempt-token-1',
      'execution_binding_mismatch',
    ],
    [
      'wrong delivery attempt',
      execution,
      2,
      'delivery-attempt-token-1',
      'delivery_attempt_mismatch',
    ],
    [
      'wrong delivery token',
      execution,
      1,
      'delivery-attempt-token-wrong',
      'delivery_attempt_mismatch',
    ],
  ] satisfies Array<[
    string,
    AgentRunTextDeliveryExecutionBinding,
    number,
    string,
    string,
  ]>)(
    'blocks completion with %s',
    async (
      _case,
      suppliedExecution,
      deliveryAttempt,
      deliveryAttemptToken,
      reason,
    ) => {
      const sending = await sendingDelivery();

      expect(completeAgentRunTextDeliveryAttempt(sending, {
        execution: suppliedExecution,
        deliveryAttempt,
        deliveryAttemptToken,
        outcome: {
          status: 'confirmed_sent',
          messageId: 'provider-message-1',
        },
        updatedAt: firstOutcomeAt,
      })).toEqual({
        status: 'transition_blocked',
        reason,
      });
    },
  );

  it.each([
    ['pending', async () => pendingDelivery()],
    [
      'confirmed_not_sent',
      async () => completedDelivery({
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected',
        message: 'Rejected',
      }),
    ],
    [
      'confirmed_sent',
      async () => completedDelivery({
        status: 'confirmed_sent',
        messageId: 'provider-message-1',
      }),
    ],
    [
      'delivery_outcome_unknown',
      async () => completedDelivery({
        status: 'delivery_outcome_unknown',
        errorCode: 'provider_timeout',
        message: 'Unknown',
      }),
    ],
  ] satisfies Array<[
    string,
    () => Promise<AgentRunTextDeliveryRecord>,
  ]>)(
    'accepts completion only from sending, not %s',
    async (_status, createRecord) => {
      const record = await createRecord();

      expect(completeAgentRunTextDeliveryAttempt(record, {
        execution,
        deliveryAttempt: record.deliveryAttempt,
        deliveryAttemptToken:
          record.deliveryAttemptToken ?? 'delivery-attempt-token-1',
        outcome: {
          status: 'confirmed_sent',
          messageId: 'provider-message-1',
        },
        updatedAt: secondAttemptAt,
      })).toEqual({
        status: 'transition_blocked',
        reason: 'delivery_not_sending',
      });
    },
  );

  it('rejects non-monotonic transition timestamps', async () => {
    const pending = await pendingDelivery();
    expect(beginAgentRunTextDeliveryAttempt(pending, {
      execution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      updatedAt: '2026-07-20T01:59:59.000Z',
    })).toEqual({
      status: 'dispatch_blocked',
      reason: 'updated_at_invalid',
    });

    const sending = await sendingDelivery();
    expect(completeAgentRunTextDeliveryAttempt(sending, {
      execution,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-1',
      outcome: {
        status: 'delivery_outcome_unknown',
        errorCode: 'provider_timeout',
        message: 'Unknown',
      },
      updatedAt: createdAt,
    })).toEqual({
      status: 'transition_blocked',
      reason: 'updated_at_invalid',
    });
  });
});
