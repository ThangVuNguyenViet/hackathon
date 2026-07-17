export interface OpenAiDiagnosticContext {
  workerRelease?: string;
  executionColo?: string;
  edgeColo?: string;
  placement?: string;
}

export interface OpenAiRequestMetadata {
  component: string;
  model: string;
  clientRequestId: string;
  context?: OpenAiDiagnosticContext;
}

interface OpenAiErrorBody {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
  };
}

interface OpenAiUsageBody {
  usage?: {
    input_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown };
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
}

export interface OpenAiResponseMetadata extends OpenAiRequestMetadata, OpenAiDiagnosticContext {
  timestamp: string;
  httpStatus: number;
  apiErrorType?: string;
  apiErrorCode?: string;
  openAiRequestId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export class OpenAiHttpError extends Error {
  constructor(readonly metadata: OpenAiResponseMetadata, apiMessage?: string) {
    const errorIdentity = [metadata.apiErrorType, metadata.apiErrorCode]
      .filter(Boolean)
      .join('/');
    super(
      `OpenAI ${metadata.component} failed: ` +
        (apiMessage ? `${apiMessage} (HTTP ${metadata.httpStatus})` : `HTTP ${metadata.httpStatus}`) +
        (errorIdentity ? ` (${errorIdentity})` : ''),
    );
    this.name = 'OpenAiHttpError';
  }
}

export function createOpenAiRequestMetadata(
  component: string,
  model: string,
  context?: OpenAiDiagnosticContext,
): OpenAiRequestMetadata {
  return {
    component,
    model,
    context,
    clientRequestId: crypto.randomUUID(),
  };
}

export function openAiRequestHeaders(
  apiKey: string,
  request: OpenAiRequestMetadata,
): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Client-Request-Id': request.clientRequestId,
  };
}

export function openAiPromptCacheKey(promptFamily: string, partition?: string): string {
  if (!/^[a-z0-9][a-z0-9:_-]*$/i.test(promptFamily)) {
    throw new Error('OpenAI prompt cache key family must be a stable identifier');
  }
  if (!partition) return `kfc-vietnam:${promptFamily}`;
  let hash = 2166136261;
  for (let index = 0; index < partition.length; index += 1) {
    hash ^= partition.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `kfc-vietnam:${promptFamily}:shard-${(hash >>> 0) % 16}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function recordOpenAiResponse(
  response: Response,
  body: unknown,
  request: OpenAiRequestMetadata,
): OpenAiResponseMetadata {
  const error = (body as OpenAiErrorBody | undefined)?.error;
  const usage = (body as OpenAiUsageBody | undefined)?.usage;
  const inputTokens = optionalTokenCount(usage?.input_tokens);
  const cachedInputTokens = optionalTokenCount(usage?.input_tokens_details?.cached_tokens);
  const metadata: OpenAiResponseMetadata = {
    timestamp: new Date().toISOString(),
    component: request.component,
    model: request.model,
    httpStatus: response.status,
    apiErrorType: optionalString(error?.type),
    apiErrorCode: optionalString(error?.code),
    openAiRequestId: optionalString(response.headers.get('x-request-id')),
    clientRequestId: request.clientRequestId,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens: optionalTokenCount(usage?.input_tokens_details?.cache_write_tokens),
    uncachedInputTokens: inputTokens === undefined ? undefined : Math.max(0, inputTokens - (cachedInputTokens ?? 0)),
    outputTokens: optionalTokenCount(usage?.output_tokens),
    totalTokens: optionalTokenCount(usage?.total_tokens),
    workerRelease: request.context?.workerRelease,
    executionColo: request.context?.executionColo,
    edgeColo: request.context?.edgeColo,
    placement: request.context?.placement,
  };

  console.info(JSON.stringify({
    event: 'openai_api_response',
    outcome: response.ok ? 'success' : 'failure',
    ...metadata,
  }));
  return metadata;
}

export function assertOpenAiResponseOk(
  response: Response,
  body: unknown,
  request: OpenAiRequestMetadata,
): void {
  const metadata = recordOpenAiResponse(response, body, request);
  if (!response.ok) {
    const apiMessage = optionalString((body as OpenAiErrorBody | undefined)?.error?.message);
    throw new OpenAiHttpError(metadata, apiMessage);
  }
}
