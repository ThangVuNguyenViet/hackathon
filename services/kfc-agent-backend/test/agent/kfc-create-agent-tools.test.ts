/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- boundary tests use identity-only opaque runtime fixtures */
import { ToolMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import type { KfcCreateAgentToolCoordinator } from '../../src/agent/kfcCreateAgentToolCoordinator.js';
import {
  createKfcCreateAgentTools,
  type KfcCreateAgentContext,
} from '../../src/agent/kfcCreateAgentTools.js';
import { createKfcCreateAgentRuntime } from '../../src/agent/kfcCreateAgentRuntime.js';
import type { SingleAgentRuntimeContext } from '../../src/agent/singleAgentRuntime.js';
import type { Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { AgentToolResultForModel } from '../../src/graph/orderStatusEvidenceProjection.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';

function createContext(): KfcCreateAgentContext {
  const runtime = {
    turnInput: { sessionId: 'session-1' },
  } as SingleAgentRuntimeContext;
  const state = { sessionId: 'session-1' } as AgentGraphState;
  const currentTurnToolTrace: ToolTraceEntry[] = [];
  const currentTurnStatusOrder = {
    id: 'order-1',
  } as Order;
  return {
    runtime,
    state,
    currentTurnToolTrace,
    currentTurnStatusOrder,
    createAgentRuntime: createKfcCreateAgentRuntime({
      assertRuntimeActive: () => {},
    }),
    resolveActiveToolNames: () => [],
  };
}

function toolByName(
  tools: ReturnType<typeof createKfcCreateAgentTools>,
  name: string,
) {
  const selected = tools.find((entry) => entry.name === name);
  if (!selected) throw new Error(`missing test tool ${name}`);
  return selected;
}

async function invokeWithContext(
  selected: ReturnType<typeof toolByName>,
  args: Record<string, unknown>,
  context: KfcCreateAgentContext | undefined,
  toolCallId: string,
) {
  return selected.invoke(
    args as never,
    {
      context,
      toolCallId,
    } as never,
  );
}

describe('KFC createAgent commerce tools', () => {
  it('registers exactly the canonical ordinary commerce catalog', () => {
    const tools = createKfcCreateAgentTools();

    expect(tools.map(({ name }) => name)).toEqual(toolNames);
    expect(tools.map(({ name }) => name)).not.toContain(
      'submitGroundedResponse',
    );
  });

  it('retains each canonical provider schema and description', () => {
    const tools = createKfcCreateAgentTools();
    const definitions = commerceToolDefinitions();

    for (const [index, selected] of tools.entries()) {
      const name = toolNames[index];
      expect(selected.name).toBe(name);
      expect(selected.description).toBe(definitions[index]?.description);
      expect(selected.schema).toEqual(definitions[index]?.schema);
    }
  });

  it.each([
    {
      name: 'searchMenu',
      args: { scope: 'filtered', query: 'gà rán' },
      callId: 'read-call-1',
    },
    {
      name: 'updateCart',
      args: {
        changes: [
          {
            itemCode: 'item-1',
            quantity: 2,
            modifiers: [],
          },
        ],
      },
      callId: 'mutation-call-1',
    },
  ] as const)(
    'delegates $name exactly once through the authoritative executor',
    async ({ name, args, callId }) => {
      const outcome: AgentToolResultForModel = {
        toolName: name,
        ok: false,
        errorCode: 'provider_revision_mismatch',
        message: 'provider evidence was stale',
        provenance: [],
      };
      const execute = vi.fn().mockResolvedValue(outcome);
      const context = createContext();
      const selected = toolByName(createKfcCreateAgentTools({ execute }), name);

      const result = await invokeWithContext(selected, args, context, callId);

      expect(result).toBe(outcome);
      expect(execute).toHaveBeenCalledTimes(1);
      const [execution] = execute.mock.calls[0] ?? [];
      expect(execution).toMatchObject({
        call: {
          id: callId,
          toolName: name,
          arguments: args,
        },
      });
      expect(execution?.runtime).toBe(context.runtime);
      expect(execution?.state).toBe(context.state);
      expect(execution?.call.arguments).toStrictEqual(args);
      expect(execution?.currentTurnToolTrace).toBe(
        context.currentTurnToolTrace,
      );
      expect(execution?.currentTurnStatusOrder).toBe(
        context.currentTurnStatusOrder,
      );
    },
  );

  it('returns only the coordinated receipt with the issued execution status', async () => {
    const execute = vi.fn().mockResolvedValue({
      receipt: {
        schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
        evidenceId: 'evidence:read-call-1',
        evidenceDigest: 'a'.repeat(64),
        toolCallId: 'read-call-1',
        toolName: 'searchMenu',
        executionOutcome: 'error',
        result: 'audit_evidence_reference',
      },
      ok: false,
    });
    const context = createContext();
    (
      context as KfcCreateAgentContext & {
        toolCoordinator: KfcCreateAgentToolCoordinator;
      }
    ).toolCoordinator = {
      acceptBatch: vi.fn(),
      execute,
      snapshot: vi.fn(),
    } as never;
    const fallback = vi.fn();
    const selected = toolByName(
      createKfcCreateAgentTools({ execute: fallback as never }),
      'searchMenu',
    );

    const result = await invokeWithContext(
      selected,
      { scope: 'all', query: null },
      context,
      'read-call-1',
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect(result).toMatchObject({
      tool_call_id: 'read-call-1',
      name: 'searchMenu',
      status: 'error',
    });
    expect(JSON.parse(String(result.content))).toEqual({
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
      evidenceId: 'evidence:read-call-1',
      evidenceDigest: 'a'.repeat(64),
      toolCallId: 'read-call-1',
      toolName: 'searchMenu',
      executionOutcome: 'error',
      result: 'audit_evidence_reference',
    });
    expect(execute).toHaveBeenCalledWith({
      id: 'read-call-1',
      toolName: 'searchMenu',
      arguments: { scope: 'all', query: null },
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('fails closed before execution when runtime context is missing', async () => {
    const execute = vi.fn();
    const selected = toolByName(
      createKfcCreateAgentTools({ execute }),
      'previewCart',
    );

    await expect(
      invokeWithContext(selected, {}, undefined, 'missing-context-call'),
    ).rejects.toThrow('kfc_create_agent_context_missing');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed before execution when runtime context is incomplete', async () => {
    const execute = vi.fn();
    const selected = toolByName(
      createKfcCreateAgentTools({ execute }),
      'previewCart',
    );

    await expect(
      invokeWithContext(
        selected,
        {},
        {
          resolveActiveToolNames: () => [],
        } as unknown as KfcCreateAgentContext,
        'incomplete-context-call',
      ),
    ).rejects.toThrow('kfc_create_agent_context_missing');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects invalid arguments through the LangChain tool schema', async () => {
    const execute = vi.fn();
    const selected = toolByName(
      createKfcCreateAgentTools({ execute }),
      'updateCart',
    );

    await expect(
      invokeWithContext(
        selected,
        {
          changes: [
            {
              itemCode: 'item-1',
              quantity: -1,
              modifiers: [],
            },
          ],
        },
        createContext(),
        'invalid-arguments-call',
      ),
    ).rejects.toThrow('Received tool input did not match expected schema');
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates executor errors without translation', async () => {
    const failure = new Error('authoritative_executor_failure');
    const execute = vi.fn().mockRejectedValue(failure);
    const selected = toolByName(
      createKfcCreateAgentTools({ execute }),
      'placeOrder',
    );

    await expect(
      invokeWithContext(selected, {}, createContext(), 'place-order-call'),
    ).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('includes validateVoucher in registered tools and maps it via visibleKfcTools when active', () => {
    const tools = createKfcCreateAgentTools();
    const validateVoucherTool = tools.find(
      (entry) => entry.name === 'validateVoucher',
    );
    expect(validateVoucherTool).toBeDefined();
    expect(validateVoucherTool?.description).toContain('validateVoucher');

    const activeToolsWithVoucher: ToolName[] = [
      'updateCart',
      'validateVoucher',
    ];
    const activeToolsWithoutVoucher: ToolName[] = ['searchMenu', 'findStores'];

    const visibleWithVoucher = tools.filter((t) =>
      activeToolsWithVoucher.includes(t.name as ToolName),
    );
    const visibleWithoutVoucher = tools.filter((t) =>
      activeToolsWithoutVoucher.includes(t.name as ToolName),
    );

    expect(visibleWithVoucher.map((t) => t.name)).toContain('validateVoucher');
    expect(visibleWithoutVoucher.map((t) => t.name)).not.toContain(
      'validateVoucher',
    );
  });
});
