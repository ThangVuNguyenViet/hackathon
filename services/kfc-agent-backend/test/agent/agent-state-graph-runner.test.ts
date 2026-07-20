import { readFileSync } from 'node:fs';
import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  agentCheckpointConfigForTurn,
  agentCheckpointThreadId,
} from '../../src/agent/agentStateGraphRunner.js';
import {
  createAgentTurnExternalCallScope,
} from '../../src/agent/singleAgentRuntime.js';
import {
  persistCanonicalConfirmationPause,
} from '../../src/api/confirmationPausePersistence.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import {
  createCommerceApprovalReceipt,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('KFC agent StateGraph runner', () => {
  it('builds a stable checkpoint identity from the thread and namespace', () => {
    expect(agentCheckpointThreadId({
      threadId: 'thread-1',
      namespace: 'request-1',
    })).toBe('agent:["thread-1","request-1"]');
  });

  it('keeps separator-containing checkpoint tuples collision-free', () => {
    const first = agentCheckpointThreadId({
      threadId: 'thread:request',
      namespace: 'namespace',
    });
    const second = agentCheckpointThreadId({
      threadId: 'thread',
      namespace: 'request:namespace',
    });

    expect(first).not.toBe(second);
  });

  it('rejects a resume that does not carry its durable checkpoint tuple', () => {
    expect(() => agentCheckpointConfigForTurn({
      checkpoint: {
        threadId: 'logical-session',
        namespace: 'logical-request',
      },
      confirmationResume: {
        requestId: 'confirmation-request',
        approved: true,
      },
    })).toThrow('agent_confirmation_checkpoint_required');
  });

  it.each([
    {
      checkpoint: {
        threadId: 'agent:["logical-session","logical-request"]',
        namespace: 'unexpected',
        checkpointId: 'checkpoint-id',
      },
    },
    {
      checkpoint: {
        threadId: 'agent:["other-session","logical-request"]',
        namespace: '',
        checkpointId: 'checkpoint-id',
      },
    },
  ])('rejects a mismatched resume checkpoint before invocation', ({
    checkpoint,
  }) => {
    expect(() => agentCheckpointConfigForTurn({
      checkpoint: {
        threadId: 'logical-session',
        namespace: 'logical-request',
      },
      confirmationResume: {
        requestId: 'confirmation-request',
        approved: true,
        checkpoint,
      },
    })).toThrow('agent_confirmation_checkpoint_mismatch');
  });

  it('accepts an exact prior turn thread for a fresh interrupt request', () => {
    expect(agentCheckpointConfigForTurn({
      checkpoint: {
        threadId: 'logical-session',
        namespace: 'new-confirmation-request',
      },
      confirmationResume: {
        requestId: 'new-confirmation-request',
        approved: true,
        checkpoint: {
          threadId:
            'agent:["logical-session","immutable-customer-turn"]',
          namespace: '',
          checkpointId: 'exact-paused-checkpoint',
        },
      },
    })).toEqual({
      configurable: {
        thread_id:
          'agent:["logical-session","immutable-customer-turn"]',
        checkpoint_ns: '',
        checkpoint_id: 'exact-paused-checkpoint',
      },
    });
  });

  it('rejects a same-session checkpoint swapped against the signed fence', () => {
    expect(() => agentCheckpointConfigForTurn({
      checkpoint: {
        threadId: 'logical-session',
        namespace: 'new-confirmation-request',
      },
      confirmationResume: {
        requestId: '00000000-0000-4000-8000-000000000101',
        approved: true,
        checkpoint: {
          threadId:
            'agent:["logical-session","other-customer-turn"]',
          namespace: '',
          checkpointId: 'checkpoint-other',
        },
        executionFence: {
          schemaVersion: 'kfc-commerce-approval-execution-v1',
          operation: 'confirmation_resume',
          requestId: '00000000-0000-4000-8000-000000000101',
          expectedSessionGeneration: 0,
          sessionAuthorityGeneration: 0,
          bindingFingerprint: 'a'.repeat(64),
          approvalBindingDigest: 'b'.repeat(64),
          providerIdempotencyKey: 'confirmation:test',
          attempt: 1,
          leaseToken: '00000000-0000-4000-8000-000000000102',
          checkpointThreadId:
            'agent:["logical-session","immutable-customer-turn"]',
          checkpointNamespace: '',
          checkpointId: 'checkpoint-exact',
          signature: 'c'.repeat(64),
        },
      },
    })).toThrow('agent_confirmation_checkpoint_mismatch');
  });

  it('keeps the runner as a directly imported acyclic leaf', () => {
    const runtimeSource = readFileSync(
      'src/agent/singleAgentRuntime.ts',
      'utf8',
    );
    const graphSource = readFileSync(
      'src/agent/agentStateGraph.ts',
      'utf8',
    );
    const buildGraphSource = readFileSync(
      'src/graph/buildGraph.ts',
      'utf8',
    );

    expect(runtimeSource).not.toMatch(
      /from\s+['"]\.\/agentStateGraph(?:Runner)?\.js['"]/,
    );
    expect(graphSource).not.toMatch(
      /from\s+['"]\.\/agentStateGraphRunner\.js['"]/,
    );
    expect(buildGraphSource).toMatch(
      /from\s+['"]\.\.\/agent\/agentStateGraphRunner\.js['"]/,
    );
  });

  it('does not expose the obsolete approval compatibility bridge', () => {
    const stateSource = readFileSync(
      'src/graph/agentTurnState.ts',
      'utf8',
    );
    const buildGraphSource = readFileSync(
      'src/graph/buildGraph.ts',
      'utf8',
    );
    const turnSupportSource = readFileSync(
      'src/graph/turnSupport.ts',
      'utf8',
    );

    expect(`${stateSource}\n${buildGraphSource}`).not.toMatch(
      /\b(?:AgentApprovalBinding|AgentApprovalReceipt|IrreversibleConfirmationBinding|confirmationAuthority)\b/,
    );
    expect(turnSupportSource).not.toMatch(
      /\b(?:confirmationBinding|bindingFingerprint)\s*\(/,
    );
  });

  it('owns one finite abort signal for the complete turn deadline', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
      const scope = createAgentTurnExternalCallScope(250);
      const context = scope.context;

      expect(Object.isFrozen(context)).toBe(true);
      expect(context.deadlineAt).toBe(Date.now() + 250);
      expect(context.signal.aborted).toBe(false);

      vi.advanceTimersByTime(250);

      expect(scope.context).toBe(context);
      expect(context.signal.aborted).toBe(true);
      expect(context.signal.reason).toEqual(
        expect.objectContaining({ name: 'TimeoutError' }),
      );
      scope.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the finite deadline timer when a turn completes', () => {
    vi.useFakeTimers();
    try {
      const scope = createAgentTurnExternalCallScope(250);
      const context = scope.context;

      scope.dispose();
      vi.advanceTimersByTime(250);

      expect(context.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits and persists the exact hidden canonical pause record', async () => {
    const sessionId = 'agent-runner-canonical-pause';
    const customerId = 'canonical-pause-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    accessContext.authorizedScopes.push('handoff:write');
    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'I need a human agent.',
      externalMessageId: 'canonical-pause-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      accessContext,
      agentModel: fakeModel().respondWithTools([{
        name: 'handoff',
        args: { reasons: ['needs human support'] },
      }]),
    });

    expect(output.status).toBe('paused');
    expect(output.pause).toEqual({
      capability: 'handoff',
      requestId: expect.any(String),
      action: {
        toolName: 'handoff',
        arguments: { reasons: ['needs human support'] },
      },
    });
    const descriptor = Object.getOwnPropertyDescriptor(
      output.pause!,
      'confirmationRecord',
    );
    expect(descriptor).toEqual(expect.objectContaining({
      configurable: false,
      enumerable: false,
      writable: false,
    }));
    expect(JSON.stringify(output.pause)).not.toContain('checkpointId');
    expect(JSON.stringify(output.pause)).not.toContain(
      accessContext.authenticationEvidence.state === 'verified'
        ? accessContext.authenticationEvidence.evidenceRef
        : 'unreachable',
    );
    expect((await store.listEvents(sessionId)).filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toHaveLength(1);

    await persistCanonicalConfirmationPause({
      store,
      sessionId,
      customerId,
      channel: 'kfc',
      pause: output.pause!,
      accessContext,
      checkpointer,
    });

    await expect(
      store.getConfirmationPause(output.pause!.requestId),
    ).resolves.toMatchObject({
      requestId: output.pause!.requestId,
      sessionId,
      customerId,
      channel: 'kfc',
      action: output.pause!.action,
      checkpointThreadId: expect.any(String),
      checkpointId: expect.any(String),
      principal: {
        authenticatedSubject: customerId,
      },
    });
  });

  it('atomically rejects a guarded pause after durable run authority is lost', async () => {
    const sessionId = 'agent-runner-stale-pause-fence';
    const customerId = 'stale-pause-customer';
    const runId = 'agent-runner-stale-pause-run';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    accessContext.authorizedScopes.push('handoff:write');
    const createdRun = await store.createCustomerRun({
      id: runId,
      schemaVersion: 1,
      sessionId,
      customerId,
      clientMessageId: `${runId}-message`,
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
    const clients = createMockClients(createTestFixtures());
    const escalateToHuman = vi.fn(
      clients.handoff.escalateToHuman.bind(clients.handoff),
    );
    clients.handoff = {
      ...clients.handoff,
      escalateToHuman,
    };
    const model = fakeModel().respondWithTools([{
      name: 'handoff',
      args: { reasons: ['needs human support'] },
    }]);
    const runGuard = {
      // Deliberately model a TOCTOU authority loss that an in-memory current
      // check does not observe. Only the durable commit fence is authoritative.
      isCurrent: vi.fn(async () => true),
      commitFence: {
        kind: 'customer_run' as const,
        runId,
        sessionAuthorityGeneration:
          createdRun.sessionAuthorityGeneration,
      },
    };
    let authorityLost = false;

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'I need a human agent.',
      externalMessageId: `${runId}-message`,
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      accessContext,
      agentModel: model,
      runGuard,
      observeRun: async ({ kind }) => {
        if (kind !== 'planning' || authorityLost) return;
        authorityLost = true;
        await store.updateCustomerRun(runId, {
          status: 'superseded',
          terminalAt: '2026-07-20T00:00:01.000Z',
        });
      },
    });

    expect(authorityLost).toBe(true);
    expect(output.status).toBe('paused');
    expect(escalateToHuman).not.toHaveBeenCalled();
    expect((await store.listEvents(sessionId)).filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toEqual([]);

    await expect(
      persistCanonicalConfirmationPause({
        store,
        sessionId,
        customerId,
        channel: 'kfc',
        pause: output.pause!,
        accessContext,
        checkpointer,
        runCommit: {
          fence: runGuard.commitFence,
          state: output.state,
        },
      }),
    ).rejects.toThrow('customer_run_cancelled');

    await expect(
      store.getConfirmationPause(output.pause!.requestId),
    ).resolves.toBeUndefined();
    expect((await store.listEvents(sessionId)).filter(
      ({ sourceType }) =>
        sourceType === 'graph:verified_state' ||
        sourceType === 'confirmation_pause_created',
    )).toEqual([]);
    expect(escalateToHuman).not.toHaveBeenCalled();
    expect(model.callCount).toBe(1);
  });

  it('resumes the stored interrupt instead of a newer checkpoint in the same thread', async () => {
    const sessionId = 'agent-runner-exact-resume';
    const customerId = 'exact-resume-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    accessContext.authorizedScopes.push('handoff:write');
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['needs human support'] },
      }])
      .respond(new AIMessage('No action was taken.'));
    const clients = createMockClients(createTestFixtures());
    const input = {
      sessionId,
      customerId,
      channel: 'kfc' as const,
      text: 'I need a human agent.',
      externalMessageId: 'exact-resume-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      accessContext,
      agentModel: model,
    };
    const paused = await runAgentTurn(input);
    const descriptor = Object.getOwnPropertyDescriptor(
      paused.pause!,
      'confirmationRecord',
    );
    const record = descriptor?.value as CreateConfirmationPauseInput;
    const exactConfig = {
      configurable: {
        thread_id: record.checkpointThreadId,
        checkpoint_ns: record.checkpointNamespace,
        checkpoint_id: record.checkpointId,
      },
    };
    const stored = await checkpointer.getTuple(exactConfig);
    expect(stored?.checkpoint.id).toBe(record.checkpointId);
    if (!stored?.metadata) {
      throw new Error('paused checkpoint metadata missing');
    }

    const newerCheckpoint = structuredClone(stored.checkpoint);
    newerCheckpoint.id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    newerCheckpoint.channel_values = {
      ...newerCheckpoint.channel_values,
      pendingToolCalls: [],
    };
    await checkpointer.put(
      stored.config,
      newerCheckpoint,
      stored.metadata,
    );
    expect(
      (await checkpointer.getTuple({
        configurable: {
          thread_id: record.checkpointThreadId,
          checkpoint_ns: record.checkpointNamespace,
        },
      }))?.checkpoint.id,
    ).toBe(newerCheckpoint.id);

    const authority = clients.confirmationAuthority!;
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    clients.confirmationAuthority = { ...authority, revalidate };
    const signingSecret =
      'agent-runner-exact-resume-secret-at-least-32-bytes';
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
        approvalBindingDigest: record.approvalBindingDigest,
        providerIdempotencyKey:
          `confirmation:${record.requestId}:handoff:test`,
        attempt: 1,
        leaseToken: crypto.randomUUID(),
      },
    });
    const resumeScope = createAgentTurnExternalCallScope(1_000);

    await expect(runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: record.requestId,
        approved: false,
        action: record.action,
        checkpoint: {
          threadId: record.checkpointThreadId,
          namespace: record.checkpointNamespace,
          checkpointId: record.checkpointId,
        },
        commerceReceipt,
        executionFence,
        signingSecret,
        externalCallContext: resumeScope.context,
        abortExternalCalls: resumeScope.abort,
      },
    })).rejects.toThrow();

    expect(revalidate).toHaveBeenCalledOnce();
    expect(model.callCount).toBeGreaterThan(1);
    resumeScope.dispose();
  });

  it('configures Studio with a finite external-call scope', () => {
    const studioSource = readFileSync(
      'src/graph/studioAgent.ts',
      'utf8',
    );
    const graphSource = readFileSync(
      'src/agent/agentStateGraph.ts',
      'utf8',
    );
    const stateSchemaSource = readFileSync(
      'src/agent/agentStateSchema.ts',
      'utf8',
    );
    expect(studioSource).toMatch(
      /createAgentTurnExternalCallScope\(\s*defaultAgentTurnDeadlineMs/,
    );
    expect(studioSource).not.toMatch(/responseVerifier|verifierModel/);
    expect(stateSchemaSource).toMatch(
      /turnDeadlineAt:\s*stateField\(\s*z\.number\(\).*default\(0\)/s,
    );
    expect(`${graphSource}\n${stateSchemaSource}`).not.toMatch(
      /(?:externalCallContext|signal):\s*(?:replace|Annotation)\s*\(/,
    );
    expect(graphSource).not.toMatch(/verify_response|verifyResponse/);
  });
});
