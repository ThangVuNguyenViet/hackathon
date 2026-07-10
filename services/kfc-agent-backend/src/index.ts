import { DashboardEventBus } from "./dashboard/eventBus.js";
import { buildServer } from "./api/server.js";
import { buildServerOptionsFromEnv } from "./api/serverOptions.js";
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from "./channels/messengerHistory.js";
import { loadEnv } from "./config/env.js";
import { createPostgresPersistence } from "./persistence/postgresStore.js";

const env = loadEnv();
const baseOptions = buildServerOptionsFromEnv(env);
const persistence = await createPostgresPersistence({
  databaseUrl: env.DATABASE_URL,
});
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
const server = buildServer({
  ...baseOptions,
  store: persistence.store,
  dashboard,
  messengerHistorySync,
  readiness: {
    ...baseOptions.readiness,
    database: async () => {
      await persistence.pool.query("SELECT 1");
      return { ok: true };
    },
    openAiConfigured: Boolean(env.OPENAI_API_KEY),
    openAiRequired: false,
  },
});

server.addHook("onClose", async () => {
  await persistence.pool.end();
});

await server.listen({ host: "0.0.0.0", port: env.PORT });
messengerHistorySync?.syncInBackground();
