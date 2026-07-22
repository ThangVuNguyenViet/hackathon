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

export const PROVIDER_ERROR_TYPES = [
  'abort_error',
  'api_connection_error',
  'api_connection_timeout_error',
  'authentication_error',
  'bad_request_error',
  'fetch_error',
  'internal_server_error',
  'not_found_error',
  'permission_denied_error',
  'rate_limit_error',
  'request_error',
  'timeout_error',
  'unprocessable_entity_error',
] as const;

export type ProviderErrorType = (typeof PROVIDER_ERROR_TYPES)[number];

export interface ProviderFailureDiagnostic {
  stage: 'model_invoke';
  httpStatus?: number;
  errorType?: ProviderErrorType;
}

export interface ProviderFailure {
  errorClass: ProviderErrorClass;
  retryable: boolean;
}

export interface ClassifiedProviderFailure extends ProviderFailure {
  diagnostic: ProviderFailureDiagnostic;
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

const providerErrorTypes = {
  AbortError: 'abort_error',
  APIConnectionError: 'api_connection_error',
  APIConnectionTimeoutError: 'api_connection_timeout_error',
  AuthenticationError: 'authentication_error',
  BadRequestError: 'bad_request_error',
  FetchError: 'fetch_error',
  InternalServerError: 'internal_server_error',
  NotFoundError: 'not_found_error',
  PermissionDeniedError: 'permission_denied_error',
  RateLimitError: 'rate_limit_error',
  RequestError: 'request_error',
  TimeoutError: 'timeout_error',
  UnprocessableEntityError: 'unprocessable_entity_error',
} as const satisfies Record<string, ProviderErrorType>;

function providerErrorType(error: unknown): ProviderErrorType | undefined {
  if (!(error instanceof Error)) return undefined;
  const entry = Object.entries(providerErrorTypes)
    .find(([name]) => name === error.name);
  return entry?.[1];
}

function boundedHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 400 &&
      value <= 599
    ? value
    : undefined;
}

function providerFailure(
  error: unknown,
  errorClass: ProviderErrorClass,
  retryable: boolean,
  httpStatus?: number,
): ClassifiedProviderFailure {
  const errorType = providerErrorType(error);
  return {
    errorClass,
    retryable,
    diagnostic: {
      stage: 'model_invoke',
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(errorType === undefined ? {} : { errorType }),
    },
  };
}

export function classifyProviderFailure(
  error: unknown,
): ClassifiedProviderFailure {
  const record = errorRecord(error);
  const response = errorRecord(record?.response);
  const cause = errorRecord(record?.cause);
  const status = [record?.status, record?.statusCode, response?.status]
    .map(boundedHttpStatus)
    .find((value): value is number => value !== undefined);
  const code = [record?.code, cause?.code]
    .find((value): value is string => typeof value === 'string');
  if (status === 429) {
    return providerFailure(error, 'rate_limited', true, status);
  }
  if (status !== undefined && status >= 500) {
    return providerFailure(error, 'server_error', true, status);
  }
  if (status !== undefined) {
    return providerFailure(error, 'client_error', false, status);
  }
  if (
    ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '')
  ) {
    return providerFailure(error, 'timeout', true);
  }
  if (
    ['ECONNRESET', 'EAI_AGAIN'].includes(code ?? '') ||
    (error instanceof Error &&
      ['APIConnectionError', 'FetchError'].includes(error.name))
  ) {
    return providerFailure(error, 'network_error', true);
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return providerFailure(error, 'timeout', true);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return providerFailure(error, 'aborted', false);
  }
  return providerFailure(error, 'unknown', false);
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
