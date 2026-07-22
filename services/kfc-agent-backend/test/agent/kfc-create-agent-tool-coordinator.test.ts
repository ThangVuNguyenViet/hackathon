import { describe, expect, it, vi } from 'vitest';
import {
  createKfcCreateAgentToolCoordinator,
  type KfcAcceptedToolCall,
  type KfcCreateAgentToolCoordinatorInput,
} from '../../src/agent/kfcCreateAgentToolCoordinator.js';
import { createKfcCreateAgentRuntime } from '../../src/agent/kfcCreateAgentRuntime.js';
import {
  canonicalToolCallSignature,
  classifyToolCallSignature,
  relevantToolState,
} from '../../src/agent/agentToolCallLedger.js';
import type { PublicationToolBatchResult } from '../../src/agent/agentPublicationRuntime.js';
import type { GraphExecutedToolResult } from '../../src/agent/graphExecutedToolResult.js';
import type {
  PendingToolCall,
  SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type {
  CheckpointSafeToolEvidenceReceipt,
  ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import type { ModelPublicationAuthority } from '../../src/agent/modelPublicationAuthority.js';

function graphState(latestUserMessage: string): AgentGraphState {
  return {
    sessionId: 'session-1',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

function publicationBundle(projectionDigest: string): ModelPublicationBundle {
  return {
    schemaVersion: 'kfc-model-publication-v1',
    modelState: {},
    evidence: [],
    allowedEvidenceIds: [],
    projectionDigest,
    lifecycle: {
      currentUserMessageDigest: 'message-digest',
      authorityDigest: 'authority',
      currentTurnRevision: 'revision',
      order: 'none',
      cart: 'none',
      address: 'none',
      fulfillment: 'none',
      payment: 'none',
      customerHistory: 'hidden',
    },
  };
}

function successfulResult(
  call: PendingToolCall,
): GraphExecutedToolResult['result'] {
  if (call.toolName === 'searchMenu') {
    return {
      toolName: 'searchMenu',
      ok: true,
      value: {
        items: [],
        total: 0,
        returned: 0,
        complete: true,
        scope: { scope: 'all' },
      },
      message: 'success',
      provenance: [],
    };
  }
  if (call.toolName === 'searchPromotions') {
    return {
      toolName: 'searchPromotions',
      ok: true,
      value: {
        items: [],
        total: 0,
        returned: 0,
        complete: true,
        scope: { scope: 'all' },
      },
      message: 'success',
      provenance: [],
    };
  }
  if (call.toolName === 'updateCart') {
    return {
      toolName: 'updateCart',
      ok: true,
      value: {
        id: 'cart-1',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
      message: 'success',
      provenance: [],
    };
  }
  if (call.toolName === 'placeOrder') {
    return {
      toolName: 'placeOrder',
      ok: true,
      value: {
        id: 'order-1',
        cart: {
          id: 'cart-1',
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
        status: 'created',
        paymentStatus: 'pending',
        assignedStoreId: 'store-1',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
      message: 'success',
      provenance: [],
    };
  }
  throw new Error(`unsupported test tool: ${call.toolName}`);
}

function acceptedCall(
  call: PendingToolCall,
  input: Partial<Pick<KfcAcceptedToolCall, 'effect' | 'handling'>> = {},
): KfcAcceptedToolCall {
  return {
    ...call,
    signatureDigest: Buffer.from(call.id, 'utf8')
      .toString('hex')
      .padEnd(64, '0')
      .slice(0, 64),
    effect:
      input.effect ??
      (call.toolName === 'updateCart'
        ? 'reversible_mutation'
        : 'provider_read'),
    handling: input.handling ?? { kind: 'execute' },
  };
}

function receipt(call: PendingToolCall): CheckpointSafeToolEvidenceReceipt {
  return {
    schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
    evidenceId: `evidence:${call.id}`,
    evidenceDigest: call.id.padEnd(64, '0').slice(0, 64),
    toolCallId: call.id,
    toolName: call.toolName,
    executionOutcome: 'success',
    result: 'audit_evidence_reference',
  };
}

function batchResult(
  calls: readonly PendingToolCall[],
  revision: string,
): PublicationToolBatchResult {
  return {
    state: graphState(revision),
    currentTurnToolTrace: calls.map((call) => ({
      toolName: call.toolName,
      arguments: call.arguments,
      ok: true,
      resultSummary: revision,
      provenance: [],
    })),
    executions: calls.map((call) => ({
      authorityDigest: 'authority',
      toolCallId: call.id,
      result: successfulResult(call),
    })),
    evidence: calls.map((call) => ({
      schemaVersion: 'kfc-current-turn-response-evidence-v1',
      evidenceId: `evidence:${call.id}`,
      toolCallId: call.id,
      toolName: call.toolName,
      claimKinds: [],
      value: null,
      digest: call.id.padEnd(64, '0').slice(0, 64),
      authorityDigest: 'authority',
      currentTurnRevision: 'revision',
      privateData: false,
      executionOutcome: 'success',
    })),
    receipts: calls.map(receipt),
    bundle: publicationBundle(revision),
    failed: false,
  };
}

function publicationAuthority(): ModelPublicationAuthority {
  return {
    schemaVersion: 'kfc-model-publication-authority-v2',
    sessionId: 'session-1',
    customerId: 'customer-1',
    channel: 'kfc',
    currentTurnId: 'turn-1',
    currentTurnRevision: 'revision',
    currentTurnExternalUserId: null,
    surfaceSubjectRef: 'not-applicable',
    privateAccess: { state: 'none' },
    authorityDigest: 'authority',
  };
}

function runtimeContext(
  turnInput?: SingleAgentRuntimeContext['turnInput'],
): SingleAgentRuntimeContext {
  return {
    get turnInput(): SingleAgentRuntimeContext['turnInput'] {
      return turnInput ?? ({} as SingleAgentRuntimeContext['turnInput']);
    },
    get turnTrace(): never {
      throw new Error('unused coordinator test trace');
    },
    get externalCallContext(): never {
      throw new Error('unused coordinator test external call context');
    },
    abortExternalCalls() {},
    disposeExternalCalls() {},
  };
}

function coordinator(
  input: {
    toolCallLedger?: Parameters<
      typeof createKfcCreateAgentRuntime
    >[0]['toolCallLedger'];
    runtime?: SingleAgentRuntimeContext;
    resolveActiveToolNames?: KfcCreateAgentToolCoordinatorInput['resolveActiveToolNames'];
  } = {},
) {
  const executeParallel = vi.fn<
    NonNullable<KfcCreateAgentToolCoordinatorInput['executeParallel']>
  >(async (executionInput) => batchResult(executionInput.calls, 'parallel'));
  const executeSequential = vi.fn<
    NonNullable<KfcCreateAgentToolCoordinatorInput['executeSequential']>
  >(async (executionInput) => batchResult(executionInput.calls, 'sequential'));
  const createAgentRuntime = createKfcCreateAgentRuntime({
    assertRuntimeActive: vi.fn(),
    toolCallLedger: input.toolCallLedger,
  });
  const value = createKfcCreateAgentToolCoordinator({
    authority: publicationAuthority(),
    runtime: input.runtime ?? runtimeContext(),
    createAgentRuntime,
    state: graphState('initial'),
    currentTurnToolTrace: [],
    executions: [],
    evidence: [],
    receipts: [],
    bundle: publicationBundle('initial'),
    executeParallel,
    executeSequential,
    resolveActiveToolNames: input.resolveActiveToolNames,
  });
  return {
    value,
    createAgentRuntime,
    executeParallel,
    executeSequential,
  };
}

describe('KFC createAgent publication tool coordinator', () => {
  it('rendezvous all authored reads and publishes them once in model order', async () => {
    const { value, executeParallel, executeSequential } = coordinator();
    const calls: [PendingToolCall, PendingToolCall] = [
      {
        id: 'menu',
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
      },
      {
        id: 'promotions',
        toolName: 'searchPromotions',
        arguments: { scope: 'all', query: null },
      },
    ];
    const accepted = calls.map((call) => acceptedCall(call));
    value.acceptBatch(accepted);

    const second = value.execute(accepted[1]!);
    const first = value.execute(accepted[0]!);

    await expect(Promise.all([second, first])).resolves.toEqual([
      { receipt: receipt(calls[1]), ok: true },
      { receipt: receipt(calls[0]), ok: true },
    ]);
    expect(executeParallel).toHaveBeenCalledOnce();
    expect(executeParallel.mock.calls[0]?.[0].calls).toEqual(calls);
    expect(executeSequential).not.toHaveBeenCalled();
    expect(value.snapshot()).toMatchObject({
      state: { latestUserMessage: 'parallel' },
      currentTurnToolTrace: [
        { toolName: 'searchMenu' },
        { toolName: 'searchPromotions' },
      ],
      receipts: [{ toolCallId: 'menu' }, { toolCallId: 'promotions' }],
      bundle: { projectionDigest: 'parallel' },
    });
  });

  it('executes a resumed singleton without transient accepted-batch state', async () => {
    const { value, executeParallel, executeSequential } = coordinator();
    const call: PendingToolCall = {
      id: 'cart',
      toolName: 'updateCart',
      arguments: { changes: [] },
    };

    await expect(value.execute(acceptedCall(call))).resolves.toEqual({
      receipt: receipt(call),
      ok: true,
    });
    expect(executeSequential).toHaveBeenCalledOnce();
    expect(executeSequential.mock.calls[0]?.[0].calls).toEqual([call]);
    expect(executeParallel).not.toHaveBeenCalled();
  });

  it('reconstructs the exact approved singleton after a HITL checkpoint', async () => {
    const call: PendingToolCall = {
      id: 'place-order-resume',
      toolName: 'placeOrder',
      arguments: {},
    };
    const runtime = runtimeContext({
      confirmationResume: {
        requestId: 'approval-1',
        approved: true,
        action: {
          toolName: call.toolName,
          arguments: call.arguments,
        },
      },
    } as SingleAgentRuntimeContext['turnInput']);
    const { value, executeParallel, executeSequential } = coordinator({
      runtime,
      resolveActiveToolNames: () => ['placeOrder'],
    });

    await expect(value.execute(call)).resolves.toEqual({
      receipt: receipt(call),
      ok: true,
    });
    expect(executeSequential).toHaveBeenCalledOnce();
    expect(executeSequential.mock.calls[0]?.[0].calls).toEqual([call]);
    expect(executeParallel).not.toHaveBeenCalled();
  });

  it('rejects an unbound plain singleton outside approval resume', async () => {
    const { value, executeParallel, executeSequential } = coordinator({
      resolveActiveToolNames: () => ['placeOrder'],
    });

    await expect(
      value.execute({
        id: 'place-order-unbound',
        toolName: 'placeOrder',
        arguments: {},
      }),
    ).rejects.toThrow('kfc_create_agent_tool_call_binding_missing');
    expect(executeSequential).not.toHaveBeenCalled();
    expect(executeParallel).not.toHaveBeenCalled();
  });

  it('rejects calls that do not exactly match the accepted authored batch', async () => {
    const { value, executeParallel, executeSequential } = coordinator();
    value.acceptBatch([
      acceptedCall({
        id: 'menu',
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
      }),
    ]);

    await expect(
      value.execute(
        acceptedCall({
          id: 'menu',
          toolName: 'searchMenu',
          arguments: { scope: 'all', query: 'changed' },
        }),
      ),
    ).rejects.toThrow('kfc_create_agent_tool_call_mismatch');
    expect(executeParallel).not.toHaveBeenCalled();
    expect(executeSequential).not.toHaveBeenCalled();
  });

  it('records a ledger entry only after verified successful execution', async () => {
    const { value, createAgentRuntime, executeParallel, executeSequential } =
      coordinator();
    const call = acceptedCall({
      id: 'cart',
      toolName: 'updateCart',
      arguments: { changes: [] },
    });

    await expect(value.execute(call)).resolves.toEqual({
      receipt: receipt(call),
      ok: true,
    });

    expect(executeSequential).toHaveBeenCalledOnce();
    expect(executeParallel).not.toHaveBeenCalled();
    expect(createAgentRuntime.toolCallLedger).toEqual([
      {
        signatureDigest: call.signatureDigest,
        toolName: 'updateCart',
        effect: 'reversible_mutation',
        receipt: receipt(call),
      },
    ]);
  });

  it('records a post-success signature alias for exact mutation retries', async () => {
    const call: PendingToolCall = {
      id: 'cart-state-change',
      toolName: 'updateCart',
      arguments: { changes: [] },
    };
    const activeToolNames = ['updateCart'] as const;
    const initialState = graphState('initial');
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: initialState.sessionId,
      customerId: initialState.customerId,
      channel: initialState.channel,
      toolName: call.toolName,
      arguments: call.arguments,
      activeToolNames,
      relevantState: relevantToolState(call.toolName, initialState),
    });
    const postState: AgentGraphState = {
      ...graphState('post-mutation'),
      cart: {
        id: 'cart-1',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
    };
    const executeSequential = vi.fn<
      NonNullable<KfcCreateAgentToolCoordinatorInput['executeSequential']>
    >(async (executionInput) => ({
      ...batchResult(executionInput.calls, 'post-mutation'),
      state: postState,
    }));
    const createAgentRuntime = createKfcCreateAgentRuntime({
      assertRuntimeActive: vi.fn(),
    });
    const value = createKfcCreateAgentToolCoordinator({
      authority: publicationAuthority(),
      runtime: runtimeContext(),
      createAgentRuntime,
      state: initialState,
      currentTurnToolTrace: [],
      executions: [],
      evidence: [],
      receipts: [],
      bundle: publicationBundle('initial'),
      executeSequential,
      resolveActiveToolNames: () => activeToolNames,
    });
    const accepted = acceptedCall(call, { effect: 'reversible_mutation' });
    accepted.signatureDigest = signatureDigest;

    await expect(value.execute(accepted)).resolves.toEqual({
      receipt: receipt(call),
      ok: true,
    });

    const postSignatureDigest = await canonicalToolCallSignature({
      sessionId: postState.sessionId,
      customerId: postState.customerId,
      channel: postState.channel,
      toolName: call.toolName,
      arguments: call.arguments,
      activeToolNames,
      relevantState: relevantToolState(call.toolName, postState),
    });
    expect(postSignatureDigest).not.toBe(signatureDigest);
    expect(
      classifyToolCallSignature({
        entries: createAgentRuntime.toolCallLedger,
        signatureDigest: postSignatureDigest,
        toolName: call.toolName,
        effect: 'reversible_mutation',
      }),
    ).toEqual({ kind: 'cached', receipt: receipt(call) });
  });

  it.each([
    'agent_tool_provider_failed',
    'customer_run_cancelled',
    'agent_turn_deadline_exceeded',
  ])(
    'does not record a mutation when execution fails with %s',
    async (failure) => {
      const executeSequential = vi.fn<
        NonNullable<KfcCreateAgentToolCoordinatorInput['executeSequential']>
      >(async () => {
        throw new Error(failure);
      });
      const createAgentRuntime = createKfcCreateAgentRuntime({
        assertRuntimeActive: vi.fn(),
      });
      const value = createKfcCreateAgentToolCoordinator({
        authority: publicationAuthority(),
        runtime: runtimeContext(),
        createAgentRuntime,
        state: graphState('initial'),
        currentTurnToolTrace: [],
        executions: [],
        evidence: [],
        receipts: [],
        bundle: publicationBundle('initial'),
        executeSequential,
      });
      const call = acceptedCall({
        id: `cart-${failure}`,
        toolName: 'updateCart',
        arguments: { changes: [] },
      });

      await expect(value.execute(call)).rejects.toThrow(failure);
      expect(createAgentRuntime.toolCallLedger).toEqual([]);
    },
  );

  it('returns a cached successful mutation without provider execution', async () => {
    const call = acceptedCall({
      id: 'cart-retry',
      toolName: 'updateCart',
      arguments: { changes: [] },
    });
    const cachedReceipt = receipt({ ...call, id: 'cart-original' });
    const { value, createAgentRuntime, executeParallel, executeSequential } =
      coordinator({
        toolCallLedger: [
          {
            signatureDigest: call.signatureDigest,
            toolName: 'updateCart',
            effect: 'reversible_mutation',
            receipt: cachedReceipt,
          },
        ],
      });
    const cachedCall = acceptedCall(call, {
      handling: { kind: 'cached', receipt: cachedReceipt },
    });

    await expect(value.execute(cachedCall)).resolves.toEqual({
      receipt: cachedReceipt,
      ok: true,
    });

    expect(executeParallel).not.toHaveBeenCalled();
    expect(executeSequential).not.toHaveBeenCalled();
    expect(createAgentRuntime.toolCallLedger).toHaveLength(1);
    expect(value.snapshot().currentTurnToolTrace).toEqual([]);
  });
});
