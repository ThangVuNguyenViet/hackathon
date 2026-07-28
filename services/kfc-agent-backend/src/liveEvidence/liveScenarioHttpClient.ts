export interface LiveScenarioHttpClient {
  environment(): Promise<Record<string, unknown>>;
  submitUserMessage(input: {
    sessionId: string;
    customerId: string;
    clientMessageId: string;
    text: string;
    metadata: Record<string, unknown>;
    trace: LiveScenarioTraceCorrelation;
  }): Promise<Record<string, unknown>>;
  submitAction(input: {
    sessionId: string;
    customerId: string;
    clientMessageId: string;
    assistantTurnId: string;
    attachmentId: string;
    actionId: string;
    payload?: Record<string, unknown>;
    trace: LiveScenarioTraceCorrelation;
  }): Promise<Record<string, unknown>>;
  recordRecommendationImpression(input: {
    recommendationId: string;
    body: Record<string, unknown>;
  }): Promise<void>;
  d1Evidence(sessionId: string): Promise<{
    proofEnvelope: Record<string, unknown>;
    recommendationInspection?: Record<string, unknown>;
    orderFlowState?: Record<string, unknown>;
  }>;
}

export interface LiveScenarioTraceCorrelation {
  scenarioId: string;
  probeRunId: string;
}

export function createLiveScenarioHttpClient(input: {
  baseUrl: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
}): LiveScenarioHttpClient {
  const baseUrl = normalizedBaseUrl(input.baseUrl);
  const adminToken = input.adminToken.trim();
  if (!adminToken) throw new Error('live_scenario_admin_token_required');
  const fetchImpl = input.fetchImpl ?? fetch;

  const request = async (
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      protected?: boolean;
      acceptedStatuses?: readonly number[];
    } = {},
  ): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.protected ? { 'x-kfc-demo-admin-token': adminToken } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const body = await response.json().catch(() => null);
    if (!isRecord(body)) {
      throw new Error('live_scenario_http_response_invalid');
    }
    if (
      !response.ok &&
      !(options.acceptedStatuses ?? []).includes(response.status)
    ) {
      throw new LiveScenarioHttpError(response.status, errorCode(body));
    }
    return body;
  };

  return {
    environment() {
      return request('/ready?deep=1');
    },
    submitUserMessage(message) {
      const { trace, ...chatRequest } = message;
      return request('/admin/live-scenarios/chat/kfc/message', {
        method: 'POST',
        protected: true,
        body: { request: chatRequest, trace },
      });
    },
    submitAction(action) {
      return request('/admin/live-scenarios/chat/kfc/genui-action', {
        method: 'POST',
        protected: true,
        body: {
          request: {
            sessionId: action.sessionId,
            customerId: action.customerId,
            clientMessageId: action.clientMessageId,
            action: {
              assistantTurnId: action.assistantTurnId,
              attachmentId: action.attachmentId,
              actionId: action.actionId,
              ...(action.payload === undefined
                ? {}
                : { payload: action.payload }),
            },
          },
          trace: action.trace,
        },
      });
    },
    async recordRecommendationImpression(impression) {
      await request(
        `/v1/recommendations/${encodeURIComponent(impression.recommendationId)}/impressions`,
        {
          method: 'POST',
          body: impression.body,
        },
      );
    },
    async d1Evidence(sessionId) {
      const proofEnvelope = await request(
        `/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`,
        { protected: true, acceptedStatuses: [409] },
      );
      const correlations = recommendationCorrelations(proofEnvelope);
      const [recommendationInspection, orderFlowState] = await Promise.all([
        correlations.recommendationId
          ? request(
              `/admin/recommendations/${encodeURIComponent(correlations.recommendationId)}/inspection`,
              { protected: true },
            )
          : undefined,
        correlations.orderFlowId
          ? request(
              `/admin/recommendations/order-flows/${encodeURIComponent(correlations.orderFlowId)}/state`,
              { protected: true },
            )
          : undefined,
      ]);
      return {
        proofEnvelope,
        ...(recommendationInspection ? { recommendationInspection } : {}),
        ...(orderFlowState ? { orderFlowState } : {}),
      };
    },
  };
}

export class LiveScenarioHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(`live_scenario_http_${status}_${errorCode}`);
    this.name = 'LiveScenarioHttpError';
  }
}

function normalizedBaseUrl(value: string): URL {
  const normalized = value.trim();
  if (!normalized) throw new Error('live_scenario_backend_url_required');
  const url = new URL(normalized);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('live_scenario_backend_url_invalid');
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
  url.search = '';
  url.hash = '';
  return url;
}

function recommendationCorrelations(proof: Record<string, unknown>): {
  recommendationId?: string;
  orderFlowId?: string;
} {
  const recommendations = isRecord(proof.recommendations)
    ? proof.recommendations
    : {};
  const correlations = isRecord(recommendations.correlations)
    ? recommendations.correlations
    : {};
  return {
    ...(typeof correlations.recommendationId === 'string'
      ? { recommendationId: correlations.recommendationId }
      : {}),
    ...(typeof correlations.orderFlowId === 'string'
      ? { orderFlowId: correlations.orderFlowId }
      : {}),
  };
}

function errorCode(body: Record<string, unknown>): string {
  return typeof body.errorCode === 'string' &&
    /^[a-z][a-z0-9_]{0,127}$/u.test(body.errorCode)
    ? body.errorCode
    : 'request_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
