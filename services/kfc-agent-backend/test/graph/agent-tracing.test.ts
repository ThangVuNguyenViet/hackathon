import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  privacySafeAgentToolCallIdentity,
  privacySafeAgentToolSpanFailure,
  privacySafeAgentToolSpanInputs,
  privacySafeAgentToolSpanOutputs,
} from '../../src/agent/agentToolTracePrivacy.js';
import {
  responseEvidenceContractForTool,
} from '../../src/agent/responseEvidenceContracts.js';
import {
  independentParallelReadToolNames,
} from '../../src/agent/parallelReadBatch.js';
import type { Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  toolNames,
} from '../../src/ordering/toolCatalog.js';
import type {
  InvoiceRequest,
  ToolName,
} from '../../src/ordering/types.js';
import type {
  AgentTracer,
  AgentTraceSpan,
  AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface TraceEvent {
  phase: 'start' | 'end' | 'fail';
  name: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

class CaptureSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: TraceEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
      metadata: input.metadata,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({
      phase: 'end',
      name: this.name,
      payload: outputs,
    });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

class CaptureTracer implements AgentTracer {
  readonly events: TraceEvent[] = [];

  async startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
      metadata: input.metadata,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async flush(): Promise<void> {}
}

const privateTraceToolCases = [
  ['getMembershipProfile', 'parallel', 'private_tool_failed'],
  ['listMembershipRewards', 'parallel', 'private_tool_failed'],
  ['listMembershipWallet', 'parallel', 'private_tool_failed'],
  ['getMembershipPointHistory', 'parallel', 'private_tool_failed'],
  ['getSavedAddresses', 'parallel', 'private_tool_failed'],
  ['getRecentOrder', 'parallel', 'recent_order_lookup_failed'],
  ['getFavoriteItems', 'parallel', 'private_tool_failed'],
  ['acquireVoucher', 'serial', 'private_tool_failed'],
  ['redeemReward', 'serial', 'private_tool_failed'],
  ['previewOrder', 'serial', 'private_tool_failed'],
  ['placeOrder', 'serial', 'private_tool_failed'],
  ['getOrderStatus', 'serial', 'order_status_lookup_failed'],
  ['createPaymentLink', 'serial', 'private_tool_failed'],
  ['checkPaymentStatus', 'serial', 'payment_status_check_failed'],
  ['collectInvoice', 'serial', 'private_tool_failed'],
] as const satisfies readonly [
  ToolName,
  'parallel' | 'serial',
  string,
][];

const parallelReadToolNameSet = new Set<ToolName>(
  independentParallelReadToolNames,
);

describe('agent turn tracing', () => {
  it('derives the complete private trace surface from response evidence contracts', () => {
    const contractPrivateTools = toolNames
      .filter((toolName) =>
        responseEvidenceContractForTool(toolName).privateData)
      .sort();
    const coveredPrivateTools = privateTraceToolCases
      .map(([toolName]) => toolName)
      .sort();

    expect(coveredPrivateTools).toEqual(contractPrivateTools);
    for (const [toolName, path] of privateTraceToolCases) {
      expect(parallelReadToolNameSet.has(toolName)).toBe(
        path === 'parallel',
      );
    }
  });

  it('traces a model-selected verified tool through state and persistence', async () => {
    const sessionId = 'agent-trace-direct-tool';
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'combo' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I found a verified menu option.',
        evidenceReferences: [{
          evidenceId: 'menu_search_results',
          claimKinds: ['product'],
        }],
      }));
    const tracer = new CaptureTracer();
    const store = new MemoryStore();

    const output = await runAgentTurn({
      sessionId,
      customerId: 'agent-trace-customer',
      channel: 'kfc',
      text: 'Show me a combo',
      externalMessageId: 'agent-trace-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    });

    expect(model.callCount).toBe(2);
    expect(output.state.toolTrace).toEqual([
      expect.objectContaining({ toolName: 'searchMenu', ok: true }),
    ]);
    expect(output.state.menuSearchResults?.map((item) => item.code)).toEqual([
      '20751',
    ]);
    expect(tracer.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'start',
        name: 'agent_turn',
        payload: expect.objectContaining({
          sessionIdDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
          customerIdDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
          latestUserMessagePresent: true,
          latestUserMessageLength: 15,
          latestUserMessageDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      }),
      expect.objectContaining({
        phase: 'start',
        name: 'agent_parallel_provider_read',
        payload: expect.objectContaining({
          toolName: 'searchMenu',
          index: 0,
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        name: 'agent_parallel_provider_read',
        payload: expect.objectContaining({
          toolName: 'searchMenu',
          executionOutcome: 'success',
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        name: 'agent_turn',
        payload: expect.objectContaining({
          responseText: output.responseText,
        }),
      }),
    ]));
    expect(await store.listTurns(sessionId)).toEqual([
      expect.objectContaining({ role: 'user', text: 'Show me a combo' }),
      expect.objectContaining({
        role: 'assistant',
        text: 'I found a verified menu option.',
      }),
    ]);
    expect(await store.listEvents(sessionId)).toContainEqual(
      expect.objectContaining({ sourceType: 'graph:verified_state' }),
    );
    const tracedSteps = tracer.events.map(
      (event) => `${event.phase}:${event.name}`,
    );
    expect(tracedSteps.indexOf('start:agent_turn')).toBeLessThan(
      tracedSteps.indexOf('start:agent_parallel_provider_reads'),
    );
    expect(tracedSteps.indexOf('start:agent_parallel_provider_reads'))
      .toBeLessThan(
        tracedSteps.indexOf('start:agent_parallel_provider_read'),
      );
    expect(tracedSteps.indexOf('start:agent_parallel_provider_read'))
      .toBeLessThan(
        tracedSteps.indexOf('end:agent_parallel_provider_read'),
      );
    expect(tracedSteps.indexOf('end:agent_parallel_provider_read'))
      .toBeLessThan(
        tracedSteps.indexOf('end:agent_parallel_provider_reads'),
      );
    expect(tracedSteps.indexOf('end:agent_parallel_provider_reads'))
      .toBeLessThan(
        tracedSteps.indexOf('start:session_intelligence'),
      );
    expect(tracer.events.find(
      (event) =>
        event.phase === 'start' &&
        event.name === 'agent_parallel_provider_read',
    )?.payload).not.toHaveProperty('arguments');
    expect(tracedSteps.indexOf('start:session_intelligence')).toBeLessThan(
      tracedSteps.indexOf('end:session_intelligence'),
    );
    expect(tracedSteps.indexOf('end:session_intelligence')).toBeLessThan(
      tracedSteps.indexOf('end:agent_turn'),
    );
    expect(tracer.events.some((event) => event.phase === 'fail')).toBe(false);
  });

  it('redacts private address inputs while preserving exact provider dispatch', async () => {
    const sentinel = 'PRIVATE-ADDRESS-SENTINEL-7b63d5';
    const sessionId = 'agent-trace-private-address';
    const address = {
      label: null,
      line1: sentinel,
      district: 'Quận 7',
      city: null,
    } as const;
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address,
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Okay.',
      }));
    const tracer = new CaptureTracer();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());
    const quoteFulfillment = vi.fn(
      clients.fulfillment.quoteFulfillment,
    );
    clients.fulfillment.quoteFulfillment = quoteFulfillment;
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: {
        cart: {
          id: 'agent-trace-private-cart',
          items: [{
            itemCode: '20751',
            name: 'Verified item',
            quantity: 1,
            unitPriceVnd: 99_000,
          }],
          subtotalVnd: 99_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 99_000,
          voucherCode: null,
        },
        toolTrace: [],
      },
    });

    await runAgentTurn({
      sessionId,
      customerId: 'agent-trace-customer',
      channel: 'kfc',
      text: `Deliver to ${sentinel}, Quận 7.`,
      externalMessageId: 'agent-trace-private-address-message',
      metadata: {
        rawEvent: {
          source: 'privacy-regression',
          privateAddress: address,
        },
      },
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    });

    expect(quoteFulfillment).toHaveBeenCalledWith(
      {
        address,
        method: 'delivery',
        itemCodes: ['20751'],
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    const rootStart = tracer.events.find(
      (event) =>
        event.phase === 'start' &&
        event.name === 'agent_turn',
    );
    const quoteStart = tracer.events.find(
      (event) =>
        event.phase === 'start' &&
        event.name === 'tool_call:quoteFulfillment',
    );
    expect(rootStart).toMatchObject({
      payload: {
        latestUserMessagePresent: true,
        latestUserMessageDigest:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
        metadataPresent: true,
        metadataDigest:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
      metadata: {
        rawEvent: {
          type: 'record',
          count: 2,
          digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      },
    });
    expect(quoteStart).toMatchObject({
      payload: {
        toolName: 'quoteFulfillment',
        boundary: 'fulfillment',
        argumentsRedacted: true,
        argumentsDigest:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
        addressSource: 'explicit_address',
        method: 'delivery',
      },
    });
    const capturedTraceInputs = tracer.events
      .filter((event) => event.phase === 'start')
      .map((event) => ({
        inputs: event.payload,
        metadata: event.metadata,
      }));
    expect(JSON.stringify(capturedTraceInputs)).not.toContain(sentinel);
  });

  it('projects private status spans structurally while preserving provider results', async () => {
    const orderId = 'PRIVATE-ORDER-ID-SENTINEL-bc2941';
    const providerMessage =
      'PRIVATE-PROVIDER-MESSAGE-SENTINEL-c64551';
    const sourceUrl =
      'https://private.invalid/PRIVATE-SOURCE-URL-SENTINEL-914c85';
    const sessionId = 'agent-trace-private-status';
    const customerId = 'agent-trace-private-status-customer';
    const order: Order = {
      id: orderId,
      cart: {
        id: 'private-status-cart',
        items: [{
          itemCode: '20751',
          name: 'Verified item',
          quantity: 1,
          unitPriceVnd: 99_000,
        }],
        subtotalVnd: 99_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 99_000,
        voucherCode: null,
      },
      status: 'preparing',
      paymentStatus: 'pending',
      assignedStoreId: 'store-private-status',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const privateProvenance = [{
      fixtureMode: 'provider_runtime' as const,
      sourceFile: 'private-provider-status.ts',
      sourceUrl,
      sourceApi: `private-provider:${orderId}`,
    }];
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: order,
      message: providerMessage,
      provenance: privateProvenance,
    }));
    const orderStatusProvider = vi.fn((providerOrderId: string) => ({
      ok: true as const,
      value: {
        ...order,
        id: providerOrderId,
        status: 'completed' as const,
      },
      message: providerMessage,
      provenance: privateProvenance,
    }));
    const paymentStatusProvider = vi.fn(() => ({
      ok: true as const,
      value: { status: 'paid' as const },
      message: providerMessage,
      provenance: privateProvenance,
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
      orderStatusProvider,
      paymentStatusProvider,
    });
    const model = fakeModel()
      .respondWithTools([{
        id: orderId,
        name: 'getRecentOrder',
        args: {},
      }])
      .respondWithTools([{
        name: 'getOrderStatus',
        args: {},
      }])
      .respondWithTools([{
        name: 'checkPaymentStatus',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The private status reads completed.',
      }));
    const tracer = new CaptureTracer();

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Check my recent order and payment.',
      externalMessageId: 'agent-trace-private-status-message',
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    });

    expect(recentOrderProvider).toHaveBeenCalledWith(
      customerId,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect(orderStatusProvider).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect(paymentStatusProvider).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect(output.responseText).toBe(
      'The private status reads completed.',
    );
    expect(model.callCount).toBe(4);

    const privateToolEvents = tracer.events.filter(({ name }) =>
      name.startsWith('agent_parallel_provider_read') ||
      name === 'tool_call:getOrderStatus' ||
      name === 'tool_call:checkPaymentStatus');
    const serializedPrivateToolEvents = JSON.stringify(privateToolEvents);
    expect(serializedPrivateToolEvents).not.toContain(orderId);
    expect(serializedPrivateToolEvents).not.toContain(providerMessage);
    expect(serializedPrivateToolEvents).not.toContain(sourceUrl);
    expect(privateToolEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'start',
        name: 'agent_parallel_provider_read',
        payload: expect.objectContaining({
          toolName: 'getRecentOrder',
          privateEvidenceTool: true,
          argumentsRedacted: true,
          toolCallIdRedacted: true,
          toolCallIdDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        name: 'agent_parallel_provider_read',
        payload: expect.objectContaining({
          toolName: 'getRecentOrder',
          executionOutcome: 'success',
          outcome: 'recent_order_observed',
          provenance: [{ fixtureMode: 'provider_runtime' }],
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        name: 'tool_call:getOrderStatus',
        payload: expect.objectContaining({
          outcome: 'order_status_observed',
          provenance: [{ fixtureMode: 'provider_runtime' }],
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        name: 'tool_call:checkPaymentStatus',
        payload: expect.objectContaining({
          outcome: 'payment_status_observed',
          provenance: [{ fixtureMode: 'provider_runtime' }],
        }),
      }),
    ]));
  });

  it('redacts invoice identity fields while preserving exact provider dispatch', async () => {
    const companyName =
      'PRIVATE-INVOICE-COMPANY-SENTINEL-8e5e6c';
    const taxCode = 'PRIVATE-INVOICE-TAX-SENTINEL-a72437';
    const email =
      'private-invoice-email-sentinel-95113e@private.invalid';
    const providerMessage =
      'PRIVATE-INVOICE-PROVIDER-MESSAGE-SENTINEL-3a5838';
    const sourceUrl =
      'https://private.invalid/PRIVATE-INVOICE-URL-SENTINEL-545968';
    const sessionId = 'agent-trace-private-invoice';
    const customerId = 'agent-trace-private-invoice-customer';
    const clients = createMockClients(createTestFixtures());
    const collectInvoice = vi.fn(
      async (invoice: Partial<InvoiceRequest>) => {
        if (
          !invoice.companyName ||
          !invoice.taxCode ||
          !invoice.email
        ) {
          throw new Error('test_invoice_fields_missing');
        }
        return {
          ok: true as const,
          value: {
            companyName: invoice.companyName,
            taxCode: invoice.taxCode,
            email: invoice.email,
          },
          message: providerMessage,
          provenance: [{
            fixtureMode: 'provider_runtime' as const,
            sourceFile: `private-invoice:${taxCode}`,
            sourceUrl,
            sourceApi: `private-invoice:${email}`,
          }],
        };
      },
    );
    clients.invoice.collectInvoice = collectInvoice;
    const model = fakeModel()
      .respondWithTools([{
        name: 'collectInvoice',
        args: { companyName, taxCode, email },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The invoice request was accepted.',
      }));
    const tracer = new CaptureTracer();

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Create the requested invoice.',
      externalMessageId: 'agent-trace-private-invoice-message',
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    });

    expect(collectInvoice).toHaveBeenCalledWith(
      { companyName, taxCode, email },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect(output.responseText).toBe(
      'The invoice request was accepted.',
    );
    const invoiceTrace = tracer.events.filter(({ name }) =>
      name === 'tool_call:collectInvoice');
    const serializedInvoiceTrace = JSON.stringify(invoiceTrace);
    for (const sentinel of [
      companyName,
      taxCode,
      email,
      providerMessage,
      sourceUrl,
    ]) {
      expect(serializedInvoiceTrace).not.toContain(sentinel);
    }
    expect(invoiceTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'start',
        payload: expect.objectContaining({
          toolName: 'collectInvoice',
          privateEvidenceTool: true,
          argumentsRedacted: true,
          argumentsDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      }),
      expect.objectContaining({
        phase: 'end',
        payload: {
          toolName: 'collectInvoice',
          ok: true,
          executionOutcome: 'success',
          privateEvidenceTool: true,
          outcome: 'private_tool_observed',
          provenance: [{ fixtureMode: 'provider_runtime' }],
        },
      }),
    ]));
  });

  it.each(privateTraceToolCases)(
    'sanitizes %s start, end, and failure trace payloads on the %s path',
    async (toolName, _path, expectedFailure) => {
      const orderId = 'PRIVATE-FAIL-ORDER-ID-SENTINEL-f4550c';
      const providerMessage =
        'PRIVATE-FAIL-PROVIDER-MESSAGE-SENTINEL-4928c4';
      const sourceUrl =
        'https://private.invalid/PRIVATE-FAIL-URL-SENTINEL-189bdf';
      const tracer = new CaptureTracer();
      const turn = await tracer.startTurn({
        name: 'private_status_trace_test',
        inputs: {},
      });
      const request = {
        toolName,
        arguments:
          toolName === 'getRecentOrder'
            ? {}
            : toolName === 'collectInvoice'
              ? {
                  companyName: providerMessage,
                  taxCode: orderId,
                  email:
                    `private-invoice-${orderId}@private.invalid`,
                }
              : { orderId },
      };
      const span = await turn.startSpan({
        name: `tool_call:${toolName}`,
        runType: 'tool',
        inputs: {
          ...await privacySafeAgentToolCallIdentity(
            toolName,
            orderId,
          ),
          ...await privacySafeAgentToolSpanInputs({ request }),
        },
      });
      await span.end(await privacySafeAgentToolSpanOutputs({
        result: {
          toolName,
          ok: false,
          errorCode: `provider_failure:${orderId}`,
          message: providerMessage,
          provenance: [{
            fixtureMode: 'provider_runtime',
            sourceFile: `private-provider:${orderId}`,
            sourceUrl,
            sourceApi: providerMessage,
          }],
        },
        auditArguments: request.arguments,
      }));
      await span.fail(privacySafeAgentToolSpanFailure(
        toolName,
        new Error(`${providerMessage}:${orderId}:${sourceUrl}`),
      ));

      const serializedEvents = JSON.stringify(tracer.events);
      expect(serializedEvents).not.toContain(orderId);
      expect(serializedEvents).not.toContain(providerMessage);
      expect(serializedEvents).not.toContain(sourceUrl);
      expect(tracer.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          phase: 'start',
          name: `tool_call:${toolName}`,
          payload: expect.objectContaining({
            toolName,
            privateEvidenceTool: true,
            argumentsRedacted: true,
            toolCallIdRedacted: true,
            toolCallIdDigest:
              expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
        }),
        expect.objectContaining({
          phase: 'end',
          name: `tool_call:${toolName}`,
          payload: {
            toolName,
            ok: false,
            executionOutcome: 'error',
            privateEvidenceTool: true,
            outcome: expectedFailure,
            provenance: [{ fixtureMode: 'provider_runtime' }],
          },
        }),
        expect.objectContaining({
          phase: 'fail',
          name: `tool_call:${toolName}`,
          payload: { message: expectedFailure },
        }),
      ]));
    },
  );

  it('sanitizes a thrown private provider error at the runtime span boundary', async () => {
    const orderId = 'PRIVATE-THROWN-ORDER-ID-SENTINEL-38fb3c';
    const providerMessage =
      'PRIVATE-THROWN-PROVIDER-MESSAGE-SENTINEL-5f3d44';
    const sourceUrl =
      'https://private.invalid/PRIVATE-THROWN-URL-SENTINEL-6274cb';
    const sessionId = 'agent-trace-private-provider-throw';
    const customerId = 'agent-trace-private-provider-throw-customer';
    const order: Order = {
      id: orderId,
      cart: {
        id: 'private-provider-throw-cart',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'private-provider-throw-store',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const paymentStatusProvider = vi.fn(() => {
      throw new Error(`${providerMessage}:${orderId}:${sourceUrl}`);
    });
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider: () => ({
        ok: true,
        value: order,
        message: 'recent_order_observed',
      }),
      paymentStatusProvider,
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'getRecentOrder',
        args: {},
      }])
      .respondWithTools([{
        name: 'checkPaymentStatus',
        args: {},
      }]);
    const tracer = new CaptureTracer();

    await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Check my recent payment.',
      externalMessageId:
        'agent-trace-private-provider-throw-message',
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    }).catch(() => undefined);

    expect(paymentStatusProvider).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    const paymentTraceEvents = tracer.events.filter(({ name }) =>
      name === 'tool_call:checkPaymentStatus');
    const serializedPaymentTrace = JSON.stringify(paymentTraceEvents);
    expect(serializedPaymentTrace).not.toContain(orderId);
    expect(serializedPaymentTrace).not.toContain(providerMessage);
    expect(serializedPaymentTrace).not.toContain(sourceUrl);
    expect(paymentTraceEvents).toContainEqual({
      phase: 'fail',
      name: 'tool_call:checkPaymentStatus',
      payload: { message: 'payment_status_check_failed' },
    });
  });

  it('sanitizes a failed parallel batch that contains a private status read', async () => {
    const orderId = 'PRIVATE-BATCH-ORDER-ID-SENTINEL-a03a30';
    const providerMessage =
      'PRIVATE-BATCH-PROVIDER-MESSAGE-SENTINEL-b607c3';
    const sourceUrl =
      'https://private.invalid/PRIVATE-BATCH-URL-SENTINEL-dcbf3a';
    const sessionId = 'agent-trace-private-parallel-failure';
    const customerId = 'agent-trace-private-parallel-failure-customer';
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider: () => ({
        ok: true,
        value: null,
        message: 'recent_order_observed',
      }),
    });
    vi.spyOn(clients.menu, 'searchMenu').mockRejectedValue(
      new Error(`${providerMessage}:${orderId}:${sourceUrl}`),
    );
    const model = fakeModel().respondWithTools([
      {
        id: orderId,
        name: 'getRecentOrder',
        args: {},
      },
      {
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      },
    ]);
    const tracer = new CaptureTracer();

    await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Check my recent order and menu.',
      externalMessageId:
        'agent-trace-private-parallel-failure-message',
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      tracer,
    }).catch(() => undefined);

    const privateParallelEvents = tracer.events.filter(({ name, phase }) =>
      name === 'agent_parallel_provider_reads' ||
      (
        name === 'agent_parallel_provider_read' &&
        phase !== 'fail'
      ));
    const serializedPrivateParallelEvents =
      JSON.stringify(privateParallelEvents);
    expect(serializedPrivateParallelEvents).not.toContain(orderId);
    expect(serializedPrivateParallelEvents).not.toContain(providerMessage);
    expect(serializedPrivateParallelEvents).not.toContain(sourceUrl);
    expect(privateParallelEvents).toContainEqual({
      phase: 'fail',
      name: 'agent_parallel_provider_reads',
      payload: { message: 'private_tool_batch_failed' },
    });
  });
});
