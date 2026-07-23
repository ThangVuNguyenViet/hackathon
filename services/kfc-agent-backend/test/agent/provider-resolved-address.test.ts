import { describe, expect, it } from 'vitest';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  applyToolResultToState,
  buildVerifiedStateSnapshot,
  persistVerifiedStateSnapshot,
  verifiedStateToolTraceForPersistence,
} from '../../src/graph/verifiedState.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  validateAgentFulfillmentQuote,
} from '../../src/ordering/agentFulfillmentQuoteAuthority.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';
import type {
  ToolCallRequest,
  ToolTraceEntry,
} from '../../src/ordering/types.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const partialS01Address = {
  label: null,
  line1:
    'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
  district: 'Quận 7',
  city: null,
} as const;

function externalCallContext(): ExternalCallContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

function state(): AgentGraphState {
  return {
    sessionId: 'provider-resolved-address',
    customerId: 'provider-resolved-customer',
    channel: 'kfc',
    latestUserMessage: `${partialS01Address.line1}. Phí ship bao nhiêu?`,
    cart: {
      id: 'provider-resolved-cart',
      items: [{
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99_000,
      }],
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 99_000,
      voucherCode: null,
    },
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

function quoteRequest(): ToolCallRequest {
  return {
    toolName: 'quoteFulfillment',
    arguments: {
      address: partialS01Address,
      method: 'delivery',
      itemCodes: ['20751'],
    },
  };
}

describe('provider-resolved explicit fulfillment address', () => {
  it('applies, persists, and presents only the normalized address returned with the quote', async () => {
    const clients = createMockClients(createTestFixtures());
    const request = quoteRequest();
    const result = await executeToolCall(
      clients,
      request,
      { externalCallContext: externalCallContext() },
    );
    expect(result).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        resolvedAddress: {
          label: partialS01Address.line1,
          line1: partialS01Address.line1,
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
      },
    });
    if (!result.ok || result.toolName !== 'quoteFulfillment') {
      throw new Error('provider-resolved fulfillment fixture failed');
    }

    const currentState = state();
    const dashboard = new DashboardEventBus();
    const turnInput = {
      sessionId: currentState.sessionId,
      dashboard,
    } as AgentTurnInput;
    const currentTurnToolTrace: ToolTraceEntry[] = [];
    applyToolResultToState(
      turnInput,
      currentState,
      result,
      request.arguments,
      currentTurnToolTrace,
    );

    const resolvedAddress = {
      label: partialS01Address.line1,
      line1: partialS01Address.line1,
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    expect(currentState.address).toEqual(resolvedAddress);
    expect(currentState.fulfillment?.resolvedAddress).toEqual(
      resolvedAddress,
    );
    expect(currentState.address).not.toEqual(partialS01Address);
    expect(currentTurnToolTrace.at(-1)?.arguments).toEqual(
      request.arguments,
    );
    const currentTurnQuoteTrace = currentTurnToolTrace.at(-1);
    if (!currentTurnQuoteTrace) {
      throw new Error('current turn quote trace missing');
    }
    expect(verifiedStateToolTraceForPersistence(
      currentTurnQuoteTrace,
      'a'.repeat(64),
    )).toMatchObject({
      arguments: {
        explicitAddressInputRedacted: true,
        explicitAddressInputDigest: 'a'.repeat(64),
        method: 'delivery',
      },
    });
    const snapshot = buildVerifiedStateSnapshot(currentState);
    expect(snapshot.address).toEqual(resolvedAddress);
    expect(snapshot.toolTrace?.at(-1)).toMatchObject({
      arguments: {
        explicitAddressInputRedacted: true,
        method: 'delivery',
      },
      resultSummary: 'fulfillment_quote_observed',
    });
    expect(snapshot.toolTrace?.at(-1)?.arguments).not.toHaveProperty(
      'address',
    );
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(store, currentState);
    const durableEvent = (await store.listEvents(
      currentState.sessionId,
    )).at(-1);
    expect(durableEvent).toMatchObject({
      sourceType: 'graph:verified_state',
      payload: {
        verifiedState: {
          address: resolvedAddress,
          fulfillment: {
            resolvedAddress,
          },
          toolTrace: [
            expect.objectContaining({
              arguments: {
                explicitAddressInputRedacted: true,
                method: 'delivery',
              },
              resultSummary: 'fulfillment_quote_observed',
            }),
          ],
        },
      },
    });
    expect(
      durableEvent?.payload.verifiedState,
    ).not.toHaveProperty('toolTrace.0.arguments.address');

    expect(
      dashboard.getEvents(currentState.sessionId).map((event) =>
        event.payload),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ updateType: 'store_assigned' }),
      expect.objectContaining({ updateType: 'delivery_quote' }),
      expect.objectContaining({ updateType: 'fulfillment_quoted' }),
    ]));

    const attachment = selectKfcGenUiAttachment({
      state: currentState,
      turnToolNames: ['quoteFulfillment'],
    });
    expect(attachment).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: resolvedAddress,
        addressStatus: 'confirmed',
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
        },
      },
    });
  });

  it('fails closed when a provider reports success without a normalized address', async () => {
    const baseClients = createMockClients(createTestFixtures());
    let providerAddress: unknown;
    const clients: ExternalClients = {
      ...baseClients,
      fulfillment: {
        async quoteFulfillment(input) {
          providerAddress = input.address;
          return {
            ok: true,
            value: {
              method: 'delivery' as const,
              disposition: 'delivery' as const,
              storeId: 'KFCVN0318',
              storeName: 'KFC Sunrise City',
              feeVnd: 18_000,
              etaMinutes: 35,
              availability: {
                ok: true,
                checkedItemIds: ['20751'],
                unavailableItemIds: [],
                blockedTimeslotItemIds: [],
                source: {
                  fixtureMode: 'test_only' as const,
                  sourceFile: 'provider-resolved-address.test.ts',
                },
              },
            },
            message: 'provider omitted address resolution',
          };
        },
      },
    };

    await expect(executeToolCall(
      clients,
      quoteRequest(),
      { externalCallContext: externalCallContext() },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'invalid_fulfillment_address_resolution',
    });
    expect(providerAddress).toEqual(partialS01Address);
  });

  it('rejects provider whitespace and request method drift without normalizing either', async () => {
    const baseClients = createMockClients(createTestFixtures());
    const invalidAddressClients: ExternalClients = {
      ...baseClients,
      fulfillment: {
        async quoteFulfillment() {
          return {
            ok: true,
            value: {
              method: 'delivery' as const,
              disposition: 'delivery' as const,
              storeId: 'KFCVN0318',
              storeName: 'KFC Sunrise City',
              resolvedAddress: {
                label: partialS01Address.line1,
                line1: partialS01Address.line1,
                district: ' ',
                city: 'Hồ Chí Minh',
              },
              feeVnd: 18_000,
              etaMinutes: 35,
              availability: {
                ok: true,
                checkedItemIds: ['20751'],
                unavailableItemIds: [],
                blockedTimeslotItemIds: [],
                source: {
                  fixtureMode: 'test_only' as const,
                  sourceFile: 'provider-resolved-address.test.ts',
                },
              },
            },
            message: 'provider returned malformed address',
          };
        },
      },
    };
    await expect(executeToolCall(
      invalidAddressClients,
      quoteRequest(),
      { externalCallContext: externalCallContext() },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'invalid_fulfillment_address_resolution',
    });

    const mismatchedMethodClients: ExternalClients = {
      ...baseClients,
      fulfillment: {
        async quoteFulfillment() {
          return {
            ok: true,
            value: {
              method: 'pickup' as const,
              disposition: 'pickup' as const,
              storeId: 'KFCVN0318',
              storeName: 'KFC Sunrise City',
              resolvedAddress: {
                label: partialS01Address.line1,
                line1: partialS01Address.line1,
                district: 'Quận 7',
                city: 'Hồ Chí Minh',
              },
              feeVnd: 0,
              etaMinutes: 20,
              availability: {
                ok: true,
                checkedItemIds: ['20751'],
                unavailableItemIds: [],
                blockedTimeslotItemIds: [],
                source: {
                  fixtureMode: 'test_only' as const,
                  sourceFile: 'provider-resolved-address.test.ts',
                },
              },
            },
            message: 'provider returned a pickup quote',
          };
        },
      },
    };
    await expect(executeToolCall(
      mismatchedMethodClients,
      quoteRequest(),
      { externalCallContext: externalCallContext() },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'invalid_fulfillment_quote_binding',
    });
  });

  it('also rejects method drift at the agent quote-authority boundary', () => {
    expect(validateAgentFulfillmentQuote({
      request: quoteRequest(),
      expectedItemCodes: ['20751'],
      result: {
        toolName: 'quoteFulfillment',
        ok: true,
        value: {
          method: 'pickup',
          disposition: 'pickup',
          storeId: 'KFCVN0318',
          storeName: 'KFC Sunrise City',
          resolvedAddress: {
            label: partialS01Address.line1,
            line1: partialS01Address.line1,
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
          feeVnd: 0,
          etaMinutes: 20,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'test_only',
              sourceFile: 'provider-resolved-address.test.ts',
            },
          },
        },
        message: 'provider returned a pickup quote',
        provenance: [],
      },
    })).toMatchObject({
      ok: false,
      errorCode: 'invalid_fulfillment_quote_binding',
    });
  });

  it('clears stale quote-dependent authority after a failed replacement quote', () => {
    const currentState = state();
    currentState.cart = {
      ...currentState.cart!,
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
    };
    currentState.address = {
      label: 'Prior address',
      line1: '1 Prior Street',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    currentState.fulfillment = {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'KFCVN0257',
      storeName: 'KFC Quận 5',
      resolvedAddress: currentState.address,
      feeVnd: 18_000,
      etaMinutes: 35,
      availability: {
        ok: true,
        checkedItemIds: ['20751'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'test_only',
          sourceFile: 'provider-resolved-address.test.ts',
        },
      },
    };
    currentState.orderPreview = {
      id: 'stale-preview',
      cart: currentState.cart,
      status: 'previewed',
      paymentStatus: 'not_started',
      assignedStoreId: currentState.fulfillment.storeId,
      createdAt: '2026-07-20T00:00:00.000Z',
    };

    applyToolResultToState(
      {
        sessionId: currentState.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      currentState,
      {
        toolName: 'quoteFulfillment',
        ok: false,
        errorCode: 'invalid_fulfillment_address_resolution',
        message: 'replacement quote failed',
        provenance: [],
      },
      quoteRequest().arguments,
      [],
    );

    expect(currentState.address).toBeUndefined();
    expect(currentState.fulfillment).toBeUndefined();
    expect(currentState.orderPreview).toBeUndefined();
    expect(currentState.exactCartAvailabilityObservation).toBeUndefined();
    expect(currentState.userConfirmedOrder).toBe(false);
    expect(currentState.cart).toMatchObject({
      deliveryFeeVnd: 0,
      totalVnd: 99_000,
    });
  });

  it('rejects surrounding whitespace in model-supplied address fields', async () => {
    const request = quoteRequest();
    await expect(executeToolCall(
      createMockClients(createTestFixtures()),
      {
        ...request,
        arguments: {
          ...request.arguments,
          address: {
            ...partialS01Address,
            district: 'Quận 7 ',
          },
        },
      },
      { externalCallContext: externalCallContext() },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'invalid_tool_arguments',
    });
  });

  it('keeps a saved-address resolution turn-local while persisting only its opaque ref', async () => {
    const clients = createMockClients(createTestFixtures());
    const result = await executeToolCall(
      clients,
      quoteRequest(),
      { externalCallContext: externalCallContext() },
    );
    if (!result.ok || result.toolName !== 'quoteFulfillment') {
      throw new Error('saved-address privacy fixture failed');
    }
    const currentState = state();
    applyToolResultToState(
      {
        sessionId: currentState.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      currentState,
      {
        ...result,
        message: `Quoted ${partialS01Address.line1}`,
      },
      quoteRequest().arguments,
      [],
      {
        traceArguments: {
          savedAddressRef: {
            id: 'saved-address-ref-test',
            kind: 'saved_address',
          },
          method: 'delivery',
        },
      },
    );

    expect(currentState.address?.line1).toBe(
      partialS01Address.line1,
    );
    const snapshot = buildVerifiedStateSnapshot(currentState);
    expect(snapshot.address).toBeUndefined();
    expect(snapshot.fulfillment).not.toHaveProperty(
      'resolvedAddress',
    );
    expect(snapshot.toolTrace?.at(-1)).toMatchObject({
      arguments: {
        savedAddressRef: {
          id: 'saved-address-ref-test',
          kind: 'saved_address',
        },
      },
      resultSummary: 'fulfillment_quote_observed',
    });
    expect(JSON.stringify(snapshot)).not.toContain(
      partialS01Address.line1,
    );
  });
});
