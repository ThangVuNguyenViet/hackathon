import {
  orderWithoutDeliveryEstimate,
} from '../domain/orderStatusEvidence.js';
import type { Order, ToolResult } from '../domain/types.js';

export function recentOrderResultWithoutStatusEvidence(
  result: ToolResult<Order | null>,
): ToolResult<Order | null> {
  return result.ok && result.value
    ? {
        ...result,
        value: orderWithoutDeliveryEstimate(result.value),
      }
    : result;
}
