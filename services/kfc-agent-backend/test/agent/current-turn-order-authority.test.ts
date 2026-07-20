import { describe, expect, it } from 'vitest';
import {
  currentTurnPaymentStatusFromIssuedExecutions,
  currentTurnRecentOrderFromIssuedExecutions,
  type GraphExecutedToolResult,
} from '../../src/agent/graphExecutedToolResult.js';
import {
  issueModelPublicationAuthority,
  type ModelPublicationAuthority,
} from '../../src/agent/modelPublicationProjection.js';
import type { Cart, Order, ToolResult } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { executePublicationTool } from './model-publication-test-runtime.js';

function cart(): Cart {
  return {
    id: 'private-recent-cart',
    items: [{
      itemCode: '20751',
      name: 'Private recent item',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 117_000,
    voucherCode: null,
  };
}

function recentOrder(id = 'private-recent-order'): Order {
  return {
    id,
    cart: cart(),
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'provider-store',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function state(input: {
  turnId?: string;
  text?: string;
} = {}): AgentGraphState {
  const text = input.text ?? 'Check my latest order';
  return {
    sessionId: 'current-turn-order-authority-session',
    customerId: 'current-turn-order-authority-customer',
    channel: 'kfc',
    latestUserMessage: text,
    recentTurns: [{
      id: input.turnId ?? 'current-turn-order-authority-turn',
      sessionId: 'current-turn-order-authority-session',
      channel: 'kfc',
      role: 'user',
      text,
      externalMessageId: input.turnId ?? 'current-turn-order-message',
      externalUserId: 'current-turn-order-authority-customer',
      deliveryStatus: 'received',
      metadata: null,
      createdAt: '2026-07-20T00:00:00.000Z',
    }],
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

async function authority(
  durable: AgentGraphState,
): Promise<ModelPublicationAuthority> {
  const currentUserTurn = durable.recentTurns?.at(-1);
  if (!currentUserTurn) throw new Error('current_user_turn_missing');
  return issueModelPublicationAuthority({
    state: durable,
    currentUserTurn,
    accessContext: controlledCustomerAccess({
      sessionId: durable.sessionId,
      customerId: durable.customerId,
    }),
  });
}

async function executeRecentOrder(input: {
  durable: AgentGraphState;
  publicationAuthority: ModelPublicationAuthority;
  id: string;
  providerResult: ToolResult<Order | null>;
}): Promise<GraphExecutedToolResult> {
  return executePublicationTool({
    authority: input.publicationAuthority,
    state: input.durable,
    accessContext: controlledCustomerAccess({
      sessionId: input.durable.sessionId,
      customerId: input.durable.customerId,
    }),
    call: {
      id: input.id,
      toolName: 'getRecentOrder',
      arguments: {},
    },
    clientOptions: {
      recentOrderProvider: () => input.providerResult,
    },
  });
}

async function executePaymentStatus(input: {
  durable: AgentGraphState;
  publicationAuthority: ModelPublicationAuthority;
  id: string;
}): Promise<GraphExecutedToolResult> {
  return executePublicationTool({
    authority: input.publicationAuthority,
    state: input.durable,
    accessContext: controlledCustomerAccess({
      sessionId: input.durable.sessionId,
      customerId: input.durable.customerId,
    }),
    call: {
      id: input.id,
      toolName: 'checkPaymentStatus',
      arguments: {},
    },
    clientOptions: {
      paymentStatusProvider: () => ({
        ok: false,
        errorCode: 'payment_failed',
        message: 'provider_payment_failed',
      }),
    },
  });
}

describe('current-turn recent-order authority', () => {
  it('accepts only a genuine successful same-authority execution', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const recent = recentOrder();
    const execution = await executeRecentOrder({
      durable,
      publicationAuthority,
      id: 'recent-order-success',
      providerResult: {
        ok: true,
        value: recent,
        message: 'recent_order_observed',
      },
    });

    expect(currentTurnRecentOrderFromIssuedExecutions({
      authority: publicationAuthority,
      executions: [execution],
    })).toEqual(recent);
    expect(durable.order).toBeUndefined();
    expect(durable.customerContext).toBeUndefined();
  });

  it('rejects unissued and cross-authority execution objects', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const execution = await executeRecentOrder({
      durable,
      publicationAuthority,
      id: 'recent-order-genuine',
      providerResult: {
        ok: true,
        value: recentOrder(),
        message: 'recent_order_observed',
      },
    });
    const unissued = structuredClone(execution);
    const otherState = state({
      turnId: 'different-current-turn',
      text: 'A different current turn',
    });
    const otherAuthority = await authority(otherState);

    expect(currentTurnRecentOrderFromIssuedExecutions({
      authority: publicationAuthority,
      executions: [unissued],
    })).toBeUndefined();
    expect(currentTurnRecentOrderFromIssuedExecutions({
      authority: otherAuthority,
      executions: [execution],
    })).toBeUndefined();
  });

  it('lets the latest issued failed or null observation revoke success', async () => {
    for (const [id, providerResult] of [
      [
        'recent-order-failed',
        {
          ok: false,
          errorCode: 'recent_order_unavailable',
          message: 'recent_order_unavailable',
        },
      ],
      [
        'recent-order-null',
        {
          ok: true,
          value: null,
          message: 'recent_order_observed',
        },
      ],
    ] satisfies Array<[string, ToolResult<Order | null>]>) {
      const durable = state({
        turnId: `turn-${id}`,
        text: `Check ${id}`,
      });
      const publicationAuthority = await authority(durable);
      const success = await executeRecentOrder({
        durable,
        publicationAuthority,
        id: `${id}-success`,
        providerResult: {
          ok: true,
          value: recentOrder(`${id}-order`),
          message: 'recent_order_observed',
        },
      });
      const revocation = await executeRecentOrder({
        durable,
        publicationAuthority,
        id,
        providerResult,
      });

      expect(currentTurnRecentOrderFromIssuedExecutions({
        authority: publicationAuthority,
        executions: [success, revocation],
      })).toBeUndefined();
    }
  });
});

describe('current-turn payment-status authority', () => {
  it('accepts only an issued same-authority payment observation', async () => {
    const durable = {
      ...state({
        turnId: 'current-turn-payment-status',
        text: 'Check the current payment',
      }),
      order: recentOrder('private-payment-order'),
    };
    const publicationAuthority = await authority(durable);
    const execution = await executePaymentStatus({
      durable,
      publicationAuthority,
      id: 'payment-status-genuine',
    });
    const unissued = structuredClone(execution);
    const otherState = {
      ...state({
        turnId: 'different-payment-turn',
        text: 'Check a different payment',
      }),
      order: recentOrder('different-private-payment-order'),
    };
    const otherAuthority = await authority(otherState);

    expect(currentTurnPaymentStatusFromIssuedExecutions({
      authority: publicationAuthority,
      executions: [execution],
    })).toEqual({
      executionOutcome: 'error',
      errorCode: 'payment_failed',
    });
    expect(currentTurnPaymentStatusFromIssuedExecutions({
      authority: publicationAuthority,
      executions: [unissued],
    })).toBeUndefined();
    expect(currentTurnPaymentStatusFromIssuedExecutions({
      authority: otherAuthority,
      executions: [execution],
    })).toBeUndefined();
  });
});
