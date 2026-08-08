import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeDemoAdminHeaders } from '../security/demoAdminAuth.js';
import {
  verifyMessengerGuestCheckoutIngress,
} from '../security/guestCheckoutAuthority.js';
import { verifyMetaWebhookSignature } from '../security/webhookAuthenticity.js';
import { createRouteHandlers, type HandlerResponse, type RouteOptions } from './routeHandlers.js';

export type {
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
} from './routeHandlers.js';

export function registerRoutes(server: FastifyInstance, options: RouteOptions = {}): void {
  const handlers = createRouteHandlers(options);

  server.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/admin/lifecycle/') && options.lifecycle?.environment !== 'sandbox') return;
    if (!requiresDemoAdmin(request.url)) return;
    const authorization = request.headers.authorization;
    const token = request.headers['x-kfc-demo-admin-token'];
    const decision = authorizeDemoAdminHeaders({
      expectedToken: options.demoAdminToken,
      authorizationHeader: Array.isArray(authorization) ? authorization[0] : authorization,
      tokenHeader: Array.isArray(token) ? token[0] : token,
    });
    if (!decision.ok) return reply.code(decision.status).send({ errorCode: decision.errorCode });
  });

  const serveWebsite = (_request: unknown, reply: { type(ct: string): { send(content: string): unknown } }) => {
    const candidatePaths = [
      resolve(process.cwd(), 'dist/client/index.html'),
      resolve(process.cwd(), 'client/index.html'),
      resolve(process.cwd(), '../../apps/pvcfc_chat_web/dist/index.html'),
      resolve(process.cwd(), '../pvcfc_chat_web/dist/index.html'),
      resolve(process.cwd(), '../../pvcfc_website.html'),
      resolve(process.cwd(), 'pvcfc_website.html'),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        return reply.type('text/html; charset=utf-8').send(readFileSync(p, 'utf8'));
      }
    }
    return reply.type('text/html; charset=utf-8').send('<h1>PVCFC Backend</h1>');
  };

  server.get('/', serveWebsite);
  server.get('/demo', serveWebsite);
  server.get('/pvcfc', serveWebsite);

  server.get('/assets/:file', async (request, reply) => {
    const params = z.object({ file: z.string().min(1) }).parse(request.params);
    const safeFile = params.file.replace(/[^a-zA-Z0-9._-]/g, '');
    const assetCandidates = [
      resolve(process.cwd(), 'dist/client/assets', safeFile),
      resolve(process.cwd(), 'client/assets', safeFile),
      resolve(process.cwd(), '../../apps/pvcfc_chat_web/dist/assets', safeFile),
      resolve(process.cwd(), '../pvcfc_chat_web/dist/assets', safeFile),
    ];
    for (const p of assetCandidates) {
      if (existsSync(p)) {
        const ct = safeFile.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : safeFile.endsWith('.js')
            ? 'application/javascript; charset=utf-8'
            : 'application/octet-stream';
        return reply.type(ct).send(readFileSync(p));
      }
    }
    return reply.code(404).send({ error: 'Asset not found' });
  });
  server.get('/ready', async (request, reply) => {
    const query = z.object({ deep: z.enum(['0', '1']).optional() }).parse(request.query);
    return send(reply, await handlers.ready(query.deep === '1'));
  });
  if (options.lifecycle?.environment === 'sandbox') {
    server.post('/admin/lifecycle/sessions/:sessionId/instances', async (request, reply) => {
      const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
      return send(reply, await handlers.lifecycleCreate(params.sessionId));
    });
    server.get('/admin/lifecycle/instances/:instanceId', async (request, reply) => {
      const params = z.object({ instanceId: z.string().min(1) }).parse(request.params);
      return send(reply, await handlers.lifecycleGet(params.instanceId));
    });
    server.post('/admin/lifecycle/instances/:instanceId/events', async (request, reply) => {
      const params = z.object({ instanceId: z.string().min(1) }).parse(request.params);
      return send(reply, await handlers.lifecycleEvent(params.instanceId, request.body));
    });
  }
  server.get('/admin/proof/messenger/sessions/:sessionId/envelope', async (request, reply) => {
    const params = z.object({ sessionId: z.string().startsWith('messenger:') }).parse(request.params);
    return send(reply, await handlers.messengerProofEnvelope(params.sessionId));
  });
  server.get('/admin/proof/kfc/sessions/:sessionId/envelope', async (request, reply) => {
    const params = z.object({ sessionId: z.string().startsWith('kfc:') }).parse(request.params);
    return send(reply, await handlers.kfcProofEnvelope(params.sessionId));
  });
  server.post('/admin/proof/kfc/sessions/:sessionId/preconditions', async (request, reply) => {
    const params = z.object({ sessionId: z.string().startsWith('kfc:') }).parse(request.params);
    return send(reply, await handlers.kfcProofPreconditions(params.sessionId, request.body));
  });
  server.get('/showcase/scenarios', async (_request, reply) => send(reply, await handlers.showcaseCatalog()));
  server.post('/showcase/results', async (request, reply) => send(reply, await handlers.showcaseComplete(request.body)));
  server.post('/chat/kfc/message', async (request, reply) => {
    return send(reply, await handlers.chatKfcMessage(request.body));
  });
  server.post('/chat/pvcfc/message', async (request, reply) => {
    return send(reply, await handlers.chatPvcfcMessage(request.body));
  });
  server.post('/chat/kfc/confirmations/resume', async (request, reply) => send(reply, await handlers.confirmationResume(request.body)));
  server.post('/chat/kfc/genui-action', async (request, reply) => send(reply, await handlers.chatKfcGenUiAction(request.body)));
  server.post('/chat/kfc/runs', async (request, reply) => send(reply, await handlers.chatKfcStartRun(request.body)));
  server.post('/chat/kfc/runs/:runId/cancel', async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    return send(reply, await handlers.chatKfcCancelRun(params.runId));
  });
  server.get('/chat/kfc/runs/:runId/events', async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const query = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const run = await handlers.store.getCustomerRun(params.runId);
    if (!run) return reply.code(404).send({ errorCode: 'run_not_found' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    let closed = false;
    let cursor = query.after;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(windowTimeout);
      reply.raw.end();
    };
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': heartbeat\n\n');
    }, 10_000);
    const windowTimeout = setTimeout(close, 25_000);
    request.raw.on('close', close);

    while (!closed) {
      const events = await handlers.store.listCustomerRunEvents(params.runId, cursor);
      for (const event of events) {
        if (closed) break;
        cursor = event.sequence;
        reply.raw.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const current = await handlers.store.getCustomerRun(params.runId);
      if (current && ['completed', 'failed', 'cancelled', 'superseded'].includes(current.status)) {
        close();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  server.get('/chat/kfc/sessions/:sessionId/updates', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    const query = z.object({ after: z.string().optional() }).parse(request.query);
    return send(reply, await handlers.chatKfcSessionUpdates(params.sessionId, query.after));
  });
  server.get('/webhooks/messenger', async (request, reply) =>
    send(reply, handlers.messengerVerify(request.query as Record<string, unknown>)),
  );
  server.post('/webhooks/messenger', async (request, reply) => {
    if (!options.metaAppSecret) {
      return reply.code(503).send({ errorCode: 'messenger_webhook_authenticity_not_configured' });
    }
    const signature = request.headers['x-hub-signature-256'];
    const rawBody = request.rawBody;
    if (rawBody && rawBody.byteLength > 1_000_000) {
      return reply.code(413).send({
        errorCode: 'messenger_webhook_payload_too_large',
      });
    }
    const valid = rawBody && await verifyMetaWebhookSignature({
      rawBody,
      signatureHeader: Array.isArray(signature) ? signature[0] ?? null : signature ?? null,
      appSecret: options.metaAppSecret,
    });
    if (!valid) {
      return reply.code(401).send({ errorCode: 'invalid_messenger_webhook_signature' });
    }
    const verifiedIngress = await verifyMessengerGuestCheckoutIngress({
      rawBody,
      signatureHeader:
        Array.isArray(signature) ? signature[0] ?? null : signature ?? null,
      appSecret: options.metaAppSecret,
      pageId: options.metaPageId ?? '',
    });
    return send(
      reply,
      await handlers.messengerWebhook(request.body, verifiedIngress),
    );
  });
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

function requiresDemoAdmin(rawUrl: string): boolean {
  const pathname = rawUrl.split('?', 1)[0] ?? rawUrl;
  return pathname.startsWith('/admin/') ||
    pathname.startsWith('/dashboard/');
}

function send(reply: { code(statusCode: number): { type(contentType: string): unknown; send(payload: unknown): unknown }; send(payload: unknown): unknown }, response: HandlerResponse) {
  const coded = reply.code(response.status);
  if (response.contentType) coded.type(response.contentType);
  return coded.send(response.body);
}
