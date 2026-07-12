import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import type { Order } from '../../src/domain/types.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');
const liveRequested = process.env.RUN_LIVE_AI_GENUI === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1';
const openAiTimeoutMs = Number.isFinite(Number(process.env.OPENAI_TOOL_PLANNER_TIMEOUT_MS))
  ? Number(process.env.OPENAI_TOOL_PLANNER_TIMEOUT_MS)
  : 60_000;

interface LiveGenUiScenarioCase {
  fileName: string;
  targetWidgetKinds: KfcGenUiWidgetKind[];
  seedPaidOrder?: boolean;
  seedPendingPayment?: boolean;
}

const liveGenUiScenarioCases: LiveGenUiScenarioCase[] = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    targetWidgetKinds: ['addressFulfillmentCheck', 'orderReviewConfirm', 'paymentOrderStatus'],
  },
  {
    fileName: '02-tu-van-combo-va-upsell.json',
    targetWidgetKinds: ['smartMenuPicker', 'modifierPicker'],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    targetWidgetKinds: ['addressFulfillmentCheck'],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    targetWidgetKinds: ['orderTrackingStatus'],
    seedPaidOrder: true,
  },
  {
    fileName: '05-khieu-nai-va-human-handoff.json',
    targetWidgetKinds: ['supportHandoff'],
  },
  {
    fileName: '06-ngon-ngu-tu-nhien-va-an-toan.json',
    targetWidgetKinds: ['cartBuilder'],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    targetWidgetKinds: ['cartBuilder'],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    targetWidgetKinds: ['paymentOrderStatus', 'supportHandoff'],
    seedPendingPayment: true,
  },
];

const expectedActionWidgetKinds: Record<string, KfcGenUiWidgetKind> = {
  add_item: 'smartMenuPicker',
  customize_item: 'smartMenuPicker',
  continue_to_fulfillment: 'cartBuilder',
  edit_cart: 'cartBuilder',
  remove_item: 'cartBuilder',
  accept_fulfillment: 'addressFulfillmentCheck',
  submit_address: 'addressFulfillmentCheck',
  confirm_order: 'orderReviewConfirm',
  apply_voucher: 'orderReviewConfirm',
  open_payment: 'paymentOrderStatus',
  change_payment_method: 'paymentOrderStatus',
  track_order: 'orderTrackingStatus',
  request_human: 'supportHandoff',
  send_issue_summary: 'supportHandoff',
};

function genUiAttachments(result: Awaited<ReturnType<typeof runScenario>>) {
  return result.transcript
    .map((turn) => turn.metadata?.genUi)
    .filter((genUi): genUi is NonNullable<typeof genUi> => Boolean(genUi));
}

function paidOrder(id: string): Order {
  return {
    id,
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [
        {
          itemCode: '41141',
          name: 'Burger Gà Zinger',
          quantity: 1,
          unitPriceVnd: 55000,
        },
      ],
      subtotalVnd: 55000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 73000,
      voucherCode: null,
    },
  };
}

function pendingPaymentOrder(id: string): Order {
  return {
    ...paidOrder(id),
    status: 'created',
    paymentStatus: 'pending',
  };
}

function initialVerifiedStateForScenario(scenarioCase: LiveGenUiScenarioCase) {
  if (scenarioCase.seedPaidOrder) {
    const order = paidOrder('KFC-1024');
    return {
      order,
      paymentAttempt: {
        method: 'momo' as const,
        status: 'paid' as const,
        paymentUrl: `https://pay.mock/momo/${order.id}`,
      },
    };
  }

  if (scenarioCase.seedPendingPayment) {
    const order = pendingPaymentOrder('KFC-MOCK-1001');
    return {
      order,
      paymentAttempt: {
        method: 'momo' as const,
        status: 'pending' as const,
        paymentUrl: `https://pay.mock/momo/${order.id}`,
      },
    };
  }

  return undefined;
}

function mockClientOptionsForScenario(scenarioCase: LiveGenUiScenarioCase) {
  if (!scenarioCase.seedPaidOrder && !scenarioCase.seedPendingPayment) return undefined;

  const paidOrders = ['KFC-1024', 'KFC-MOCK-1001', '<verified_order_id>'].map((id) =>
    scenarioCase.seedPaidOrder ? paidOrder(id) : pendingPaymentOrder(id),
  );
  return {
    initialOrders: paidOrders,
    paymentStatusProvider: () => ({
      ok: !scenarioCase.seedPendingPayment,
      value: scenarioCase.seedPendingPayment ? undefined : { status: 'paid' as const },
      errorCode: scenarioCase.seedPendingPayment ? 'payment_failed' : undefined,
      message: scenarioCase.seedPendingPayment ? 'live_ai_genui_payment_failed_fixture' : 'live_ai_genui_paid_fixture',
    }),
  };
}

function expectScenarioWidgetKinds(input: {
  scenarioCase: LiveGenUiScenarioCase;
  attachments: ReturnType<typeof genUiAttachments>;
  toolNames: string;
}) {
  const actualKinds = new Set(input.attachments.map((attachment) => attachment.widgetKind));
  const missingKinds = input.scenarioCase.targetWidgetKinds.filter((kind) => !actualKinds.has(kind));
  expect(
    missingKinds,
    `${input.scenarioCase.fileName} missed required GenUI widget(s); actual widgets: ${[...actualKinds].join(', ')}; tools: ${input.toolNames}`,
  ).toEqual([]);
}

function expectActionWidgetConsistency(attachments: ReturnType<typeof genUiAttachments>) {
  for (const attachment of attachments) {
    for (const action of attachment.actions) {
      const expectedWidgetKind = action.id.startsWith('customize_item:')
        ? 'modifierPicker'
        : expectedActionWidgetKinds[action.id];
      if (!expectedWidgetKind) continue;
      expect(
        attachment.widgetKind,
        `action ${action.id} must only appear on ${expectedWidgetKind}; attachment ${attachment.id} used ${attachment.widgetKind}`,
      ).toBe(expectedWidgetKind);
    }
  }
}

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI GenUI scenario replay', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_GENUI=1', () => {
      throw new Error('Set OPENAI_API_KEY before running npm run test:live:genui');
    });
  });
} else {
  describe('live OpenAI GenUI scenario replay contract', () => {
    it('defines eight widget scenarios that cover the required decision-widget catalog', () => {
      expect(liveGenUiScenarioCases).toHaveLength(8);
      const coveredKinds = new Set(liveGenUiScenarioCases.flatMap((scenarioCase) => scenarioCase.targetWidgetKinds));
      expect([...coveredKinds].sort()).toEqual([
        'addressFulfillmentCheck',
        'cartBuilder',
        'modifierPicker',
        'orderReviewConfirm',
        'orderTrackingStatus',
        'paymentOrderStatus',
        'smartMenuPicker',
        'supportHandoff',
      ]);
    });
  });

  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI GenUI scenario replay', () => {
    it.each(liveGenUiScenarioCases)(
      '$fileName emits scenario-compatible GenUI attachments with live model planning',
      async (scenarioCase) => {
        const script = await loadScenarioScript(join(scenariosRoot, scenarioCase.fileName));
        const result = await runScenario(script, {
          initialVerifiedState: initialVerifiedStateForScenario(scenarioCase),
          toolPlanner: new OpenAIToolPlanner({
            apiKey: openAiApiKey ?? '',
            model: openAiModel,
            timeoutMs: openAiTimeoutMs,
          }),
          mockClientOptions: mockClientOptionsForScenario(scenarioCase),
          testFulfillmentQuoteProvider: async () => ({
            ok: true,
            value: { feeVnd: 18000, etaMinutes: 25 },
            message: 'live_ai_genui_quote_fixture',
          }),
        });

        const attachments = genUiAttachments(result);
        const toolNames = result.toolTrace.map((entry) => entry.toolName).join(', ');
        expect(
          attachments.length,
          `${scenarioCase.fileName} should emit at least one GenUI attachment; tools: ${toolNames}`,
        ).toBeGreaterThan(0);
        expectScenarioWidgetKinds({ scenarioCase, attachments, toolNames });
        expectActionWidgetConsistency(attachments);
      },
      300_000,
    );
  });
}
