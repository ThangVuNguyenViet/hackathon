import {
  ToolMessage,
  type ToolCall,
} from '@langchain/core/messages';

export type ProviderErrorClass =
  | 'aborted'
  | 'client_error'
  | 'network_error'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'unknown';

export interface ProviderFailure {
  errorClass: ProviderErrorClass;
  retryable: boolean;
}

export type ApprovalRevalidationFailure =
  | 'authenticated_agent_approval_receipt_required'
  | 'agent_approval_receipt_binding_mismatch'
  | 'agent_domain_state_missing'
  | 'agent_approval_revalidation_failed';

export type ToolExecutionFailure =
  | 'customer_run_cancelled'
  | 'agent_verified_collection_missing'
  | 'agent_tool_execution_failed';

interface RejectedToolCall {
  id: string;
  toolName: string;
}

export function toolCallId(call: ToolCall): string {
  return call.id ?? crypto.randomUUID();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return isRecord(error) ? error : undefined;
}

export function classifyProviderFailure(error: unknown): ProviderFailure {
  const record = errorRecord(error);
  const response = errorRecord(record?.response);
  const cause = errorRecord(record?.cause);
  const status = [record?.status, record?.statusCode, response?.status]
    .find((value): value is number => typeof value === 'number');
  const code = [record?.code, cause?.code]
    .find((value): value is string => typeof value === 'string');
  if (status === 429) return { errorClass: 'rate_limited', retryable: true };
  if (status !== undefined && status >= 500) {
    return { errorClass: 'server_error', retryable: true };
  }
  if (status !== undefined && status >= 400) {
    return { errorClass: 'client_error', retryable: false };
  }
  if (
    ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '')
  ) {
    return { errorClass: 'timeout', retryable: true };
  }
  if (
    ['ECONNRESET', 'EAI_AGAIN'].includes(code ?? '') ||
    (error instanceof Error &&
      ['APIConnectionError', 'FetchError'].includes(error.name))
  ) {
    return { errorClass: 'network_error', retryable: true };
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { errorClass: 'timeout', retryable: true };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { errorClass: 'aborted', retryable: false };
  }
  return { errorClass: 'unknown', retryable: false };
}

export function classifyApprovalRevalidationFailure(
  error: unknown,
): ApprovalRevalidationFailure {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'authenticated_agent_approval_receipt_required':
    case 'agent_approval_receipt_binding_mismatch':
    case 'agent_domain_state_missing':
      return message;
    default:
      return 'agent_approval_revalidation_failed';
  }
}

export function classifyToolExecutionFailure(
  error: unknown,
): ToolExecutionFailure {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'customer_run_cancelled':
    case 'agent_verified_collection_missing':
      return message;
    default:
      return 'agent_tool_execution_failed';
  }
}

export function createCorrectionToolMessage(
  call: ToolCall,
  errorCode: string,
): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify({
      ok: false,
      errorCode,
      correctionAllowed: true,
    }),
    tool_call_id: toolCallId(call),
    name: call.name,
    status: 'error',
  });
}

export function createRejectionToolMessage(
  call: RejectedToolCall,
): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify({
      ok: false,
      errorCode: 'customer_rejected',
    }),
    tool_call_id: call.id,
    name: call.toolName,
    status: 'error',
  });
}
