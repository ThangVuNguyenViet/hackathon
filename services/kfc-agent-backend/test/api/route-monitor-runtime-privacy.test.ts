import { describe, expect, it } from 'vitest';
import {
  createRouteMonitorRuntime,
  privacySafeMonitorTraceInputs,
} from '../../src/api/routeMonitorRuntime.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { DashboardEvent } from '../../src/domain/types.js';
import { createAgentTraceContext } from '../../src/graph/agentTraceContext.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('post-turn monitor trace privacy', () => {
  it('records only structural verified-state evidence and a digest', async () => {
    const privateAddress = {
      label: 'private-monitor-label-Ψ',
      line1: 'private-monitor-line-Ψ',
      district: 'private-monitor-district-Ψ',
      city: 'private-monitor-city-Ψ',
    };
    const privateRefId = 'private-monitor-saved-ref-Ψ';
    const state: AgentGraphState = {
      sessionId: 'monitor-private-session',
      customerId: 'monitor-private-customer',
      channel: 'kfc',
      latestUserMessage: 'private-monitor-user-message-Ψ',
      recentTurns: [{
        id: 'private-monitor-turn-id-Ψ',
        sessionId: 'monitor-private-session',
        channel: 'kfc',
        role: 'assistant',
        text: 'private-monitor-assistant-message-Ψ',
        createdAt: '2026-07-20T00:00:00.000Z',
        deliveryStatus: 'sent',
        externalMessageId: null,
        externalUserId: 'monitor-private-customer',
        metadata: null,
      }],
      cart: {
        id: 'private-monitor-cart-id-Ψ',
        items: [{
          itemCode: '41141',
          name: 'Zinger Burger',
          quantity: 2,
          unitPriceVnd: 55_000,
        }],
        subtotalVnd: 110_000,
        discountVnd: 0,
        deliveryFeeVnd: 18_000,
        totalVnd: 128_000,
        voucherCode: null,
      },
      address: privateAddress,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'private-monitor-store-id-Ψ',
        storeName: 'private-monitor-store-name-Ψ',
        feeVnd: 18_000,
        etaMinutes: 30,
        availability: {
          ok: true,
          checkedItemIds: ['41141'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'provider_runtime',
            sourceFile: 'private-monitor-provider-source-Ψ',
            sourceApi: 'private-monitor-provider-api-Ψ',
          },
        },
        resolvedAddress: privateAddress,
      },
      customerContext: {
        savedAddresses: [privateAddress],
        recentOrders: [],
        favorites: [],
      },
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [{
        toolName: 'quoteFulfillment',
        arguments: {
          savedAddressRef: {
            kind: 'saved_address',
            id: privateRefId,
          },
          method: 'delivery',
        },
        ok: true,
        resultSummary: 'private-monitor-provider-prose-Ψ',
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'private-monitor-provider-source-Ψ',
          sourceApi: 'private-monitor-provider-api-Ψ',
        }],
      }],
    };
    const dashboardEvents: DashboardEvent[] = [{
      id: 'private-monitor-dashboard-event-id-Ψ',
      sessionId: state.sessionId,
      type: 'conversation_turn_created',
      payload: {
        privateAddress,
        providerDebug: 'private-monitor-dashboard-payload-Ψ',
      },
      createdAt: '2026-07-20T00:00:01.000Z',
    }];

    const inputs = await privacySafeMonitorTraceInputs({
      state,
      dashboardEvents,
      customerTurnCount: 3,
    });

    expect(inputs).toEqual({
      customerTurnCount: 3,
      verifiedStateDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      state: {
        cartItemCount: 1,
        cartQuantityTotal: 2,
        addressPresent: false,
        addressDraftPresent: false,
        fulfillmentPresent: true,
        orderPreviewPresent: false,
        orderPresent: false,
        paymentAttemptPresent: false,
        handoffPresent: false,
        pendingSavedAddressRefPresent: false,
        escalationReasonCount: 0,
        toolNames: ['quoteFulfillment'],
      },
      dashboardEvents: [{
        type: 'conversation_turn_created',
        createdAt: '2026-07-20T00:00:01.000Z',
      }],
    });
    const serialized = JSON.stringify(inputs);
    for (const privateValue of [
      ...Object.values(privateAddress),
      privateRefId,
      'private-monitor-user-message-Ψ',
      'private-monitor-assistant-message-Ψ',
      'private-monitor-provider-prose-Ψ',
      'private-monitor-provider-source-Ψ',
      'private-monitor-provider-api-Ψ',
      'private-monitor-dashboard-payload-Ψ',
      'private-monitor-dashboard-event-id-Ψ',
      'private-monitor-cart-id-Ψ',
      'private-monitor-store-id-Ψ',
      'private-monitor-store-name-Ψ',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('passes the structural projection to the actual deferred trace boundary', async () => {
    const rawSavedAddress = {
      label: 'captured-monitor-private-label-Ω',
      line1: 'captured-monitor-private-line-Ω',
      district: 'captured-monitor-private-district-Ω',
      city: 'captured-monitor-private-city-Ω',
    };
    const rawProviderProse = 'captured-monitor-provider-prose-Ω';
    const rawDashboardPayload = 'captured-monitor-dashboard-payload-Ω';
    const state: AgentGraphState = {
      sessionId: 'kfc:captured-monitor-private-session',
      customerId: 'captured-monitor-private-customer',
      channel: 'kfc',
      latestUserMessage: 'captured-monitor-private-user-message-Ω',
      cart: {
        id: 'captured-monitor-private-cart-Ω',
        items: [{
          itemCode: '41141',
          name: 'Zinger Burger',
          quantity: 1,
          unitPriceVnd: 55_000,
        }],
        subtotalVnd: 55_000,
        discountVnd: 0,
        deliveryFeeVnd: 18_000,
        totalVnd: 73_000,
        voucherCode: null,
      },
      address: rawSavedAddress,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'captured-monitor-private-store-Ω',
        storeName: 'captured-monitor-private-store-name-Ω',
        feeVnd: 18_000,
        etaMinutes: 30,
        availability: {
          ok: true,
          checkedItemIds: ['41141'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'provider_runtime',
            sourceFile: 'captured-monitor-private-source-Ω',
          },
        },
        resolvedAddress: rawSavedAddress,
      },
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [{
        toolName: 'quoteFulfillment',
        arguments: {
          savedAddressRef: {
            kind: 'saved_address',
            id: 'captured-monitor-private-ref-Ω',
          },
          method: 'delivery',
        },
        ok: true,
        resultSummary: rawProviderProse,
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'captured-monitor-private-source-Ω',
        }],
      }],
    };
    const dashboard = new DashboardEventBus({
      initialEvents: [{
        id: 'captured-monitor-private-event-Ω',
        sessionId: state.sessionId,
        type: 'conversation_turn_created',
        payload: {
          rawDashboardPayload,
          rawSavedAddress,
        },
        createdAt: '2026-07-20T00:00:02.000Z',
      }],
    });
    const capturedTurns: Array<
      Omit<AgentTraceSpanInput, 'runType'>
    > = [];
    const deferred: Array<() => Promise<void>> = [];
    const span: AgentTraceSpan = {
      async startSpan() {
        return span;
      },
      async end() {},
      async fail() {},
    };
    const runtime = createRouteMonitorRuntime({
      store: new MemoryStore(),
      dashboard,
      options: {
        defer(task) {
          deferred.push(task);
        },
        agentTracer: {
          async startTurn(input) {
            capturedTurns.push(input);
            return span;
          },
          async flush() {},
        },
        monitorJudge: {
          async judge(input) {
            return {
              ...input.deterministicFallback,
              contextSummary:
                'Phiên đang được AI tiếp tục xử lý.',
              source: 'ai_monitor_judge',
              model: 'monitor-privacy-test',
              promptVersion: 'monitor-privacy-test-v1',
            };
          },
        },
      },
    });

    runtime.deferAiMonitorRefinement({
      sessionId: state.sessionId,
      output: { state },
      traceContext: createAgentTraceContext({
        scenarioId: 'server-only-monitor-scenario',
        probeRunId: 'server-only-monitor-probe-1',
      }),
      metadata: {
        rawEvent: {
          scenarioId: 'public-forged-monitor-scenario-Ω',
          probeRunId: 'public-forged-monitor-probe-Ω',
        },
      },
    });
    expect(deferred).toHaveLength(1);
    await deferred[0]!();

    expect(capturedTurns).toHaveLength(1);
    expect(capturedTurns[0]).toMatchObject({
      name: 'post_turn_monitor',
      inputs: {
        verifiedStateDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        state: {
          addressPresent: false,
          fulfillmentPresent: true,
          toolNames: ['quoteFulfillment'],
        },
      },
      metadata: {
        probeRunId: 'server-only-monitor-probe-1',
      },
    });
    const serializedTrace = JSON.stringify(capturedTurns[0]);
    expect(serializedTrace).not.toContain(
      'public-forged-monitor-scenario-Ω',
    );
    expect(serializedTrace).not.toContain(
      'public-forged-monitor-probe-Ω',
    );
    for (const privateValue of [
      ...Object.values(rawSavedAddress),
      rawProviderProse,
      rawDashboardPayload,
      state.latestUserMessage,
      'captured-monitor-private-ref-Ω',
      'captured-monitor-private-source-Ω',
      'captured-monitor-private-cart-Ω',
      'captured-monitor-private-store-Ω',
      'captured-monitor-private-store-name-Ω',
      'captured-monitor-private-event-Ω',
    ]) {
      expect(serializedTrace).not.toContain(privateValue);
    }
    expect(
      dashboard
        .getEvents(state.sessionId)
        .filter((event) =>
          event.type === 'session_intelligence_updated')
        .map((event) => event.payload.sessionIntelligence),
    ).toEqual([
      expect.objectContaining({
        source: 'ai_monitor_judge',
      }),
    ]);
  });
});
