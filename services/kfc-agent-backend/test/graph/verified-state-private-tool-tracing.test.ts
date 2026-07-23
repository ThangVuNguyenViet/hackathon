import { describe, expect, it } from 'vitest';
import {
  isPrivateResponseEvidenceTool,
} from '../../src/agent/responseEvidenceContracts.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  applyToolResultToState,
  buildVerifiedStateSnapshot,
  toolCalledEventProjection,
  verifiedStateToolTraceForPersistence,
} from '../../src/graph/verifiedState.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import type {
  ToolCallResult,
  ToolTraceEntry,
} from '../../src/ordering/types.js';

const privateToolNames = toolNames.filter(
  isPrivateResponseEvidenceTool,
);

function emptyState(): AgentGraphState {
  return {
    sessionId: 'private-trace-session',
    customerId: 'private-trace-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

function turnInput(
  dashboard: DashboardEventBus,
): AgentTurnInput {
  return {
    sessionId: 'private-trace-session',
    dashboard,
  } as AgentTurnInput;
}

function expectNoSentinels(
  value: unknown,
  sentinels: readonly string[],
): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of sentinels) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe('verified-state private tool trace projections', () => {
  it('uses the authoritative private contract for every durable trace', () => {
    expect(privateToolNames).toHaveLength(15);
    const sentinels = [
      'private-argument-value',
      'private-provider-message',
      'private-provider-error',
      'private-source-file',
      'https://private.invalid/provider',
      'private-provider-api',
    ] as const;

    for (const toolName of privateToolNames) {
      for (const ok of [true, false]) {
        const trace: ToolTraceEntry = {
          toolName,
          arguments: {
            customerValue: sentinels[0],
          },
          ok,
          resultSummary: ok ? sentinels[1] : sentinels[2],
          provenance: [{
            fixtureMode: 'provider_runtime',
            sourceFile: sentinels[3],
            sourceUrl: sentinels[4],
            sourceApi: sentinels[5],
            serverPolicy: {
              policyId: 'approved-policy',
              revision: 'approved-revision',
            },
          }],
        };

        const durable =
          verifiedStateToolTraceForPersistence(
            trace,
            'a'.repeat(64),
          );

        expect(durable).toMatchObject({
          toolName,
          arguments: {
            privateArgumentsDigest: 'a'.repeat(64),
          },
          ok,
          resultSummary: expect.stringMatching(
            /^(?:private_tool_(?:observed|failed)|recent_order_(?:observed|lookup_failed)|order_status_(?:observed|lookup_failed)|payment_status_(?:observed|check_failed))$/u,
          ),
          provenance: [{
            fixtureMode: 'provider_runtime',
            serverPolicy: {
              policyId: 'approved-policy',
              revision: 'approved-revision',
            },
          }],
        });
        expectNoSentinels(durable, sentinels);
        expect(toolCalledEventProjection(trace)).toMatchObject({
          updateType: 'tool_called',
          toolName,
          ok,
          privateEvidenceTool: true,
          resultSummary: durable.resultSummary,
          provenance: durable.provenance,
        });
        expectNoSentinels(
          toolCalledEventProjection(trace),
          sentinels,
        );
      }
    }
  });

  it('redacts successful invoice trace state and tool-called events', () => {
    const dashboard = new DashboardEventBus();
    const state = emptyState();
    const sentinels = [
      'Private Invoice Company',
      'private-tax-code-012345',
      'private-invoice@example.invalid',
      'private invoice provider message',
      'private-invoice-provider.ts',
      'https://private.invalid/invoice',
      'private-invoice-api',
    ] as const;
    const result: ToolCallResult = {
      toolName: 'collectInvoice',
      ok: true,
      value: {
        companyName: sentinels[0],
        taxCode: sentinels[1],
        email: sentinels[2],
      },
      message: sentinels[3],
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: sentinels[4],
        sourceUrl: sentinels[5],
        sourceApi: sentinels[6],
      }],
    };

    applyToolResultToState(
      turnInput(dashboard),
      state,
      result,
      {
        companyName: sentinels[0],
        taxCode: sentinels[1],
        email: sentinels[2],
      },
      [],
    );

    const persistedTrace =
      buildVerifiedStateSnapshot(state).toolTrace;
    const events = dashboard.getEvents(state.sessionId);

    expect(persistedTrace).toEqual([{
      toolName: 'collectInvoice',
      arguments: { privateArgumentsRedacted: true },
      ok: true,
      resultSummary: 'private_tool_observed',
      provenance: [{ fixtureMode: 'provider_runtime' }],
    }]);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'session_updated',
        payload: {
          updateType: 'tool_called',
          toolName: 'collectInvoice',
          boundary: 'invoice',
          ok: true,
          resultSummary: 'private_tool_observed',
          provenance: [{ fixtureMode: 'provider_runtime' }],
          privateEvidenceTool: true,
        },
      }),
      expect.objectContaining({
        type: 'session_updated',
        payload: {
          updateType: 'invoice_requested',
        },
      }),
    ]);
    expectNoSentinels(persistedTrace, sentinels);
    expectNoSentinels(events, sentinels);
  });

  it('redacts failed invoice trace state without emitting provider data', () => {
    const dashboard = new DashboardEventBus();
    const state = emptyState();
    const sentinels = [
      'Private Failed Company',
      'private-failed-tax-code',
      'private-failed-invoice@example.invalid',
      'private invoice provider failure',
      'private_invoice_provider_error',
      'private-failed-invoice-provider.ts',
      'https://private.invalid/invoice-failure',
      'private-failed-invoice-api',
    ] as const;
    const result: ToolCallResult = {
      toolName: 'collectInvoice',
      ok: false,
      errorCode: sentinels[4],
      message: sentinels[3],
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: sentinels[5],
        sourceUrl: sentinels[6],
        sourceApi: sentinels[7],
      }],
    };

    applyToolResultToState(
      turnInput(dashboard),
      state,
      result,
      {
        companyName: sentinels[0],
        taxCode: sentinels[1],
        email: sentinels[2],
      },
      [],
    );

    const persistedTrace =
      buildVerifiedStateSnapshot(state).toolTrace;
    const events = dashboard.getEvents(state.sessionId);

    expect(persistedTrace).toEqual([{
      toolName: 'collectInvoice',
      arguments: { privateArgumentsRedacted: true },
      ok: false,
      resultSummary: 'private_tool_failed',
      provenance: [{ fixtureMode: 'provider_runtime' }],
    }]);
    expect(events).toEqual([]);
    expectNoSentinels(persistedTrace, sentinels);
    expectNoSentinels(events, sentinels);
  });
});
