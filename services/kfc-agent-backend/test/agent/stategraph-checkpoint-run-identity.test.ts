import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import {
  stateGraphTurnProofBindingSchema,
} from '../../src/domain/stateGraphTurnProof.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type {
  CheckpointIdentifier,
} from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  buildKfcStateGraphProofEvidence,
  createKfcStateGraphProofSource,
  type KfcProofConfigurationAtProofTime,
} from '../../src/proof/kfcStateGraphProofEvidence.js';
import {
  agentCheckpointThreadBelongsToSession,
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../../src/session/sessionContext.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

class ProofCheckpointStore extends MemoryStore {
  constructor(private readonly saver: MemorySaver) {
    super();
  }

  override async listCheckpointIdentifiers(
    sessionId: string,
  ): Promise<CheckpointIdentifier[]> {
    const identifiers: CheckpointIdentifier[] = [];
    for await (const tuple of this.saver.list({ configurable: {} })) {
      const configurable = tuple.config.configurable;
      const checkpointThreadId = configurable?.thread_id;
      const checkpointNamespace = configurable?.checkpoint_ns ?? '';
      if (
        typeof checkpointThreadId !== 'string' ||
        checkpointNamespace !== '' ||
        !agentCheckpointThreadBelongsToSession(
          checkpointThreadId,
          sessionId,
        )
      ) {
        continue;
      }
      const parentCheckpointId =
        tuple.parentConfig?.configurable?.checkpoint_id;
      identifiers.push({
        checkpointThreadId,
        checkpointNamespace,
        checkpointId: tuple.checkpoint.id,
        parentCheckpointId:
          typeof parentCheckpointId === 'string'
            ? parentCheckpointId
            : null,
      });
    }
    return identifiers;
  }
}

const configurationAtProofTime = {
  agent: {
    provider: 'openai',
    model: 'gpt-5-mini-2025-08-07',
    profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
  },
} satisfies KfcProofConfigurationAtProofTime;

async function runProofTurn(input: {
  sessionId: string;
  externalMessageId?: string;
  checkpointRunId?: string;
}) {
  const saver = new MemorySaver();
  const store = new ProofCheckpointStore(saver);
  await runAgentTurn({
    sessionId: input.sessionId,
    customerId: 'proof-customer',
    channel: 'kfc',
    text: 'private request text',
    ...(input.externalMessageId
      ? { externalMessageId: input.externalMessageId }
      : {}),
    ...(input.checkpointRunId
      ? { checkpointRunId: input.checkpointRunId }
      : {}),
    clients: createMockClients(createTestFixtures()),
    store,
    dashboard: new DashboardEventBus(),
    checkpointer: saver,
    agentModel: fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'private model-authored response',
        evidenceReferences: [],
      }),
    ),
  });
  const turns = await store.listTurns(input.sessionId);
  const user = turns.find(({ role }) => role === 'user');
  const assistant = turns.find(({ role }) => role === 'assistant');
  if (!user || !assistant) {
    throw new Error('expected committed user and assistant turns');
  }
  const binding = stateGraphTurnProofBindingSchema.parse(
    assistant.metadata?.stateGraphProof,
  );
  const projection = await buildKfcStateGraphProofEvidence({
    sessionId: input.sessionId,
    source: createKfcStateGraphProofSource({
      store,
      checkpointer: saver,
    }),
    configurationAtProofTime,
  });
  return { assistant, binding, projection, user };
}

describe('StateGraph checkpoint run identity', () => {
  it('materializes one internal run identity without external correlation', async () => {
    const result = await runProofTurn({
      sessionId: 'kfc:internal-checkpoint-run',
    });

    expect(result.user.externalMessageId).toBeNull();
    expect(result.assistant.externalMessageId).toBeNull();
    expect(result.binding.checkpointRunId)
      .toMatch(/^ephemeral:[0-9a-f-]+$/u);
    const configurable = langGraphConfigForRun(
      result.user.sessionId,
      result.binding.checkpointRunId,
    ).configurable;
    expect(result.binding.checkpointThreadId).toBe(
      agentCheckpointThreadId({
        threadId: configurable.thread_id,
        namespace: configurable.checkpoint_ns,
      }),
    );
    expect(result.projection).toMatchObject({
      complete: true,
      missing: [],
      stateGraphTurnEvidence: [{
        currentTurnId: result.user.id,
        userTurnId: result.user.id,
        assistantTurnId: result.assistant.id,
        checkpointRunId: result.binding.checkpointRunId,
      }],
    });
  });

  it('preserves distinct caller and server identities byte-for-byte', async () => {
    const externalMessageId = 'external-message::exact';
    const checkpointRunId = 'server-checkpoint::exact';
    const result = await runProofTurn({
      sessionId: 'kfc:distinct-checkpoint-run',
      externalMessageId,
      checkpointRunId,
    });

    expect(result.user.externalMessageId).toBe(externalMessageId);
    expect(result.binding.checkpointRunId).toBe(checkpointRunId);
    expect(result.binding.checkpointThreadId)
      .not.toContain(externalMessageId);
    expect(result.projection.complete).toBe(true);
  });

  it('never derives or projects the internal run identity from external correlation', async () => {
    const externalMessageId =
      'private-external-message-correlation-sentinel';
    const result = await runProofTurn({
      sessionId: 'kfc:external-only-checkpoint-run',
      externalMessageId,
    });

    expect(result.user.externalMessageId).toBe(externalMessageId);
    expect(result.binding.checkpointRunId)
      .toMatch(/^ephemeral:[0-9a-f-]+$/u);
    expect(result.binding.checkpointRunId).not.toBe(externalMessageId);
    expect(result.binding.checkpointThreadId)
      .not.toContain(externalMessageId);
    expect(JSON.stringify(result.projection))
      .not.toContain(externalMessageId);
    expect(result.projection.complete).toBe(true);
  });
});
