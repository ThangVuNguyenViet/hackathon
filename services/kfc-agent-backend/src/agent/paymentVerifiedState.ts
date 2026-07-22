import { toolArgumentSchemas } from '../ordering/toolCatalog.js';
import type { ToolCallResult } from '../ordering/types.js';
import { paymentAttemptForVerifiedOrder } from '../ordering/paymentOrderAuthority.js';
import type { AgentState } from './agentState.js';
import { pushEscalationReasons } from './turnSupport.js';

type SuccessfulToolResult = Extract<ToolCallResult, { ok: true }>;
type SuccessfulOrderPaymentResult = Extract<
  SuccessfulToolResult,
  {
    toolName:
      | 'previewOrder'
      | 'placeOrder'
      | 'getOrderStatus'
      | 'createPaymentLink'
      | 'checkPaymentStatus';
  }
>;

export function applySuccessfulOrderPaymentResult(
  state: AgentState,
  result: SuccessfulToolResult,
  args: Record<string, unknown>,
): result is SuccessfulOrderPaymentResult {
  switch (result.toolName) {
    case 'previewOrder':
      state.orderPreview = result.value;
      return true;
    case 'placeOrder':
      if (
        state.order?.id !== result.value.id ||
        !paymentAttemptForVerifiedOrder(state.paymentAttempt, result.value)
      ) {
        state.paymentAttempt = undefined;
      }
      state.order = result.value;
      return true;
    case 'getOrderStatus':
      state.paymentAttempt = paymentAttemptForVerifiedOrder(
        state.paymentAttempt,
        result.value,
      );
      state.order = result.value;
      return true;
    case 'createPaymentLink': {
      const parsedArgs = toolArgumentSchemas.createPaymentLink.safeParse(args);
      if (parsedArgs.success && state.order?.id === result.value.orderId) {
        state.paymentAttempt = {
          orderId: result.value.orderId,
          method: parsedArgs.data.methodId,
          status: result.value.status,
          paymentUrl: result.value.url,
        };
      } else {
        state.paymentAttempt = undefined;
        pushEscalationReasons(state, ['tool_execution_failed']);
      }
      return true;
    }
    case 'checkPaymentStatus': {
      if (args.orderId !== result.value.orderId) {
        state.paymentAttempt = undefined;
        pushEscalationReasons(state, ['tool_execution_failed']);
        return true;
      }
      if (state.order?.id !== result.value.orderId) {
        state.paymentAttempt = undefined;
        return true;
      }
      const priorMatchesOrder =
        state.paymentAttempt?.orderId === result.value.orderId;
      const nextPaymentAttempt = {
        orderId: result.value.orderId,
        method: priorMatchesOrder ? state.paymentAttempt?.method : undefined,
        status: result.value.status,
        paymentUrl: priorMatchesOrder
          ? state.paymentAttempt?.paymentUrl
          : undefined,
      };
      if (
        !state.paymentAttempt ||
        state.paymentAttempt.orderId !== nextPaymentAttempt.orderId ||
        state.paymentAttempt.method !== nextPaymentAttempt.method ||
        state.paymentAttempt.status !== nextPaymentAttempt.status ||
        state.paymentAttempt.paymentUrl !== nextPaymentAttempt.paymentUrl
      ) {
        state.paymentAttempt = nextPaymentAttempt;
      }
      return true;
    }
    default:
      return false;
  }
}
