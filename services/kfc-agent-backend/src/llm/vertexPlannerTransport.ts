import { z } from 'zod';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().min(1),
  token_uri: z.string().url().default('https://oauth2.googleapis.com/token'),
});

type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export interface ResponsesRequest {
  temperature?: number;
  max_output_tokens?: number;
  instructions?: string;
  input?: string;
  text?: {
    format?: {
      type?: string;
      name?: string;
      strict?: boolean;
      schema?: unknown;
    };
  };
}

export interface VertexPlannerTransportOptions {
  serviceAccountJson: string;
  model: string;
  location?: string;
  tokenRefreshTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function privateKeyBytes(pem: string): ArrayBuffer {
  const encoded = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/gu, '');
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function parseServiceAccount(value: string): ServiceAccount {
  try {
    return serviceAccountSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('VERTEX_SERVICE_ACCOUNT_JSON must contain a valid Google service account credential');
  }
}

export function createVertexAccessTokenProvider(
  serviceAccountJson: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  refreshTimeoutMs = 8_000,
): (signal?: AbortSignal) => Promise<string> {
  const serviceAccount = parseServiceAccount(serviceAccountJson);
  let cached: { token: string; expiresAt: number } | undefined;
  let refresh: Promise<{ token: string; expiresAt: number }> | undefined;

  return async (_signal) => {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    refresh ??= (async () => {
      const refreshController = new AbortController();
      const refreshTimeout = setTimeout(() => refreshController.abort(), refreshTimeoutMs);
      const issuedAt = Math.floor(now() / 1_000);
      const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64Url(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: serviceAccount.token_uri,
        iat: issuedAt,
        exp: issuedAt + 3_600,
      }));
      const signingInput = `${header}.${claims}`;
      const key = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyBytes(serviceAccount.private_key),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(signingInput),
      );
      try {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await fetchImpl(serviceAccount.token_uri, {
              method: 'POST',
              signal: refreshController.signal,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
              }),
            });
            const body = await response.json().catch(() => ({})) as {
              access_token?: unknown;
              expires_in?: unknown;
              error_description?: unknown;
            };
            if (!response.ok || typeof body.access_token !== 'string') {
              const detail = typeof body.error_description === 'string' ? `: ${body.error_description}` : '';
              throw new Error(`Vertex access-token refresh failed (HTTP ${response.status})${detail}`);
            }
            const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3_600;
            return { token: body.access_token, expiresAt: now() + expiresIn * 1_000 };
          } catch (error) {
            if (refreshController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            lastError = error;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
        }
        throw lastError;
      } finally {
        clearTimeout(refreshTimeout);
      }
    })();
    try {
      cached = await refresh;
      return cached.token;
    } finally {
      refresh = undefined;
    }
  };
}

function responseFormat(format: NonNullable<ResponsesRequest['text']>['format']) {
  if (format?.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        strict: format.strict,
        schema: format.schema,
      },
    };
  }
  return { type: 'json_object' };
}

const strictCatalogSelectionSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      requestFragment: { type: 'string' },
      itemCode: { type: 'string' },
      quantity: { type: 'integer', minimum: 1 },
      replacesItemCodes: { type: 'array', items: { type: 'string' } },
      modifierChoices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            groupId: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['groupId', 'name'],
          additionalProperties: false,
        },
      },
    },
    required: ['requestFragment', 'itemCode', 'quantity', 'replacesItemCodes', 'modifierChoices'],
    additionalProperties: false,
  },
} as const;

const strictPendingDecisionsSchema = {
  type: 'object',
  properties: {
    catalogSuggestion: { type: 'string', enum: ['accept', 'decline', 'defer', 'unrelated', 'unclear'] },
    reorder: { type: 'string', enum: ['accept', 'decline', 'defer', 'unrelated', 'unclear'] },
  },
  additionalProperties: false,
} as const;

const strictCatalogSuggestionSchema = {
  type: 'object',
  properties: {
    itemCode: { type: 'string' },
    source: { type: 'string', enum: ['favorite', 'recent_order'] },
    decision: { type: 'string', enum: ['suggest', 'accept'] },
  },
  required: ['itemCode', 'source', 'decision'],
  additionalProperties: false,
} as const;

const strictSavedAddressDecisionSchema = {
  type: 'object',
  properties: {
    addressIndex: { type: 'integer' },
    decision: { type: 'string', enum: ['suggest', 'accept'] },
  },
  required: ['addressIndex', 'decision'],
  additionalProperties: false,
} as const;

const strictVertexPlannerObjectFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'planner_output',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear'],
        },
        entities: { type: 'object', additionalProperties: true },
        contextPolicy: { type: 'object', additionalProperties: true },
        foodContentEvidenceRequirement: {
          type: 'string',
          enum: ['required', 'not-required', 'unknown'],
        },
        pendingDecisions: strictPendingDecisionsSchema,
        catalogSuggestion: strictCatalogSuggestionSchema,
        savedAddressDecision: strictSavedAddressDecisionSchema,
        catalogSelections: strictCatalogSelectionSchema,
        toolCalls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              toolName: { type: 'string' },
              arguments: { type: 'object', additionalProperties: true },
            },
            required: ['toolName', 'arguments'],
            additionalProperties: false,
          },
        },
        responseClaims: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['promotion', 'payment_success', 'allergen_certainty'],
          },
        },
        directResponse: { type: 'string' },
      },
      required: ['intent', 'entities', 'toolCalls', 'responseClaims'],
      additionalProperties: true,
    },
  },
} as const;

const strictVertexCompactPlannerObjectFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'compact_planner_output',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        i: {
          type: 'string',
          enum: ['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear'],
        },
        e: { type: 'object', additionalProperties: true },
        c: { type: 'object', additionalProperties: true },
        f: {
          type: 'string',
          enum: ['required', 'not-required', 'unknown'],
        },
        p: strictPendingDecisionsSchema,
        g: strictCatalogSuggestionSchema,
        s: strictSavedAddressDecisionSchema,
        x: strictCatalogSelectionSchema,
        t: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              n: { type: 'string' },
              a: { type: 'object', additionalProperties: true },
            },
            required: ['n', 'a'],
            additionalProperties: false,
          },
        },
        r: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['promotion', 'payment_success', 'allergen_certainty'],
          },
        },
        d: { type: 'string' },
      },
      required: ['i', 'e', 't', 'r'],
      additionalProperties: true,
    },
  },
} as const;

function requestsCompactPlannerOutput(request: ResponsesRequest): boolean {
  if (!request.input) return false;
  try {
    const input = JSON.parse(request.input) as { outputSchema?: Record<string, unknown> };
    return input.outputSchema?.i !== undefined && input.outputSchema.intent === undefined;
  } catch {
    return false;
  }
}

export function mapResponsesRequestToChatCompletions(
  request: ResponsesRequest,
  model: string,
  includeGenerationConfig = false,
): Record<string, unknown> {
  return {
    model,
    ...(includeGenerationConfig ? {
      temperature: request.temperature,
      max_tokens: request.max_output_tokens,
    } : {}),
    response_format: responseFormat(request.text?.format),
    messages: [
      { role: 'system', content: request.instructions ?? '' },
      { role: 'user', content: request.input ?? '' },
    ],
  };
}

function normalizedError(body: unknown): { error: { message: string; type: string; code?: string } } {
  const envelope = Array.isArray(body) ? body[0] : body;
  const error = typeof envelope === 'object' && envelope !== null
    ? (envelope as { error?: unknown }).error
    : undefined;
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  return {
    error: {
      message: typeof record.message === 'string' ? record.message : 'Vertex planner request failed',
      type: 'vertex_error',
      ...(typeof record.status === 'string' ? { code: record.status } : {}),
    },
  };
}

export function createVertexPlannerFetch(options: VertexPlannerTransportOptions): typeof fetch {
  const serviceAccount = parseServiceAccount(options.serviceAccountJson);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAccessToken = createVertexAccessTokenProvider(
    options.serviceAccountJson,
    fetchImpl,
    options.now,
    options.tokenRefreshTimeoutMs,
  );
  const location = options.location?.trim() || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const endpoint =
    `https://${host}/v1/projects/${encodeURIComponent(serviceAccount.project_id)}` +
    `/locations/${encodeURIComponent(location)}/endpoints/openapi/chat/completions`;

  return async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? '{}')) as ResponsesRequest;
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${await getAccessToken(init?.signal ?? undefined)}`);
    headers.set('content-type', 'application/json');
    const response = await fetchImpl(endpoint, {
      ...init,
      headers,
      body: JSON.stringify({
        ...mapResponsesRequestToChatCompletions(request, options.model),
        response_format: request.text?.format?.type === 'json_object'
          ? requestsCompactPlannerOutput(request)
            ? strictVertexCompactPlannerObjectFormat
            : strictVertexPlannerObjectFormat
          : responseFormat(request.text?.format),
        google: { thinking_config: { thinking_level: 'minimal' } },
      }),
    });
    const body = await response.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
        prompt_tokens_details?: { cached_tokens?: unknown };
        completion_tokens_details?: { reasoning_tokens?: unknown };
      };
    };
    const content = body.choices?.[0]?.message?.content;
    const syntheticBody = response.ok
      ? {
          output_text: typeof content === 'string' ? content : undefined,
          usage: {
            input_tokens: body.usage?.prompt_tokens,
            input_tokens_details: { cached_tokens: body.usage?.prompt_tokens_details?.cached_tokens },
            output_tokens: body.usage?.completion_tokens,
            output_tokens_details: { reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens },
            total_tokens: body.usage?.total_tokens,
          },
        }
      : normalizedError(body);
    return new Response(JSON.stringify(syntheticBody), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
