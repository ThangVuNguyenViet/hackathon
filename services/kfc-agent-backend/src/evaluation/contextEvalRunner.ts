import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationTurn, ConversationTurnMetadata, Order } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { OpenAIResponseComposer } from '../llm/responseComposer.js';
import { OpenAIToolPlanner } from '../llm/toolPlanner.js';
import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from '../llm/toolPlanner.js';
import { createMockClients } from '../mock/createMockClients.js';
import type { ToolCallRequest } from '../ordering/types.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import {
  evaluateContextRun,
  type ContextEvalCase,
  type ContextEvalRunOutput,
  type ContextEvalScores,
  type ContextEvalStateSummary,
} from './contextEvalCases.js';

export interface ContextEvalResult {
  caseId: string;
  caseCategory: string;
  responseText: string;
  output: ContextEvalRunOutput;
  scores: ContextEvalScores;
  transcript: Array<Pick<ConversationTurn, 'role' | 'text'>>;
  dashboardEventTypes: string[];
}

export interface EvaluateContextCaseInput {
  testCase: ContextEvalCase;
  fixtures: GeneratedFixtures;
  mode: 'deterministic' | 'live';
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiPlannerModel?: string;
  openAiComposerModel?: string;
  fetchImpl?: typeof fetch;
}

function summarizeState(input: {
  cart?: ContextEvalCase['inputs']['preExistingContext']['cart'];
  order?: Order;
  paymentUrl?: string | null;
  handoffId?: string | null;
}): ContextEvalStateSummary {
  return {
    cartItems: input.cart?.items.map((item) => ({ itemCode: item.itemCode, quantity: item.quantity })) ?? [],
    orderId: input.order?.id ?? null,
    paymentUrl: input.paymentUrl ?? null,
    handoffId: input.handoffId ?? null,
  };
}

function summarizeOutputState(output: Awaited<ReturnType<typeof runAgentTurn>>): ContextEvalStateSummary {
  return summarizeState({
    cart: output.state.cart,
    order: output.state.order,
    paymentUrl: output.state.paymentAttempt?.paymentUrl ?? null,
    handoffId: output.state.handoff?.escalationId ?? null,
  });
}

function metadataForContextCase(testCase: ContextEvalCase): ConversationTurnMetadata {
  const contextPolicy = Object.fromEntries(
    Object.entries(testCase.inputs.contextRelevance).map(([domain, label]) => [
      domain,
      label === 'for_operator_only' ? 'operator_only' : label,
    ]),
  );

  return {
    rawEvent: {
      contextPolicy,
    },
  };
}

function deterministicPlanForCase(testCase: ContextEvalCase): ToolPlannerOutput {
  const toolCalls: ToolCallRequest[] = [];
  const directResponseByCase: Record<string, string> = {
    'ctx-greeting-existing-cart-001': 'Chào bạn! Bạn cần mình giúp gì thêm không?',
    'ctx-greeting-continue-cart-001': 'Mình tiếp tục hỗ trợ đơn này. Bạn gửi giúp mình địa chỉ giao hàng nhé?',
    'ctx-cart-edit-ambiguous-one-item-001': 'Bạn muốn bỏ món nào trong giỏ hàng hiện tại?',
    'ctx-reorder-clarify-previous-order-001':
      'Đơn hàng trước của bạn là Combo Hợp Gu 99K. Bạn có muốn đặt lại đơn này không?',
    'ctx-loyalty-existing-cart-001': 'Bạn hiện có 120 điểm. Mình có thể kiểm tra ưu đãi áp dụng cho giỏ hiện tại nếu bạn muốn.',
    'ctx-loyalty-apply-current-cart-001':
      'Mình cần xác nhận ưu đãi bạn muốn dùng cho giỏ hiện tại trước khi đổi hoặc áp dụng điểm.',
    'ctx-complaint-ignore-cart-001': 'Mình xin lỗi về trải nghiệm đó. Bạn cho mình biết chi tiết để mình hỗ trợ khiếu nại nhé?',
    'ctx-complaint-cart-related-001':
      'Mình sẽ hỗ trợ kiểm tra món trong giỏ hiện tại. Bạn cho mình biết món nào đang bị sai nhé?',
    'ctx-handoff-ignore-cart-001': 'Mình sẽ chuyển nhân viên hỗ trợ ngay.',
    'ctx-handoff-cart-related-001': 'Mình sẽ chuyển nhân viên hỗ trợ ngay.',
  };

  switch (testCase.inputs.caseId) {
    case 'ctx-menu-existing-cart-001':
    case 'ctx-menu-add-current-cart-001':
      toolCalls.push({ toolName: 'searchMenu', arguments: {} });
      break;
    case 'ctx-cart-edit-named-item-001':
      toolCalls.push({ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } });
      break;
    case 'ctx-reorder-confirmed-previous-order-001':
      toolCalls.push({ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } });
      break;
    case 'ctx-loyalty-existing-cart-001':
      toolCalls.push({ toolName: 'getMembershipProfile', arguments: {} });
      break;
    case 'ctx-loyalty-apply-current-cart-001':
      toolCalls.push({ toolName: 'getMembershipProfile', arguments: {} });
      toolCalls.push({ toolName: 'listMembershipRewards', arguments: {} });
      break;
    case 'ctx-handoff-ignore-cart-001':
    case 'ctx-handoff-cart-related-001':
      toolCalls.push({ toolName: 'handoff', arguments: { reasons: ['customer_requested_human'] } });
      break;
  }

  return {
    intent:
      testCase.inputs.caseCategory === 'human_handoff'
        ? 'handoff'
        : testCase.inputs.caseCategory === 'support_complaint'
          ? 'complaint'
          : testCase.inputs.caseCategory === 'loyalty_membership'
            ? 'unclear'
            : testCase.inputs.caseCategory === 'ambiguous_cart_edit'
              ? 'cart_edit'
              : testCase.inputs.caseCategory === 'menu_browsing'
                ? 'ordering'
                : 'unclear',
    entities: {
      ...(testCase.outputs.mustAskClarification ? { asksClarification: true } : {}),
      ...(testCase.inputs.caseId === 'ctx-reorder-confirmed-previous-order-001' ? { reorderConfirmed: true } : {}),
    },
    toolCalls,
    responseClaims: [],
    directResponse: directResponseByCase[testCase.inputs.caseId],
  };
}

class DeterministicContextEvalPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;
  private used = false;

  constructor(private readonly testCase: ContextEvalCase) {}

  async plan(_input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    if (this.used) {
      return {
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      };
    }
    this.used = true;
    return deterministicPlanForCase(this.testCase);
  }
}

async function seedTurns(store: MemoryStore, sessionId: string, turns: ContextEvalCase['inputs']['turnsBefore']): Promise<void> {
  for (const turn of turns) {
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: turn.role,
      text: turn.text,
      externalMessageId: null,
      externalUserId: 'context_eval_customer',
      deliveryStatus: turn.role === 'assistant' ? 'pending' : 'received',
      metadata: null,
    });
  }
}

async function seedVerifiedState(store: MemoryStore, sessionId: string, testCase: ContextEvalCase): Promise<void> {
  const context = testCase.inputs.preExistingContext;
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState: {
      cart: context.cart,
      customerContext: {
        savedAddresses: [],
        recentOrders: context.recentOrder ? [context.recentOrder] : [],
        favorites: [],
        loyaltyPoints: context.membership?.loyaltyPoints,
      },
      toolTrace: [],
    },
  });
}

export async function evaluateContextCase(input: EvaluateContextCaseInput): Promise<ContextEvalResult> {
  const { testCase, fixtures } = input;
  const sessionId = `context_eval_${testCase.inputs.caseId}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();

  await seedTurns(store, sessionId, testCase.inputs.turnsBefore);
  await seedVerifiedState(store, sessionId, testCase);

  const beforeState = summarizeState({
    cart: testCase.inputs.preExistingContext.cart,
    order: undefined,
    paymentUrl: null,
    handoffId: null,
  });

  const openAiApiKey = input.openAiApiKey ?? process.env.OPENAI_API_KEY;
  if (input.mode === 'live' && !openAiApiKey?.trim()) {
    throw new Error('OPENAI_API_KEY is required for live context eval mode');
  }
  const toolPlanner =
    input.mode === 'live'
      ? new OpenAIToolPlanner({
          apiKey: openAiApiKey!,
          model: input.openAiPlannerModel ?? process.env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1',
          baseUrl: input.openAiBaseUrl,
          fetchImpl: input.fetchImpl,
        })
      : new DeterministicContextEvalPlanner(testCase);
  const responseComposer =
    input.mode === 'live'
      ? new OpenAIResponseComposer({
          apiKey: openAiApiKey!,
          model: input.openAiComposerModel ?? process.env.OPENAI_RESPONSE_COMPOSER_MODEL ?? 'gpt-4.1',
          baseUrl: input.openAiBaseUrl,
          fetchImpl: input.fetchImpl,
        })
      : undefined;

	  const output = await runAgentTurn({
    sessionId,
    customerId: 'context_eval_customer',
    channel: 'kfc',
    text: testCase.inputs.latestUserMessage,
    clients: createMockClients(fixtures),
    store,
	    dashboard,
	    toolPlanner,
	    responseComposer,
	    metadata: input.mode === 'deterministic' ? metadataForContextCase(testCase) : undefined,
	  });

  const runOutput: ContextEvalRunOutput = {
    responseText: output.responseText,
    toolNames: output.state.toolTrace?.map((entry) => entry.toolName) ?? [],
    beforeState,
    afterState: summarizeOutputState(output),
    replyIntent: output.replyIntent,
  };
  const scores = evaluateContextRun(testCase, runOutput);
  const transcript = (await store.listTurns(sessionId)).map((turn) => ({ role: turn.role, text: turn.text }));

  return {
    caseId: testCase.inputs.caseId,
    caseCategory: testCase.inputs.caseCategory,
    responseText: output.responseText,
    output: runOutput,
    scores,
    transcript,
    dashboardEventTypes: dashboard.getEvents(sessionId).map((event) => event.type),
  };
}
