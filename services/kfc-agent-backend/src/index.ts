import { DashboardEventBus } from "./dashboard/eventBus.js";
import { buildServer } from "./api/server.js";
import { createRouteHandlers } from "./api/routeHandlers.js";
import { buildServerOptionsFromEnv } from "./api/serverOptions.js";
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from "./channels/messengerHistory.js";
import { loadEnv } from "./config/env.js";
import { createPostgresPersistence } from "./persistence/postgresStore.js";
import { createZaloOAuthRuntime } from "./channels/zaloOAuth.js";
import { AgentRunCoordinator } from "./agentRuns/coordinator.js";

const env = loadEnv();
const baseOptions = buildServerOptionsFromEnv(env);
const persistence = await createPostgresPersistence({
  databaseUrl: env.DATABASE_URL,
});
const zaloOAuthConfigured = Boolean(
  env.ZALO_APP_ID &&
    env.ZALO_APP_SECRET &&
    env.ZALO_OA_ID &&
    env.ZALO_TOKEN_ENCRYPTION_KEY &&
    env.ZALO_PUBLIC_BASE_URL,
);
const zaloOAuth = zaloOAuthConfigured
  ? await createZaloOAuthRuntime({
      pool: persistence.pool,
      appId: env.ZALO_APP_ID,
      appSecret: env.ZALO_APP_SECRET,
      oaId: env.ZALO_OA_ID,
      callbackUrl: `${env.ZALO_PUBLIC_BASE_URL}/auth/zalo/callback`,
      encryptionKey: env.ZALO_TOKEN_ENCRYPTION_KEY,
      oauthBaseUrl: env.ZALO_OAUTH_BASE_URL,
      initialAccessToken: env.ZALO_ACCESS_TOKEN || undefined,
      initialRefreshToken: env.ZALO_REFRESH_TOKEN || undefined,
    })
  : undefined;
const dashboard = new DashboardEventBus({
  initialEvents: persistence.dashboardEvents,
  persistEvent: (event) => persistence.store.appendDashboardEvent(event),
});
const messengerHistorySync =
  env.META_PAGE_ID.length > 0 && env.META_PAGE_ACCESS_TOKEN.length > 0
    ? new MessengerHistorySyncCoordinator(
        new MessengerHistorySyncService({
          pageId: env.META_PAGE_ID,
          store: persistence.store,
          dashboard,
          client: createMessengerHistoryClient({
            pageId: env.META_PAGE_ID,
            pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
            graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL || undefined,
          }),
        }),
      )
    : undefined;
const serverOptions = {
  ...baseOptions,
  zaloOAuth,
  zaloAccessTokenProvider: zaloOAuth
    ? () => zaloOAuth.accessToken()
    : undefined,
  store: persistence.store,
  checkpointer: persistence.checkpointer,
  dashboard,
  messengerHistorySync,
  readiness: {
    ...baseOptions.readiness,
    messengerRequired: false,
    zaloRequired: true,
    agentConfigured: Boolean(baseOptions.pvcfcAgent),
    runtime: {
      ...baseOptions.readiness?.runtime,
      agent: {
        provider: 'openai' as const,
        model: env.PVCFC_ASTRAFLOW_MODEL,
        profile: `pvcfc-astraflow-${env.PVCFC_ASTRAFLOW_MODEL}`,
      },
    },
    database: async () => {
      await persistence.pool.query("SELECT 1");
      return { ok: true };
    },
    openAiConfigured: Boolean(env.OPENAI_API_KEY),
    openAiRequired: false,
  },
};
const server = buildServer(serverOptions);
const backgroundHandlers = createRouteHandlers(serverOptions);
const agentRunCoordinator = new AgentRunCoordinator({
  store: persistence.store,
  dashboard,
});
let recoveryRunning = false;
const recoverDueAgentRuns = async () => {
  if (recoveryRunning) return;
  recoveryRunning = true;
  try {
    const results = await agentRunCoordinator.claimDueRuns(new Date().toISOString());
    for (const result of results) {
      if (result.dispatch && result.runId) {
        await backgroundHandlers.processMessengerAgentRun(result.runId);
      }
    }
  } catch {
    console.error('agent_run_recovery_failed');
  } finally {
    recoveryRunning = false;
  }
};
const recoveryTimer = setInterval(() => void recoverDueAgentRuns(), 1_000);
recoveryTimer.unref();
setImmediate(() => void recoverDueAgentRuns());

server.addHook("onClose", async () => {
  clearInterval(recoveryTimer);
  await persistence.pool.end();
});

await server.listen({ host: env.HOST, port: env.PORT });
messengerHistorySync?.syncInBackground();
