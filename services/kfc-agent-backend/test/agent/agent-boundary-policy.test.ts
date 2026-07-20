import type { ToolCall } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  classifyApprovalRevalidationFailure,
  classifyProviderFailure,
  classifyToolExecutionFailure,
  createCorrectionToolMessage,
  createRejectionToolMessage,
} from '../../src/agent/agentBoundaryPolicy.js';

function namedError(name: string, message = 'provider secret'): Error {
  return Object.assign(new Error(message), { name });
}

describe('agent boundary policy', () => {
  it.each([
    [{ status: 429 }, 'rate_limited', true],
    [{ statusCode: 503 }, 'server_error', true],
    [{ response: { status: 400 } }, 'client_error', false],
    [{ code: 'ETIMEDOUT' }, 'timeout', true],
    [{ cause: { code: 'ECONNRESET' } }, 'network_error', true],
    [namedError('APIConnectionError'), 'network_error', true],
    [namedError('TimeoutError'), 'timeout', true],
    [namedError('AbortError'), 'aborted', false],
    [new Error('provider secret'), 'unknown', false],
  ] as const)(
    'classifies provider failure %# without exposing raw error content',
    (error, errorClass, retryable) => {
      const result = classifyProviderFailure(error);

      expect(result).toEqual({ errorClass, retryable });
      expect(JSON.stringify(result)).not.toContain('provider secret');
    },
  );

  it.each([
    'authenticated_agent_approval_receipt_required',
    'agent_approval_receipt_binding_mismatch',
    'agent_domain_state_missing',
  ] as const)(
    'allows approved approval-revalidation code %s through',
    (errorCode) => {
      expect(
        classifyApprovalRevalidationFailure(new Error(errorCode)),
      ).toBe(errorCode);
    },
  );

  it('redacts unapproved approval-revalidation failure details', () => {
    expect(
      classifyApprovalRevalidationFailure(new Error('provider secret')),
    ).toBe('agent_approval_revalidation_failed');
  });

  it.each([
    'customer_run_cancelled',
    'agent_verified_collection_missing',
  ] as const)(
    'allows approved tool-execution code %s through',
    (errorCode) => {
      expect(classifyToolExecutionFailure(new Error(errorCode))).toBe(
        errorCode,
      );
    },
  );

  it('redacts unapproved tool-execution failure details', () => {
    expect(
      classifyToolExecutionFailure(new Error('provider secret')),
    ).toBe('agent_tool_execution_failed');
  });

  it('constructs a typed semantic-correction ToolMessage', () => {
    const call: ToolCall = {
      id: 'tool-call-1',
      name: 'searchMenu',
      args: { scope: 'all', query: null },
      type: 'tool_call',
    };

    const message = createCorrectionToolMessage(
      call,
      'invalid_tool_arguments',
    );

    expect(message).toMatchObject({
      tool_call_id: 'tool-call-1',
      name: 'searchMenu',
      status: 'error',
    });
    expect(JSON.parse(String(message.content))).toEqual({
      ok: false,
      errorCode: 'invalid_tool_arguments',
      correctionAllowed: true,
    });
  });

  it('constructs a typed customer-rejection ToolMessage structurally', () => {
    const message = createRejectionToolMessage({
      id: 'tool-call-2',
      toolName: 'placeOrder',
    });

    expect(message).toMatchObject({
      tool_call_id: 'tool-call-2',
      name: 'placeOrder',
      status: 'error',
    });
    expect(JSON.parse(String(message.content))).toEqual({
      ok: false,
      errorCode: 'customer_rejected',
    });
  });
});
