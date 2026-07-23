import { describe, expect, it } from 'vitest';
import {
  isValidApprovalBatchShape,
} from '../../src/agent/agentApprovalBatchShape.js';
import {
  agentToolCallDisposition,
  type CanonicalAgentToolCallDisposition,
} from '../../src/ordering/toolCallDisposition.js';
import type { ToolName } from '../../src/ordering/types.js';

function disposition(
  toolName: ToolName,
  arguments_: Record<string, unknown>,
): CanonicalAgentToolCallDisposition {
  const result = agentToolCallDisposition(toolName, arguments_);
  if (!result.success) throw result.error;
  return result.data;
}

describe('approval batch shape', () => {
  it('rejects a provider read, approval, and trailing mutation atomically', () => {
    expect(isValidApprovalBatchShape([
      disposition('listPaymentMethods', {
        query: null,
        paymentSurface: null,
      }),
      disposition('placeOrder', {}),
      disposition('collectInvoice', {
        companyName: 'Công ty ABC',
        taxCode: '0312345678',
        email: 'invoice@abc.test',
      }),
    ])).toBe(false);
  });

  it('rejects independent provider reads before approval', () => {
    expect(isValidApprovalBatchShape([
      disposition('listPaymentMethods', {
        query: null,
        paymentSurface: null,
      }),
      disposition('placeOrder', {}),
    ])).toBe(false);
  });

  it('accepts one approval-required call by itself', () => {
    expect(isValidApprovalBatchShape([
      disposition('placeOrder', {}),
    ])).toBe(true);
  });

  it('rejects payment-method reads combined with payment approval', () => {
    expect(isValidApprovalBatchShape([
      disposition('listPaymentMethods', {
        query: null,
        paymentSurface: null,
      }),
      disposition('createPaymentLink', { methodId: 'method-card' }),
    ])).toBe(false);
  });

  it('rejects an approval followed by a provider read', () => {
    expect(isValidApprovalBatchShape([
      disposition('handoff', { reasons: ['customer requested support'] }),
      disposition('searchMenu', { scope: 'all', query: null }),
    ])).toBe(false);
  });

  it('rejects state-projecting provider reads before approval', () => {
    expect(isValidApprovalBatchShape([
      disposition('quoteFulfillment', {
        method: 'delivery',
        address: {
          label: null,
          line1: '60 Đ. Phạm Văn Nghị',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
      }),
      disposition('placeOrder', {}),
    ])).toBe(false);
  });

  it('rejects multiple approvals and reversible-mutation prefixes', () => {
    expect(isValidApprovalBatchShape([
      disposition('placeOrder', {}),
      disposition('createPaymentLink', { methodId: 'method-card' }),
    ])).toBe(false);
    expect(isValidApprovalBatchShape([
      disposition('collectInvoice', {
        companyName: 'Công ty ABC',
        taxCode: '0312345678',
        email: 'invoice@abc.test',
      }),
      disposition('handoff', { reasons: ['customer requested support'] }),
    ])).toBe(false);
  });
});
