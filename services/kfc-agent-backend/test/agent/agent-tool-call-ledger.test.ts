import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_CALL_LEDGER_ENTRIES,
  canonicalToolCallSignature,
  classifyToolCallSignature,
  recordSuccessfulToolCall,
  relevantToolState,
  type ToolCallLedgerEntry,
} from '../../src/agent/agentToolCallLedger.js';
import type { CheckpointSafeToolEvidenceReceipt } from '../../src/agent/modelPublicationProjection.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session-1',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'show me chicken',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function receipt(toolCallId = 'call-1'): CheckpointSafeToolEvidenceReceipt {
  return {
    schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
    evidenceId: `evidence:${toolCallId}`,
    evidenceDigest: 'a'.repeat(64),
    toolCallId,
    toolName: 'updateCart',
    executionOutcome: 'success',
    result: 'audit_evidence_reference',
  };
}

async function signature(input: {
  toolName?: 'searchMenu' | 'getItemDetails' | 'updateCart' | 'getOrderStatus';
  arguments?: Record<string, unknown>;
  graphState?: AgentGraphState;
  activeToolNames?: readonly (
    'searchMenu' | 'getItemDetails' | 'updateCart' | 'getOrderStatus'
  )[];
  customerId?: string;
  sessionId?: string;
  channel?: 'kfc' | 'zalo';
}) {
  const graphState = input.graphState ?? state();
  return canonicalToolCallSignature({
    sessionId: input.sessionId ?? graphState.sessionId,
    customerId: input.customerId ?? graphState.customerId,
    channel: input.channel ?? graphState.channel,
    toolName: input.toolName ?? 'searchMenu',
    arguments: input.arguments ?? { scope: 'all', query: null },
    activeToolNames: input.activeToolNames ?? ['searchMenu'],
    relevantState: relevantToolState(
      input.toolName ?? 'searchMenu',
      graphState,
    ),
  });
}

describe('checkpoint-safe canonical tool-call ledger', () => {
  it('binds signatures to canonical arguments, identity, profile, and relevant state', async () => {
    const baseline = await signature({});

    await expect(
      signature({ arguments: { scope: 'filtered', query: 'spicy' } }),
    ).resolves.not.toBe(baseline);
    await expect(signature({ sessionId: 'session-2' })).resolves.not.toBe(
      baseline,
    );
    await expect(signature({ customerId: 'customer-2' })).resolves.not.toBe(
      baseline,
    );
    await expect(signature({ channel: 'zalo' })).resolves.not.toBe(baseline);
    await expect(
      signature({ activeToolNames: ['searchMenu', 'getItemDetails'] }),
    ).resolves.not.toBe(baseline);
  });

  it('ignores a discovery tool own result while tracking dependent prerequisites', async () => {
    const menuBefore = await signature({ toolName: 'searchMenu' });
    const menuAfter = await signature({
      toolName: 'searchMenu',
      graphState: state({
        activeMenuCollection: {
          key: 'all',
          revision: 'menu-r2',
          providerRevision: 'provider-r2',
          result: {
            items: [],
            total: 0,
            returned: 0,
            complete: true,
            scope: { scope: 'all' },
          },
        },
      }),
    });
    expect(menuAfter).toBe(menuBefore);

    const detailBefore = await signature({
      toolName: 'getItemDetails',
      arguments: { itemCode: '20751' },
      activeToolNames: ['getItemDetails'],
    });
    const detailAfter = await signature({
      toolName: 'getItemDetails',
      arguments: { itemCode: '20751' },
      activeToolNames: ['getItemDetails'],
      graphState: state({
        activeMenuCollection: {
          key: 'all',
          revision: 'menu-r2',
          providerRevision: 'provider-r2',
          result: {
            items: [],
            total: 0,
            returned: 0,
            complete: true,
            scope: { scope: 'all' },
          },
        },
      }),
    });
    expect(detailAfter).not.toBe(detailBefore);
  });

  it('classifies an unchanged successful non-poll read as no progress', async () => {
    const digest = await signature({});
    const entries = recordSuccessfulToolCall([], {
      signatureDigest: digest,
      toolName: 'searchMenu',
      effect: 'provider_read',
      receipt: null,
    });

    expect(
      classifyToolCallSignature({
        entries,
        signatureDigest: digest,
        toolName: 'searchMenu',
        effect: 'provider_read',
      }),
    ).toEqual({ kind: 'no_progress' });
  });

  it('allows unchanged order and payment status polling without growing the ledger', async () => {
    const digest = await signature({
      toolName: 'getOrderStatus',
      arguments: {},
      activeToolNames: ['getOrderStatus'],
    });
    const entry: ToolCallLedgerEntry = {
      signatureDigest: digest,
      toolName: 'getOrderStatus',
      effect: 'provider_read',
      receipt: null,
    };

    expect(
      classifyToolCallSignature({
        entries: [entry],
        signatureDigest: digest,
        toolName: 'getOrderStatus',
        effect: 'provider_read',
      }),
    ).toEqual({ kind: 'execute' });
    expect(recordSuccessfulToolCall([entry], entry)).toEqual([entry]);
  });

  it('returns a cached checkpoint-safe receipt for an exact successful mutation', async () => {
    const digest = await signature({
      toolName: 'updateCart',
      arguments: { changes: [] },
      activeToolNames: ['updateCart'],
    });
    const cached = receipt();
    const entries = recordSuccessfulToolCall([], {
      signatureDigest: digest,
      toolName: 'updateCart',
      effect: 'reversible_mutation',
      receipt: cached,
    });

    expect(
      classifyToolCallSignature({
        entries,
        signatureDigest: digest,
        toolName: 'updateCart',
        effect: 'reversible_mutation',
      }),
    ).toEqual({ kind: 'cached', receipt: cached });
  });

  it('keeps only the newest bounded entries without raw arguments', () => {
    let entries: ToolCallLedgerEntry[] = [];
    for (let index = 0; index < MAX_TOOL_CALL_LEDGER_ENTRIES + 3; index += 1) {
      entries = recordSuccessfulToolCall(entries, {
        signatureDigest: index.toString(16).padStart(64, '0'),
        toolName: 'searchMenu',
        effect: 'provider_read',
        receipt: null,
      });
    }

    expect(entries).toHaveLength(MAX_TOOL_CALL_LEDGER_ENTRIES);
    expect(entries[0]?.signatureDigest).toBe(
      (3).toString(16).padStart(64, '0'),
    );
    expect(JSON.stringify(entries)).not.toContain('arguments');
  });
});
