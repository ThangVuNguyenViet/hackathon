import { readFileSync } from 'node:fs';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentTraceSpan,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import { LangSmithAgentTracer } from '../../src/observability/langsmithAgentTracer.js';
import {
  AgentTurnExecutionError,
  agentCheckpointConfigForTurn,
  agentCheckpointThreadId,
} from '../../src/agent/agentStateGraphRunner.js';
import { createAgentTurnExternalCallScope } from '../../src/agent/singleAgentRuntime.js';
import { persistCanonicalConfirmationPause } from '../../src/api/confirmationPausePersistence.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createCommerceApprovalReceipt } from '../../src/ordering/approvalReceipt.js';
import { createCommerceApprovalExecutionFence } from '../../src/ordering/approvalExecutionFence.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { CreateConfirmationPauseInput } from '../../src/persistence/contracts.js';
import { parseCreateConfirmationPauseInput } from '../../src/persistence/confirmationPause.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { groundedResponseModelReply } from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('KFC agent StateGraph runner', () => {
  it('builds a stable checkpoint identity from the thread and namespace', () => {
    expect(
      agentCheckpointThreadId({
        threadId: 'thread-1',
        namespace: 'request-1',
      }),
    ).toBe('agent:["thread-1","request-1"]');
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
    expect(() =>
      agentCheckpointConfigForTurn({
        checkpoint: {
          threadId: 'logical-session',
          namespace: 'logical-request',
        },
        confirmationResume: {
          requestId: 'confirmation-request',
          approved: true,
        },
      }),
    ).toThrow('agent_confirmation_checkpoint_required');
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
  ])(
    'rejects a mismatched resume checkpoint before invocation',
    ({ checkpoint }) => {
      expect(() =>
        agentCheckpointConfigForTurn({
          checkpoint: {
            threadId: 'logical-session',
            namespace: 'logical-request',
          },
          confirmationResume: {
            requestId: 'confirmation-request',
            approved: true,
            checkpoint,
          },
        }),
      ).toThrow('agent_confirmation_checkpoint_mismatch');
    },
  );

  it('accepts an exact prior turn thread for a fresh interrupt request', () => {
    expect(
      agentCheckpointConfigForTurn({
        checkpoint: {
          threadId: 'logical-session',
          namespace: 'new-confirmation-request',
        },
        confirmationResume: {
          requestId: 'new-confirmation-request',
          approved: true,
          checkpoint: {
            threadId: 'agent:["logical-session","immutable-customer-turn"]',
            namespace: '',
            checkpointId: 'exact-paused-checkpoint',
          },
        },
      }),
    ).toEqual({
      configurable: {
        thread_id: 'agent:["logical-session","immutable-customer-turn"]',
        checkpoint_ns: '',
        checkpoint_id: 'exact-paused-checkpoint',
      },
    });
  });

  it('rejects a same-session checkpoint swapped against the signed fence', () => {
    expect(() =>
      agentCheckpointConfigForTurn({
        checkpoint: {
          threadId: 'logical-session',
          namespace: 'new-confirmation-request',
        },
        confirmationResume: {
          requestId: '00000000-0000-4000-8000-000000000101',
          approved: true,
          checkpoint: {
            threadId: 'agent:["logical-session","other-customer-turn"]',
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
      }),
    ).toThrow('agent_confirmation_checkpoint_mismatch');
  });

  it('keeps the runner as a directly imported acyclic leaf', () => {
    const runtimeSource = readFileSync(
      'src/agent/singleAgentRuntime.ts',
      'utf8',
    );
    const graphSource = readFileSync('src/agent/agentStateGraph.ts', 'utf8');
    const buildGraphSource = readFileSync('src/graph/buildGraph.ts', 'utf8');

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
    const stateSource = readFileSync('src/graph/agentTurnState.ts', 'utf8');
    const buildGraphSource = readFileSync('src/graph/buildGraph.ts', 'utf8');
    const turnSupportSource = readFileSync('src/graph/turnSupport.ts', 'utf8');

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

  it('prefers explicit native callbacks over active trace context', async () => {
    const modelStarted = vi.fn();
    const activeTraceEntered = vi.fn();
    const withActiveTrace: NonNullable<
      AgentTraceSpan['withActiveTrace']
    > = async <T>(fn: () => Promise<T>): Promise<T> => {
      activeTraceEntered();
      return fn();
    };
    const callback = BaseCallbackHandler.fromMethods({
      handleChatModelStart: modelStarted,
    });
    const langchainCallbacks = vi.fn(async () => [callback]);
    const span: AgentTraceSpan = {
      startSpan: vi.fn(async (): Promise<AgentTraceSpan> => span),
      end: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      langchainCallbacks,
      withActiveTrace,
    };
    const tracer: AgentTracer = {
      startTurn: vi.fn(async () => span),
      flush: vi.fn(async () => undefined),
    };

    await runAgentTurn({
      sessionId: 'agent-runner-callback-priority',
      customerId: 'callback-priority-customer',
      channel: 'messenger_mock',
      text: 'Hello',
      externalMessageId: 'callback-priority-message',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: fakeModel().respond(
        groundedResponseModelReply({
          customerText: 'Hello!',
        }),
      ),
      tracer,
    });

    expect(span.langchainCallbacks).toHaveBeenCalledOnce();
    expect(activeTraceEntered).not.toHaveBeenCalled();
    expect(modelStarted).toHaveBeenCalled();
  });

  it('injects native callbacks when active trace context is unavailable', async () => {
    const modelStarted = vi.fn();
    const callback = BaseCallbackHandler.fromMethods({
      handleChatModelStart: modelStarted,
    });
    const langchainCallbacks = vi.fn(async () => [callback]);
    const span: AgentTraceSpan = {
      startSpan: vi.fn(async (): Promise<AgentTraceSpan> => span),
      end: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      langchainCallbacks,
    };
    const tracer: AgentTracer = {
      startTurn: vi.fn(async () => span),
      flush: vi.fn(async () => undefined),
    };

    await runAgentTurn({
      sessionId: 'agent-runner-callback-trace',
      customerId: 'callback-trace-customer',
      channel: 'messenger_mock',
      text: 'Hello',
      externalMessageId: 'callback-trace-message',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: fakeModel().respond(
        groundedResponseModelReply({
          customerText: 'Hello!',
        }),
      ),
      tracer,
    });

    expect(span.langchainCallbacks).toHaveBeenCalledOnce();
    expect(modelStarted).toHaveBeenCalled();
  });

  it('uses active trace context when explicit callbacks are unavailable', async () => {
    const activeTraceEntered = vi.fn();
    const withActiveTrace: NonNullable<
      AgentTraceSpan['withActiveTrace']
    > = async <T>(fn: () => Promise<T>): Promise<T> => {
      activeTraceEntered();
      return fn();
    };
    const span: AgentTraceSpan = {
      startSpan: vi.fn(async (): Promise<AgentTraceSpan> => span),
      end: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      withActiveTrace,
    };
    const tracer: AgentTracer = {
      startTurn: vi.fn(async () => span),
      flush: vi.fn(async () => undefined),
    };

    await runAgentTurn({
      sessionId: 'agent-runner-active-trace-fallback',
      customerId: 'active-trace-fallback-customer',
      channel: 'messenger_mock',
      text: 'Hello',
      externalMessageId: 'active-trace-fallback-message',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: fakeModel().respond(
        groundedResponseModelReply({
          customerText: 'Hello!',
        }),
      ),
      tracer,
    });

    expect(activeTraceEntered).toHaveBeenCalledOnce();
  });

  it('closes successful and failed LangSmith graph, model, and tool runs exactly once', async () => {
    const requests: Array<{
      url: string;
      method: string;
      body: string;
    }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (init?.body !== undefined && init.body !== null) {
        requests.push({
          url,
          method: init.method ?? 'GET',
          body: await new Response(init.body).text(),
        });
      }
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const nativeTracer = new LangSmithAgentTracer({
      projectName: 'kfc-agent-native-lifecycle-test',
      apiKey: 'test-api-key',
      apiUrl: 'https://langsmith.invalid',
      autoBatchTracing: false,
      fetchImplementation,
    });
    const tracer: AgentTracer = {
      async startTurn(input) {
        const span = await nativeTracer.startTurn(input);
        return {
          startSpan: (childInput) => span.startSpan(childInput),
          end: (outputs) => span.end(outputs),
          fail: (error) => span.fail(error),
          langchainCallbacks: () =>
            span.langchainCallbacks?.() ?? Promise.resolve(undefined),
        };
      },
      flush: () => nativeTracer.flush(),
    };
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let lifecycleErrors: string[] = [];

    try {
      await runAgentTurn({
        sessionId: 'agent-runner-native-lifecycle',
        customerId: 'native-lifecycle-customer',
        channel: 'messenger_mock',
        text: 'Find Pepsi.',
        externalMessageId: 'native-lifecycle-message',
        clients: createMockClients(createTestFixtures()),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        checkpointer: new MemorySaver(),
        agentModel: fakeModel()
          .respondWithTools([
            {
              name: 'searchMenu',
              args: {
                scope: 'filtered',
                query: 'Pepsi',
                purpose: 'browse',
              },
            },
          ])
          .respond(
            groundedResponseModelReply({
              customerText: 'Verified Pepsi options are available.',
            }),
          ),
        tracer,
      });

      const failingClients = createMockClients(createTestFixtures());
      vi.spyOn(failingClients.menu, 'searchMenu').mockRejectedValue(
        new Error('NATIVE-TOOL-FAILURE-SENTINEL'),
      );
      await runAgentTurn({
        sessionId: 'agent-runner-native-failure-lifecycle',
        customerId: 'native-failure-lifecycle-customer',
        channel: 'messenger_mock',
        text: 'Find Pepsi even if the provider fails.',
        externalMessageId: 'native-failure-lifecycle-message',
        clients: failingClients,
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        checkpointer: new MemorySaver(),
        agentModel: fakeModel().respondWithTools([
          {
            name: 'searchMenu',
            args: {
              scope: 'filtered',
              query: 'Pepsi',
              purpose: 'browse',
            },
          },
        ]),
        tracer,
      }).catch(() => undefined);
      await tracer.flush();
      lifecycleErrors = consoleWarn.mock.calls
        .flatMap((call) => call.map(String))
        .filter((message) => /No (?:chain|LLM|tool) run to end/u.test(message));
    } finally {
      consoleWarn.mockRestore();
    }

    const parsedRequests = requests.map((request) => ({
      ...request,
      parsed: JSON.parse(request.body) as {
        id?: string;
        name?: string;
        run_type?: string;
        inputs?: unknown;
        outputs?: unknown;
        end_time?: number;
        error?: string;
      },
    }));
    const starts = parsedRequests.filter(
      (request) => request.method === 'POST' && request.url.endsWith('/runs'),
    );
    const updates = parsedRequests.filter(
      (request) => request.method === 'PATCH',
    );
    const requestSummary = parsedRequests.map((request) => ({
      method: request.method,
      id: request.parsed.id,
      name: request.parsed.name,
      runType: request.parsed.run_type,
      ended: request.parsed.end_time !== undefined,
      failed: request.parsed.error !== undefined,
    }));

    expect(lifecycleErrors, JSON.stringify(requestSummary)).toEqual([]);
    expect(starts.length).toBeGreaterThan(0);
    expect(new Set(starts.map((request) => request.parsed.id)).size).toBe(
      starts.length,
    );
    expect(new Set(starts.map((request) => request.parsed.run_type))).toEqual(
      expect.objectContaining(new Set(['chain', 'llm', 'tool'])),
    );
    for (const start of starts) {
      const id = start.parsed.id;
      expect(id).toBeTypeOf('string');
      const terminalUpdates = updates.filter((request) =>
        request.url.endsWith(`/runs/${id}`),
      );
      expect(terminalUpdates, JSON.stringify(requestSummary)).toHaveLength(1);
      expect(terminalUpdates[0]?.parsed.end_time).toBeTypeOf('number');
    }
    expect(
      updates.some((request) =>
        request.parsed.error?.includes('NATIVE-TOOL-FAILURE-SENTINEL'),
      ),
    ).toBe(true);

    const toolStart = starts.find(
      (request) =>
        request.parsed.run_type === 'tool' &&
        JSON.stringify(request.parsed.inputs).includes('Pepsi'),
    );
    expect(
      toolStart,
      JSON.stringify(
        starts
          .filter((request) => request.parsed.run_type === 'tool')
          .map((request) => ({
            id: request.parsed.id,
            name: request.parsed.name,
            inputs: request.parsed.inputs,
          })),
      ),
    ).toBeDefined();
    const toolUpdate = updates.find((request) =>
      request.url.endsWith(`/runs/${toolStart?.parsed.id}`),
    );
    expect(toolUpdate?.parsed.outputs).toBeDefined();
  });

  it('retains rejected structured response evidence on a publication failure', async () => {
    const error = await runAgentTurn({
      sessionId: 'agent-runner-rejected-response',
      customerId: 'rejected-response-customer',
      channel: 'messenger_mock',
      text: 'Tell me something unsupported.',
      externalMessageId: 'rejected-response-message',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: fakeModel().respond(
        groundedResponseModelReply({
          customerText:
            'This unsupported answer must remain available to diagnostics.',
          hasUnsupportedFactualClaim: true,
        }),
      ),
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AgentTurnExecutionError);
    expect(error).toMatchObject({
      message: 'agent_response_claim_unsupported',
      evidence: {
        responseText:
          'This unsupported answer must remain available to diagnostics.',
        responseFactualClaims: {
          evidenceReferences: [],
          hasUnsupportedFactualClaim: true,
        },
        responsePublicationDeclaration: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'none',
          disclosureAuthorities: [],
          disclosesInternalMetadata: false,
        },
        currentTurnToolTrace: [],
      },
    });
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
      agentModel: fakeModel().respondWithTools([
        {
          name: 'handoff',
          args: { reasons: ['needs human support'] },
        },
      ]),
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
    expect(descriptor).toEqual(
      expect.objectContaining({
        configurable: false,
        enumerable: false,
        writable: false,
      }),
    );
    expect(JSON.stringify(output.pause)).not.toContain('checkpointId');
    expect(JSON.stringify(output.pause)).not.toContain(
      accessContext.authenticationEvidence.state === 'verified'
        ? accessContext.authenticationEvidence.evidenceRef
        : 'unreachable',
    );
    expect(
      (await store.listEvents(sessionId)).filter(
        ({ sourceType }) => sourceType === 'graph:verified_state',
      ),
    ).toHaveLength(1);

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
    const model = fakeModel().respondWithTools([
      {
        name: 'handoff',
        args: { reasons: ['needs human support'] },
      },
    ]);
    const runGuard = {
      // Deliberately model a TOCTOU authority loss that an in-memory current
      // check does not observe. Only the durable commit fence is authoritative.
      isCurrent: vi.fn(async () => true),
      commitFence: {
        kind: 'customer_run' as const,
        runId,
        sessionAuthorityGeneration: createdRun.sessionAuthorityGeneration,
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
    expect(
      (await store.listEvents(sessionId)).filter(
        ({ sourceType }) => sourceType === 'graph:verified_state',
      ),
    ).toEqual([]);

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
    expect(
      (await store.listEvents(sessionId)).filter(
        ({ sourceType }) =>
          sourceType === 'graph:verified_state' ||
          sourceType === 'confirmation_pause_created',
      ),
    ).toEqual([]);
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
      .respondWithTools([
        {
          name: 'handoff',
          args: { reasons: ['needs human support'] },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'No action was taken.',
        }),
      );
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
    const record = await parseCreateConfirmationPauseInput(descriptor?.value);
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
    await checkpointer.put(stored.config, newerCheckpoint, stored.metadata);
    expect(
      (
        await checkpointer.getTuple({
          configurable: {
            thread_id: record.checkpointThreadId,
            checkpoint_ns: record.checkpointNamespace,
          },
        })
      )?.checkpoint.id,
    ).toBe(newerCheckpoint.id);

    const authority = clients.confirmationAuthority!;
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    clients.confirmationAuthority = { ...authority, revalidate };
    const signingSecret = 'agent-runner-exact-resume-secret-at-least-32-bytes';
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
        providerIdempotencyKey: `confirmation:${record.requestId}:handoff:test`,
        attempt: 1,
        leaseToken: crypto.randomUUID(),
      },
    });
    const resumeScope = createAgentTurnExternalCallScope(1_000);

    await expect(
      runAgentTurn({
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
      }),
    ).resolves.toMatchObject({
      responseText: 'No action was taken.',
      status: 'completed',
    });

    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]?.[1]).toBe(resumeScope.context);
    expect(model.callCount).toBe(2);
    resumeScope.dispose();
  });

  it('configures Studio with a finite external-call scope', () => {
    const studioSource = readFileSync('src/graph/studioAgent.ts', 'utf8');
    const graphSource = readFileSync('src/agent/agentStateGraph.ts', 'utf8');
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
