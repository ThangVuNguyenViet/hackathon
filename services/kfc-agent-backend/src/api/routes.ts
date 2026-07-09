import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRouteHandlers, type HandlerResponse, type RouteOptions } from './routeHandlers.js';

export type {
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
} from './routeHandlers.js';

export function registerRoutes(server: FastifyInstance, options: RouteOptions = {}): void {
  const handlers = createRouteHandlers(options);

  server.get('/ready', async (_request, reply) => send(reply, await handlers.ready()));
  server.post('/chat/mock', async (request, reply) => send(reply, await handlers.chatMock(request.body)));
  server.post('/chat/genui-action', async (request, reply) => send(reply, await handlers.chatGenUiAction(request.body)));
  server.get('/webhooks/messenger', async (request, reply) =>
    send(reply, handlers.messengerVerify(request.query as Record<string, unknown>)),
  );
  server.post('/webhooks/messenger', async (request, reply) => send(reply, await handlers.messengerWebhook(request.body)));
  server.post('/webhooks/zalo', async (request, reply) => send(reply, await handlers.zaloWebhook(request.body)));
  server.post('/admin/messenger/sync-history', async (request, reply) =>
    send(reply, await handlers.messengerHistorySync(request.body)),
  );
  server.get('/admin/messenger/sync-history/status', async (_request, reply) => send(reply, handlers.messengerHistorySyncStatus()));
  server.get('/dashboard/events/:sessionId', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, handlers.dashboardEvents(params.sessionId));
  });
  server.get('/dashboard/stream', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const unsubscribe = handlers.dashboard.subscribe((event) => {
      reply.raw.write(`event: dashboard\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
  server.get('/dashboard/sessions', async (_request, reply) => send(reply, await handlers.dashboardSessions()));
  server.get('/dashboard/sessions/:sessionId/turns', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardTurns(params.sessionId));
  });
  server.get('/dashboard/sessions/:sessionId/control', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardSessionControl(params.sessionId));
  });
  server.post('/dashboard/sessions/:sessionId/human-join', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardHumanJoin(params.sessionId, request.body));
  });
  server.post('/dashboard/sessions/:sessionId/human-message', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardHumanMessage(params.sessionId, request.body));
  });
  server.post('/dashboard/sessions/:sessionId/resume-ai', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardResumeAi(params.sessionId, request.body));
  });
}

function send(reply: { code(statusCode: number): { type(contentType: string): unknown; send(payload: unknown): unknown }; send(payload: unknown): unknown }, response: HandlerResponse) {
  const coded = reply.code(response.status);
  if (response.contentType) coded.type(response.contentType);
  return coded.send(response.body);
}
