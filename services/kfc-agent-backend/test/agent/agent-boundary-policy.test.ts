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
    [
      { status: 429 },
      {
        errorClass: 'rate_limited',
        retryable: true,
        diagnostic: { stage: 'model_invoke', httpStatus: 429 },
      },
    ],
    [
      { statusCode: 503 },
      {
        errorClass: 'server_error',
        retryable: true,
        diagnostic: { stage: 'model_invoke', httpStatus: 503 },
      },
    ],
    [
      { response: { status: 400 } },
      {
        errorClass: 'client_error',
        retryable: false,
        diagnostic: { stage: 'model_invoke', httpStatus: 400 },
      },
    ],
    [
      { code: 'ETIMEDOUT' },
      {
        errorClass: 'timeout',
        retryable: true,
        diagnostic: { stage: 'model_invoke' },
      },
    ],
    [
      { cause: { code: 'ECONNRESET' } },
      {
        errorClass: 'network_error',
        retryable: true,
        diagnostic: { stage: 'model_invoke' },
      },
    ],
    [
      namedError('APIConnectionError'),
      {
        errorClass: 'network_error',
        retryable: true,
        diagnostic: {
          stage: 'model_invoke',
          errorType: 'api_connection_error',
        },
      },
    ],
    [
      namedError('TimeoutError'),
      {
        errorClass: 'timeout',
        retryable: true,
        diagnostic: { stage: 'model_invoke', errorType: 'timeout_error' },
      },
    ],
    [
      namedError('AbortError'),
      {
        errorClass: 'aborted',
        retryable: false,
        diagnostic: { stage: 'model_invoke', errorType: 'abort_error' },
      },
    ],
    [
      new Error('provider secret'),
      {
        errorClass: 'unknown',
        retryable: false,
        diagnostic: { stage: 'model_invoke' },
      },
    ],
  ] as const)(
    'classifies provider failure %# without exposing raw error content',
    (error, expected) => {
      const result = classifyProviderFailure(error);

      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain('provider secret');
    },
  );

  it('allowlists Google request error diagnostics and drops native details', () => {
    const error = Object.assign(namedError('RequestError'), {
      statusCode: 400,
      code: 'PRIVATE_PROVIDER_CODE',
      data: { error: { message: 'provider secret' } },
    });

    const result = classifyProviderFailure(error);

    expect(result).toEqual({
      errorClass: 'client_error',
      retryable: false,
      diagnostic: {
        stage: 'model_invoke',
        httpStatus: 400,
        errorType: 'request_error',
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_CODE');
    expect(JSON.stringify(result)).not.toContain('provider secret');
  });

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
      args: { scope: 'all', query: null, purpose: 'browse' },
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
