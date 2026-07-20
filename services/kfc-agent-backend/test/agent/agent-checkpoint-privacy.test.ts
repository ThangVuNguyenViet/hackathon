import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import {
  createAgentTurnExternalCallScope,
} from '../../src/agent/singleAgentRuntime.js';
import {
  persistCanonicalConfirmationPause,
} from '../../src/api/confirmationPausePersistence.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import {
  parseCreateConfirmationPauseInput,
} from '../../src/persistence/confirmationPause.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseModelReply,
  groundedResponseToolCall,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

async function serializedCheckpointHistory(
  checkpointer: MemorySaver,
): Promise<string> {
  const transientChannels = new Set([
    'messages',
    'text',
    'metadata',
    'domainState',
    'currentTurnToolTrace',
    'currentUserTurn',
    'modelPublicationAuthority',
    'modelPublicationBundle',
    'graphExecutedToolResults',
    'currentTurnResponseEvidence',
    'pendingToolCalls',
    'queuedToolCalls',
    'responseText',
    'output',
  ]);
  const history: unknown[] = [];
  for await (
    const tuple of checkpointer.list({ configurable: {} })
  ) {
    for (const channel of transientChannels) {
      expect(tuple.checkpoint.channel_values[channel]).toBeUndefined();
    }
    expect((tuple.pendingWrites ?? []).some((write) =>
      transientChannels.has(write[1]))).toBe(false);
    history.push({
      checkpoint: tuple.checkpoint,
      pendingWrites: tuple.pendingWrites,
      metadata: tuple.metadata,
      config: tuple.config,
      parentConfig: tuple.parentConfig,
    });
  }
  return JSON.stringify(history);
}

function testTurn(input: {
  model: ReturnType<typeof fakeModel>;
  sessionId: string;
  text?: string;
  accessContext?: ReturnType<typeof controlledCustomerAccess>;
}) {
  const customerId = 'checkpoint-privacy-customer';
  const checkpointer = new MemorySaver();
  const store = new MemoryStore();
  return {
    sessionId: input.sessionId,
    customerId,
    channel: 'kfc' as const,
    text: input.text ?? 'Please help with this request.',
    externalMessageId: `${input.sessionId}-message`,
    clients: createMockClients(createTestFixtures()),
    store,
    dashboard: new DashboardEventBus(),
    checkpointer,
    agentModel: input.model,
    responseVerifierModel: groundedResponseVerifierModel(),
    ...(input.accessContext
      ? { accessContext: input.accessContext }
      : {}),
  };
}

async function canonicalConfirmationRecord(
  output: Awaited<ReturnType<typeof runAgentTurn>>,
): Promise<CreateConfirmationPauseInput> {
  const record: unknown = Object.getOwnPropertyDescriptor(
    output.pause ?? {},
    'confirmationRecord',
  )?.value;
  return parseCreateConfirmationPauseInput(record);
}

describe('agent checkpoint privacy', () => {
  it('keeps a user-typed private address transient while the model receives it', async () => {
    const privateLine = 'CHECKPOINT-PRIVATE-ADDRESS-903';
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            label: privateLine,
            line1: privateLine,
            district: 'District 7',
            city: 'Ho Chi Minh City',
          },
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The verified delivery quote is ready.',
      }));
    const input = testTurn({
      model,
      sessionId: 'checkpoint-private-fulfillment',
      text: `Please deliver to ${privateLine}.`,
      accessContext: controlledCustomerAccess({
        sessionId: 'checkpoint-private-fulfillment',
        customerId: 'checkpoint-privacy-customer',
        channel: 'kfc',
      }),
    });
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: {
        cart: {
          id: 'cart-private-address',
          items: [{
            itemCode: '20751',
            name: 'Verified item',
            quantity: 1,
            unitPriceVnd: 99_000,
          }],
          subtotalVnd: 99_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 99_000,
          voucherCode: null,
        },
        addressDraft: {
          label: privateLine,
          line1: privateLine,
          district: 'District 7',
          city: 'Ho Chi Minh City',
        },
        toolTrace: [],
      },
    });

    await runAgentTurn(input);

    expect(
      model.calls[0]?.messages.map((message) => message.text).join('\n'),
    ).toContain(privateLine);
    const serialized = await serializedCheckpointHistory(input.checkpointer);
    expect(serialized).not.toContain(privateLine);
  });

  it('never checkpoints rejected response prose or its correction context', async () => {
    const rejectedText = 'CHECKPOINT-UNVERIFIED-RESPONSE-904';
    const model = fakeModel()
      .respond(() =>
        new AIMessage({
          content: '',
          tool_calls: [groundedResponseToolCall({
            customerText: rejectedText,
            projectionDigest: '0'.repeat(64),
          })],
        }))
      .respond(groundedResponseModelReply({
        customerText: 'How can I help with your KFC order?',
      }));
    const input = testTurn({
      model,
      sessionId: 'checkpoint-rejected-response',
    });

    await runAgentTurn(input);

    const history = await serializedCheckpointHistory(input.checkpointer);
    expect(history).not.toContain(rejectedText);
    expect(history).not.toContain('submitGroundedResponse');
  });

  it('never checkpoints invalid private tool arguments during correction', async () => {
    const rejectedArgument = 'CHECKPOINT-INVALID-TOOL-ARGUMENT-905';
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            line1: rejectedArgument,
            district: 'District 7',
            city: 'Ho Chi Minh City',
            forbiddenProviderField: rejectedArgument,
          },
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Please provide a verified delivery destination.',
      }));
    const input = testTurn({
      model,
      sessionId: 'checkpoint-private-correction',
    });

    await runAgentTurn(input);

    expect(await serializedCheckpointHistory(input.checkpointer))
      .not.toContain(rejectedArgument);
  });

  it('keeps pause and resume checkpoints free of raw irreversible arguments', async () => {
    const privateReason = 'CHECKPOINT-PRIVATE-HANDOFF-906';
    const sessionId = 'checkpoint-private-approval';
    const customerId = 'checkpoint-privacy-customer';
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
      channel: 'kfc',
    });
    accessContext.authorizedScopes.push('handoff:write');
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: [privateReason] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The support request was left unsubmitted.',
      }));
    const input = testTurn({
      model,
      sessionId,
      text: `Please connect me with support about ${privateReason}.`,
      accessContext,
    });
    const runId = 'checkpoint-private-approval-run';
    const customerRun = await input.store.createCustomerRun({
      id: runId,
      schemaVersion: 1,
      sessionId,
      customerId,
      clientMessageId: input.externalMessageId,
      requestFingerprint: `${runId}-fingerprint`,
      generation: 1,
      status: 'running',
      phase: 'planning',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: '2026-07-20T00:00:00.000Z',
      startedAt: '2026-07-20T00:00:00.000Z',
      terminalAt: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    const guardedInput = {
      ...input,
      runGuard: {
        isCurrent: async () => true,
        commitFence: {
          kind: 'customer_run' as const,
          runId,
          sessionAuthorityGeneration:
            customerRun.sessionAuthorityGeneration,
        },
      },
    };

    const paused = await runAgentTurn(guardedInput);
    const record = await canonicalConfirmationRecord(paused);
    expect(await serializedCheckpointHistory(input.checkpointer))
      .not.toContain(privateReason);
    await persistCanonicalConfirmationPause({
      store: input.store,
      sessionId,
      customerId,
      channel: 'kfc',
      pause: paused.pause!,
      accessContext,
      checkpointer: input.checkpointer,
      runCommit: {
        fence: guardedInput.runGuard.commitFence,
        state: paused.state,
      },
    });
    const nonConversationAuditEvents = (
      await input.store.listEvents(sessionId)
    ).filter((event) => event.sourceType !== 'conversation_turn:user');
    expect(JSON.stringify(nonConversationAuditEvents))
      .not.toContain(privateReason);

    const signingSecret =
      'checkpoint-privacy-signing-secret-at-least-32-bytes';
    const commerceReceipt = await createCommerceApprovalReceipt({
      binding: record.approvalBinding,
      secret: signingSecret,
      decision: 'reject',
      receiptId: record.requestId,
      issuedAt: new Date(record.createdAt),
      ttlMs: Date.parse(record.expiresAt) - Date.parse(record.createdAt),
    });
    const executionFence = await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: 'kfc-commerce-approval-execution-v1',
        operation: 'confirmation_resume',
        requestId: record.requestId,
        expectedSessionGeneration: 0,
        sessionAuthorityGeneration: 0,
        checkpointThreadId: record.checkpointThreadId,
        checkpointNamespace: record.checkpointNamespace,
        checkpointId: record.checkpointId,
        bindingFingerprint: 'a'.repeat(64),
        approvalBindingDigest:
          await digestCommerceAction(record.approvalBinding),
        providerIdempotencyKey:
          `confirmation:${record.requestId}:handoff:privacy-test`,
        attempt: 1,
        leaseToken: crypto.randomUUID(),
      },
    });
    const scope = createAgentTurnExternalCallScope(1_000);
    try {
      await runAgentTurn({
        ...guardedInput,
        confirmationResume: {
          requestId: record.requestId,
          approved: false,
          checkpoint: {
            threadId: record.checkpointThreadId,
            namespace: record.checkpointNamespace,
            checkpointId: record.checkpointId,
          },
          action: record.action,
          commerceReceipt,
          executionFence,
          signingSecret,
          externalCallContext: scope.context,
          abortExternalCalls: scope.abort,
        },
      });
    } finally {
      scope.dispose();
    }

    expect(await serializedCheckpointHistory(input.checkpointer))
      .not.toContain(privateReason);
    expect(
      model.calls.at(-1)?.messages
        .map((message) => message.text)
        .join('\n'),
    ).toContain(privateReason);
  });
});
