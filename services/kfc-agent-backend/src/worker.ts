import { createRouteHandlers, type HandlerResponse } from './api/routeHandlers.js';
import { buildServerOptionsFromEnv } from './api/serverOptions.js';
import { DashboardEventBus } from './dashboard/eventBus.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import { D1Store, type D1DatabaseLike } from './persistence/d1Store.js';

export interface WorkerEnv {
  DB: D1DatabaseLike;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TOOL_PLANNER_MODEL?: string;
  OPENAI_RESPONSE_MODEL?: string;
  OPENAI_BASE_URL?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_PROJECT?: string;
  MESSENGER_VERIFY_TOKEN?: string;
  META_PAGE_ID?: string;
  META_PAGE_ACCESS_TOKEN?: string;
  MESSENGER_GRAPH_API_BASE_URL?: string;
  ZALO_OA_ID?: string;
  ZALO_ACCESS_TOKEN?: string;
  ZALO_REFRESH_TOKEN?: string;
  ZALO_APP_ID?: string;
  ZALO_APP_SECRET?: string;
  ZALO_API_BASE_URL?: string;
  MESSENGER_FETCH?: typeof fetch;
  ZALO_FETCH?: typeof fetch;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname === '/dashboard/stream') {
      return json({ errorCode: 'worker_sse_not_supported', message: 'Use dashboard polling endpoints for Worker demo.' }, 501);
    }

    const store = new D1Store(env.DB);
    await store.initialize();
    const dashboard = new DashboardEventBus({
      initialEvents: await store.listDashboardEvents(),
      persistEvent: (event) => store.appendDashboardEvent(event),
    });
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: 'd1://DB',
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
      OPENAI_MODEL: env.OPENAI_MODEL ?? 'gpt-4.1',
      OPENAI_TOOL_PLANNER_MODEL: env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1-mini',
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? 'gpt-4.1-mini',
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? '',
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? '',
      META_PAGE_ID: env.META_PAGE_ID ?? '118976205445198',
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? '',
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? '',
      ZALO_OA_ID: env.ZALO_OA_ID ?? '',
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? '',
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? '',
      ZALO_APP_ID: env.ZALO_APP_ID ?? '',
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? '',
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? '',
    });
    const handlers = createRouteHandlers({
      ...options,
      fixtures: loadBundledGeneratedFixtures(),
      store,
      dashboard,
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
      readiness: {
        database: async () => {
          await env.DB.prepare('SELECT 1').first();
          return { ok: true };
        },
        openAiConfigured: Boolean(env.OPENAI_API_KEY),
        openAiRequired: false,
      },
    });

    if (request.method === 'GET' && url.pathname === '/health') return toResponse(handlers.health());
    if (request.method === 'GET' && url.pathname === '/ready') return toResponse(await handlers.ready());
    if (request.method === 'GET' && url.pathname === '/webhooks/messenger') {
      return toResponse(handlers.messengerVerify(Object.fromEntries(url.searchParams.entries())));
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/messenger') {
      return toResponse(await handlers.messengerWebhook(await readJson(request)));
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/zalo') {
      return toResponse(await handlers.zaloWebhook(await readJson(request)));
    }
    if (request.method === 'POST' && url.pathname === '/chat/mock') {
      return toResponse(await handlers.chatMock(await readJson(request)));
    }
    if (request.method === 'POST' && url.pathname === '/chat/genui-action') {
      return toResponse(await handlers.chatGenUiAction(await readJson(request)));
    }
    if (request.method === 'GET' && url.pathname === '/dashboard/sessions') {
      return toResponse(await handlers.dashboardSessions());
    }

    const turnsMatch = url.pathname.match(/^\/dashboard\/sessions\/([^/]+)\/turns$/);
    if (request.method === 'GET' && turnsMatch) {
      return toResponse(await handlers.dashboardTurns(decodeURIComponent(turnsMatch[1])));
    }
    const eventsMatch = url.pathname.match(/^\/dashboard\/events\/([^/]+)$/);
    if (request.method === 'GET' && eventsMatch) {
      return toResponse(handlers.dashboardEvents(decodeURIComponent(eventsMatch[1])));
    }

    return json({ errorCode: 'not_found' }, 404);
  },
};

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return undefined;
  return JSON.parse(text);
}

function toResponse(response: HandlerResponse): Response {
  if (response.contentType?.startsWith('text/')) {
    return new Response(String(response.body), {
      status: response.status,
      headers: { ...corsHeaders(), 'Content-Type': response.contentType },
    });
  }
  return json(response.body, response.status);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}
