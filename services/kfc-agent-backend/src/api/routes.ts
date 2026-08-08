import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AutomaticRecommendationIdentityConflictError } from '../recommendations/serving/evidence-saga.js';
import { authorizeDemoAdminHeaders } from '../security/demoAdminAuth.js';
import { verifyMessengerGuestCheckoutIngress } from '../security/guestCheckoutAuthority.js';
import { verifyMetaWebhookSignature } from '../security/webhookAuthenticity.js';
import {
  createRouteHandlers,
  type HandlerResponse,
  type RouteOptions,
} from './routeHandlers.js';

export type {
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
} from './routeHandlers.js';

export function registerRoutes(
  server: FastifyInstance,
  options: RouteOptions = {},
): void {
  const handlers = createRouteHandlers(options);

  server.addHook('onRequest', async (request, reply) => {
    if (
      request.url.startsWith('/admin/lifecycle/') &&
      options.lifecycle?.environment !== 'sandbox'
    )
      return;
    if (!requiresDemoAdmin(request.url)) return;
    const authorization = request.headers.authorization;
    const token = request.headers['x-kfc-demo-admin-token'];
    const decision = authorizeDemoAdminHeaders({
      expectedToken: options.demoAdminToken,
      authorizationHeader: Array.isArray(authorization)
        ? authorization[0]
        : authorization,
      tokenHeader: Array.isArray(token) ? token[0] : token,
    });
    if (!decision.ok)
      return reply
        .code(decision.status)
        .send({ errorCode: decision.errorCode });
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
    const query = z
      .object({ deep: z.enum(['0', '1']).optional() })
      .parse(request.query);
    const deep = query.deep === '1';
    const readiness = await handlers.ready(deep);
    if (!deep || readiness.status !== 200 || !options.runtimeProbe) {
      return send(reply, readiness);
    }
    try {
      const probe = await options.runtimeProbe.emit();
      const body = objectRecord(readiness.body);
      const proof = objectRecord(body.proof);
      return reply
        .code(200)
        .send({ ...body, proof: { ...proof, runtimeProbe: probe } });
    } catch {
      const body = objectRecord(readiness.body);
      const checks = objectRecord(body.checks);
      return reply.code(503).send({
        ...body,
        ok: false,
        checks: {
          ...checks,
          telemetryProbe: { ok: false, message: 'OTLP export failed' },
        },
      });
    }
  });
  const recommendationRoutes = {
    '/v1/recommendations/local-favorites': 'local_favorite',
    '/v1/recommendations/for-you': 'for_you',
    '/v1/recommendations/modifier-upsells': 'modifier_upsell',
    '/v1/recommendations/smart-cross-sells': 'smart_cross_sell',
  } as const;
  for (const [path, type] of Object.entries(recommendationRoutes)) {
    server.post(path, async (request, reply) => {
      if (!options.automaticRecommendations)
        return recommendationUnavailable(reply);
      try {
        return reply
          .code(200)
          .send(
            await options.automaticRecommendations.decide(type, request.body),
          );
      } catch (error) {
        if (error instanceof AutomaticRecommendationIdentityConflictError) {
          return recommendationIdentityConflict(reply);
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            type: 'https://kfc.example/problems/invalid-request',
            title: 'Invalid recommendation request',
            status: 400,
            code: 'invalid_request',
            retryable: false,
          });
        }
        return recommendationUnavailable(reply);
      }
    });
  }
  server.post(
    '/v1/recommendations/:recommendationId/impressions',
    async (request, reply) => {
      if (!options.automaticRecommendations)
        return recommendationUnavailable(reply);
      const params = z
        .object({ recommendationId: z.string().min(1) })
        .parse(request.params);
      try {
        await options.automaticRecommendations.recordImpression(
          params.recommendationId,
          request.body,
        );
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof AutomaticRecommendationIdentityConflictError)
          return recommendationIdentityConflict(reply);
        if (error instanceof z.ZodError)
          return reply.code(400).send({ errorCode: 'invalid_request' });
        return recommendationUnavailable(reply);
      }
    },
  );
  server.post(
    '/v1/recommendations/:recommendationId/outcomes',
    async (request, reply) => {
      if (!options.automaticRecommendations)
        return recommendationUnavailable(reply);
      const params = z
        .object({ recommendationId: z.string().min(1) })
        .parse(request.params);
      try {
        await options.automaticRecommendations.recordOutcome(
          params.recommendationId,
          request.body,
        );
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof AutomaticRecommendationIdentityConflictError)
          return recommendationIdentityConflict(reply);
        if (error instanceof z.ZodError)
          return reply.code(400).send({ errorCode: 'invalid_request' });
        return recommendationUnavailable(reply);
      }
    },
  );
  server.get(
    '/v1/admin/recommendations/:recommendationId/inspection',
    async (request, reply) => {
      if (!options.automaticRecommendations)
        return recommendationUnavailable(reply);
      const params = z
        .object({ recommendationId: z.string().min(1) })
        .parse(request.params);
      const page = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().min(1).max(512).optional(),
      }).parse(request.query);
      try {
        return reply
          .code(200)
          .send(
            await options.automaticRecommendations.inspect(
              params.recommendationId,
              page,
            ),
          );
      } catch {
        return recommendationUnavailable(reply);
      }
    },
  );
  if (options.lifecycle?.environment === 'sandbox') {
    server.post(
      '/admin/lifecycle/sessions/:sessionId/instances',
      async (request, reply) => {
        const params = z
          .object({ sessionId: z.string().min(1) })
          .parse(request.params);
        return send(reply, await handlers.lifecycleCreate(params.sessionId));
      },
    );
    server.get(
      '/admin/lifecycle/instances/:instanceId',
      async (request, reply) => {
        const params = z
          .object({ instanceId: z.string().min(1) })
          .parse(request.params);
        return send(reply, await handlers.lifecycleGet(params.instanceId));
      },
    );
    server.post(
      '/admin/lifecycle/instances/:instanceId/events',
      async (request, reply) => {
        const params = z
          .object({ instanceId: z.string().min(1) })
          .parse(request.params);
        return send(
          reply,
          await handlers.lifecycleEvent(params.instanceId, request.body),
        );
      },
    );
  }
  server.get(
    '/admin/proof/messenger/sessions/:sessionId/envelope',
    async (request, reply) => {
      const params = z
        .object({ sessionId: z.string().startsWith('messenger:') })
        .parse(request.params);
      return send(
        reply,
        await handlers.messengerProofEnvelope(params.sessionId),
      );
    },
  );
  server.get(
    '/admin/proof/kfc/sessions/:sessionId/envelope',
    async (request, reply) => {
      const params = z
        .object({ sessionId: z.string().startsWith('kfc:') })
        .parse(request.params);
      return send(reply, await handlers.kfcProofEnvelope(params.sessionId));
    },
  );
  server.post(
    '/admin/proof/kfc/sessions/:sessionId/preconditions',
    async (request, reply) => {
      const params = z
        .object({ sessionId: z.string().startsWith('kfc:') })
        .parse(request.params);
      return send(
        reply,
        await handlers.kfcProofPreconditions(params.sessionId, request.body),
      );
    },
  );
  server.get('/showcase/scenarios', async (_request, reply) =>
    send(reply, await handlers.showcaseCatalog()),
  );
  server.post('/showcase/results', async (request, reply) =>
    send(reply, await handlers.showcaseComplete(request.body)),
  );
  server.post('/chat/kfc/message', async (request, reply) => {
    return send(reply, await handlers.chatKfcMessage(request.body));
  });
server.post('/chat/pvcfc/message', async (request, reply) => {
    return send(reply, await handlers.chatPvcfcMessage(request.body));
  });
  server.post('/chat/kfc/genui-action', async (request, reply) =>
    send(reply, await handlers.chatKfcGenUiAction(request.body)),
  );
  server.post('/chat/kfc/confirmations/resume', async (request, reply) =>
    send(reply, await handlers.confirmationResume(request.body)),
  );
  server.post('/chat/kfc/runs', async (request, reply) =>
    send(reply, await handlers.chatKfcStartRun(request.body)),
  );
  server.post('/chat/kfc/runs/:runId/cancel', async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    return send(reply, await handlers.chatKfcCancelRun(params.runId));
  });
  server.get('/chat/kfc/runs/:runId/events', async (request, reply) => {
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({ after: z.coerce.number().int().min(0).default(0) })
      .parse(request.query);
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
      const events = await handlers.store.listCustomerRunEvents(
        params.runId,
        cursor,
      );
      for (const event of events) {
        if (closed) break;
        cursor = event.sequence;
        reply.raw.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
      const current = await handlers.store.getCustomerRun(params.runId);
      if (
        current &&
        ['completed', 'failed', 'cancelled', 'superseded'].includes(
          current.status,
        )
      ) {
        close();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  server.get(
    '/chat/kfc/sessions/:sessionId/updates',
    async (request, reply) => {
      const params = z.object({ sessionId: z.string() }).parse(request.params);
      const query = z
        .object({ after: z.string().optional() })
        .parse(request.query);
      return send(
        reply,
        await handlers.chatKfcSessionUpdates(params.sessionId, query.after),
      );
    },
  );
  server.get('/webhooks/messenger', async (request, reply) =>
    send(
      reply,
      handlers.messengerVerify(request.query as Record<string, unknown>),
    ),
  );
  server.post('/webhooks/messenger', async (request, reply) => {
    if (!options.metaAppSecret) {
      return reply
        .code(503)
        .send({ errorCode: 'messenger_webhook_authenticity_not_configured' });
    }
    const signature = request.headers['x-hub-signature-256'];
    const rawBody = request.rawBody;
    if (rawBody && rawBody.byteLength > 1_000_000) {
      return reply.code(413).send({
        errorCode: 'messenger_webhook_payload_too_large',
      });
    }
    const valid =
      rawBody &&
      (await verifyMetaWebhookSignature({
        rawBody,
        signatureHeader: Array.isArray(signature)
          ? (signature[0] ?? null)
          : (signature ?? null),
        appSecret: options.metaAppSecret,
      }));
    if (!valid) {
      return reply
        .code(401)
        .send({ errorCode: 'invalid_messenger_webhook_signature' });
    }
    const verifiedIngress = await verifyMessengerGuestCheckoutIngress({
      rawBody,
      signatureHeader: Array.isArray(signature)
        ? (signature[0] ?? null)
        : (signature ?? null),
      appSecret: options.metaAppSecret,
      pageId: options.metaPageId ?? '',
    });
    return send(
      reply,
      await handlers.messengerWebhook(request.body, verifiedIngress),
    );
  });
  server.post('/webhooks/zalo', async (request, reply) =>
    send(reply, await handlers.zaloWebhook(request.body)),
  );
  server.post('/admin/messenger/sync-history', async (request, reply) =>
    send(reply, await handlers.messengerHistorySync(request.body)),
  );
  server.get('/admin/messenger/sync-history/status', async (_request, reply) =>
    send(reply, handlers.messengerHistorySyncStatus()),
  );
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
  server.get('/dashboard/sessions', async (_request, reply) =>
    send(reply, await handlers.dashboardSessions()),
  );
  server.get('/dashboard/sessions/:sessionId/turns', async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return send(reply, await handlers.dashboardTurns(params.sessionId));
  });
  server.get(
    '/dashboard/sessions/:sessionId/control',
    async (request, reply) => {
      const params = z.object({ sessionId: z.string() }).parse(request.params);
      return send(
        reply,
        await handlers.dashboardSessionControl(params.sessionId),
      );
    },
  );
  server.post(
    '/dashboard/sessions/:sessionId/human-join',
    async (request, reply) => {
      const params = z.object({ sessionId: z.string() }).parse(request.params);
      return send(
        reply,
        await handlers.dashboardHumanJoin(params.sessionId, request.body),
      );
    },
  );
  server.post(
    '/dashboard/sessions/:sessionId/human-message',
    async (request, reply) => {
      const params = z.object({ sessionId: z.string() }).parse(request.params);
      return send(
        reply,
        await handlers.dashboardHumanMessage(params.sessionId, request.body),
      );
    },
  );
  server.post(
    '/dashboard/sessions/:sessionId/resume-ai',
    async (request, reply) => {
      const params = z.object({ sessionId: z.string() }).parse(request.params);
      return send(
        reply,
        await handlers.dashboardResumeAi(params.sessionId, request.body),
      );
    },
  );
}

function recommendationUnavailable(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}) {
  return reply.code(503).send({
    type: 'https://kfc.example/problems/recommendation-infrastructure-unavailable',
    title: 'Recommendation infrastructure unavailable',
    status: 503,
    code: 'recommendation_infrastructure_unavailable',
    retryable: true,
  });
}

function recommendationIdentityConflict(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}) {
  return reply.code(409).send({
    type: 'https://kfc.example/problems/identity-conflict',
    title: 'Recommendation identity conflict',
    status: 409,
    code: 'identity_conflict',
    retryable: false,
  });
}

function requiresDemoAdmin(rawUrl: string): boolean {
  const pathname = rawUrl.split('?', 1)[0] ?? rawUrl;
  if (/^\/v1\/admin\/recommendations\/[^/]+\/inspection$/u.test(pathname)) {
    return false;
  }
  return (
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/v1/admin/') ||
    pathname.startsWith('/dashboard/')
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return z.record(z.unknown()).safeParse(value).data ?? {};
}

function send(
  reply: {
    code(statusCode: number): {
      type(contentType: string): unknown;
      send(payload: unknown): unknown;
    };
    send(payload: unknown): unknown;
  },
  response: HandlerResponse,
) {
  const coded = reply.code(response.status);
  if (response.contentType) coded.type(response.contentType);
  return coded.send(response.body);
}
