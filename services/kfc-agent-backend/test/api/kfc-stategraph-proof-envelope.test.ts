import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { RouteOptions } from '../../src/api/routes.js';
import type {
  LifecycleInstance,
} from '../../src/commerce/lifecycleProvider.js';
import type { CheckpointIdentifier } from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  agentCheckpointThreadBelongsToSession,
} from '../../src/session/sessionContext.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

const token = 'kfc-proof-token';

class StateGraphProofMemoryStore extends MemoryStore {
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
      const parentCheckpointId =
        tuple.parentConfig?.configurable?.checkpoint_id;
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
    return identifiers.sort((left, right) =>
      left.checkpointId.localeCompare(right.checkpointId));
  }
}

function lifecycleProof(sessionId: string) {
  const instance: LifecycleInstance = {
    instanceId: 'lifecycle-proof',
    environment: 'sandbox',
    scenarioDefinitionVersion: 'proof-v1',
    releaseId: 'release-proof',
    catalogObservationId: 'catalog-proof',
    catalogHash: 'a'.repeat(64),
    customerBinding: 'customer-proof',
    sessionBinding: sessionId,
    paymentPolicy: 'prepaid',
    fulfillmentPolicy: 'delivery',
    logicalTime: 1,
    expiresAt: 4_102_444_800_000,
    revision: 1,
    state: {
      payment: null,
      order: null,
      delivery: null,
    },
    sealedAt: null,
    resetFrom: null,
  };
  const proof = {
    instance,
    audit: [{
      eventId: 'lifecycle-event-proof',
      revision: 1,
      eventType: 'instance_created',
      outcome: 'committed',
      priorRevision: null,
      createdAt: '2026-07-20T00:00:00.000Z',
    }],
  };
  const unused = async (): Promise<never> => {
    throw new Error('Lifecycle mutation is not used by proof envelope tests');
  };
  const options: NonNullable<RouteOptions['lifecycle']> = {
    environment: 'sandbox',
    controls: {
      create: unused,
      get: unused,
      transition: unused,
    },
    createInput: unused,
    binding: unused,
    proofForSession: async () => proof,
  };
  return {
    proof,
    options,
  };
}

describe('KFC StateGraph proof envelope', () => {
  it('is authenticated and fails closed with bounded evidence only', async () => {
    const sessionId = 'kfc:bounded-proof';
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'private-user-turn-proof-sentinel',
      externalMessageId: 'private-message-id-proof-sentinel',
      externalUserId: 'bounded-proof',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendEvent(sessionId, 'llm:tool_plan', {
      rawPlan: 'private-planner-proof-sentinel',
    });
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: {
        privateAddress: 'private-address-proof-sentinel',
        toolTrace: [],
      },
    });
    const server = buildServer({
      demoAdminToken: token,
      store,
    });
    const url =
      '/admin/proof/kfc/sessions/kfc%3Abounded-proof/envelope';

    expect(
      (await server.inject({ method: 'GET', url })).statusCode,
    ).toBe(401);

    const response = await server.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(409);
    expect(body).toMatchObject({
      schemaVersion: 2,
      artifactKind: 'kfc-stategraph-session-proof-envelope',
      sessionId,
      complete: false,
      missing: expect.arrayContaining([
        'configuration_at_proof_time',
        'durable_turn_bindings',
        'lifecycle_instance',
      ]),
      configurationAtProofTime: null,
      durableTurnCount: 1,
      verifiedStateCount: 1,
      stateGraphTurnEvidence: [],
      lifecycle: {
        complete: false,
        missing: ['lifecycle_instance', 'lifecycle_audit'],
        instance: null,
        audit: [],
      },
    });
    for (const rawField of [
      'turns',
      'events',
      'checkpoints',
      'plannerPlans',
      'verifiedStates',
    ]) {
      expect(body).not.toHaveProperty(rawField);
    }
    const serialized = JSON.stringify(body);
    for (const sentinel of [
      'private-user-turn-proof-sentinel',
      'private-message-id-proof-sentinel',
      'private-planner-proof-sentinel',
      'private-address-proof-sentinel',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }

    await server.close();
  });

  it('projects a complete turn and preserves lifecycle evidence', async () => {
    const sessionId = 'kfc:complete-proof';
    const saver = new MemorySaver();
    const store = new StateGraphProofMemoryStore(saver);
    const lifecycle = lifecycleProof(sessionId);
    const server = buildServer({
      demoAdminToken: token,
      store,
      checkpointer: saver,
      lifecycle: lifecycle.options,
      ...testAgent(
        fakeModel().respond(groundedResponseModelReply({
          customerText: 'private-model-response-proof-sentinel',
          evidenceReferences: [],
        })),
      ),
    });

    const chat = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'complete-proof',
        clientMessageId: 'complete-proof-request',
        text: 'private-complete-user-proof-sentinel',
      },
    });
    expect({
      statusCode: chat.statusCode,
      body: chat.json(),
    }).toMatchObject({
      statusCode: 200,
    });

    const response = await server.inject({
      method: 'GET',
      url:
        '/admin/proof/kfc/sessions/kfc%3Acomplete-proof/envelope',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: 2,
      artifactKind: 'kfc-stategraph-session-proof-envelope',
      sessionId,
      complete: true,
      missing: [],
      configurationAtProofTime: {
        agent: {
          provider: 'openai',
          model: 'gpt-5-mini-2025-08-07',
          profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
        },
      },
      durableTurnCount: 2,
      verifiedStateCount: expect.any(Number),
      stateGraphTurnEvidence: [{
        checkpointRunId:
          expect.stringMatching(/^ephemeral:[0-9a-f-]+$/u),
        checkpoint: {
          readable: true,
        },
        modelInvocationEvidence: {
          attempts: [
            expect.objectContaining({
              purpose: 'agent_decision',
              outcome: 'success',
            }),
          ],
        },
        responsePublicationEvidence: {
          verified: true,
          publicationAttestation: {
            schemaVersion: 'kfc-response-publication-attestation-v1',
            projectionDigest:
              expect.stringMatching(/^[0-9a-f]{64}$/u),
            responseDigest:
              expect.stringMatching(/^[0-9a-f]{64}$/u),
            semanticRelevance: 'aligned',
            privateDataDisclosure: 'none',
            disclosureAuthorities: [],
            disclosesInternalMetadata: false,
          },
        },
        toolExecutionEvidence: [],
      }],
      lifecycle: {
        complete: true,
        missing: [],
        instance: {
          instanceId: lifecycle.proof.instance.instanceId,
          environment: lifecycle.proof.instance.environment,
          revision: lifecycle.proof.instance.revision,
          state: {
            paymentStatus: null,
            orderStatus: null,
            deliveryStatus: null,
          },
          sealed: false,
        },
        audit: lifecycle.proof.audit,
      },
    });
    expect(body.snapshotDigest).toMatch(/^[0-9a-f]{64}$/u);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(
      'private-model-response-proof-sentinel',
    );
    expect(serialized).not.toContain(
      'private-complete-user-proof-sentinel',
    );
    expect(serialized).not.toContain('complete-proof-request');

    await server.close();
  });
});
