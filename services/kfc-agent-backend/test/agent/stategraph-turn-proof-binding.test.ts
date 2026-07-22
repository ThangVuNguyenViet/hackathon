import { describe, expect, it } from 'vitest';
import {
  createStateGraphTurnProofBinding,
} from '../../src/agent/stateGraphTurnProofBinding.js';
import {
  STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
  STATEGRAPH_TURN_PROOF_RUNTIME_ID,
} from '../../src/domain/stateGraphTurnProof.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type {
  AgentTurnInput,
} from '../../src/graph/agentTurnState.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../../src/session/sessionContext.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function turnInput(input: {
  sessionId?: string;
  externalMessageId?: string;
  checkpointRunId?: string;
  confirmationResume?: AgentTurnInput['confirmationResume'];
} = {}): AgentTurnInput {
  const checkpointRunId =
    input.checkpointRunId ??
    (input.confirmationResume ? undefined : 'server-run-123');
  return {
    sessionId: input.sessionId ?? 'kfc:proof-customer',
    customerId: 'proof-customer',
    channel: 'kfc',
    text: 'private customer request',
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    externalMessageId: input.externalMessageId ?? 'request-123',
    ...(checkpointRunId ? { checkpointRunId } : {}),
    ...(input.confirmationResume
      ? { confirmationResume: input.confirmationResume }
      : {}),
  };
}

function checkpointThreadId(
  sessionId: string,
  checkpointRunId: string,
): string {
  const configurable =
    langGraphConfigForRun(sessionId, checkpointRunId).configurable;
  return agentCheckpointThreadId({
    threadId: configurable.thread_id,
    namespace: configurable.checkpoint_ns,
  });
}

describe('StateGraph turn proof binding', () => {
  it('binds the exact server request and distinct model/presentation digests', async () => {
    const modelResponseText = 'short model-authored introduction';
    const presentationText = [
      modelResponseText,
      'private full-menu projection appended by the server',
    ].join('\n\n');

    const binding = await createStateGraphTurnProofBinding({
      turnInput: turnInput(),
      currentTurnId: 'turn-user-1',
      modelResponseText,
      presentationText,
    });

    expect(binding).toEqual({
      schemaVersion: STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
      runtimeId: STATEGRAPH_TURN_PROOF_RUNTIME_ID,
      currentTurnId: 'turn-user-1',
      checkpointRunId: 'server-run-123',
      checkpointThreadId: checkpointThreadId(
        'kfc:proof-customer',
        'server-run-123',
      ),
      checkpointNamespace: '',
      modelResponseDigest: await stateRevision(modelResponseText),
      presentationDigest: await stateRevision(presentationText),
    });
    expect(binding.modelResponseDigest)
      .not.toBe(binding.presentationDigest);
    const serialized = JSON.stringify(binding);
    expect(serialized).not.toContain(modelResponseText);
    expect(serialized).not.toContain(presentationText);
    expect(serialized).not.toContain('private customer request');
    expect(serialized).not.toContain('request-123');
  });

  it('fails closed when only an external message correlation is present', async () => {
    await expect(createStateGraphTurnProofBinding({
      turnInput: {
        ...turnInput(),
        checkpointRunId: undefined,
        externalMessageId: 'private-external-message-sentinel',
      },
      currentTurnId: 'turn-user-1',
      modelResponseText: 'model response',
      presentationText: 'presentation',
    })).rejects.toThrow('stategraph_turn_proof_checkpoint_missing');
  });

  it('binds an approval continuation to its original checkpoint run', async () => {
    const sessionId = 'kfc:approval-customer';
    const originalRunId = 'original-order-request';
    const threadId = checkpointThreadId(sessionId, originalRunId);

    const binding = await createStateGraphTurnProofBinding({
      turnInput: turnInput({
        sessionId,
        externalMessageId: 'new-resume-request',
        confirmationResume: {
          requestId: 'approval-request',
          approved: true,
          checkpoint: {
            threadId,
            namespace: '',
            checkpointId: 'checkpoint-before-interrupt',
          },
        },
      }),
      currentTurnId: 'turn-user-order',
      modelResponseText: 'verified order response',
      presentationText: 'verified order response',
    });

    expect(binding).toMatchObject({
      checkpointRunId: originalRunId,
      checkpointThreadId: threadId,
      currentTurnId: 'turn-user-order',
    });
  });

  it('rejects a resumed checkpoint owned by another session', async () => {
    const foreignThread = checkpointThreadId(
      'kfc:another-customer',
      'foreign-run',
    );

    await expect(createStateGraphTurnProofBinding({
      turnInput: turnInput({
        confirmationResume: {
          requestId: 'approval-request',
          approved: true,
          checkpoint: {
            threadId: foreignThread,
            namespace: '',
            checkpointId: 'foreign-checkpoint',
          },
        },
      }),
      currentTurnId: 'turn-user-order',
      modelResponseText: 'model response',
      presentationText: 'presentation',
    })).rejects.toThrow('stategraph_turn_proof_checkpoint_invalid');
  });
});
