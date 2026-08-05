import { z } from "zod";

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  DATABASE_URL: z
    .string()
    .default("postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent"),
  KFC_AGENT_PROFILE_MODE: z
    .enum(["production", "qualification"])
    .default("production"),
  KFC_AGENT_PROVIDER: z.enum(["openai", "google"]).default("google"),
  KFC_AGENT_RUNTIME: z
    .enum(["stategraph", "openai-responses"])
    .default("stategraph"),
  KFC_AGENT_MODEL: z.string().optional().default(""),
  KFC_AGENT_COMPACTION_ENABLED: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("true"),
  KFC_AGENT_COMPACTION_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .min(16_384)
    .max(4_194_304)
    .default(98_304),
  KFC_AGENT_COMPACTION_MODEL: z.string().optional().default(""),
  KFC_MONITOR_PROVIDER: z.enum(["openai", "google"]).optional(),
  KFC_MONITOR_MODEL: z.string().optional().default(""),
  KFC_CONFIRMATION_SIGNING_KEY_ID: z.string().default("primary"),
  KFC_CONFIRMATION_SIGNING_SECRET: z.string().optional().default(""),
  KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  GOOGLE_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().optional().default("https://api.openai.com/v1"),
  OPENAI_DIAGNOSTIC_WORKER_RELEASE: z.string().optional().default(""),
  OPENAI_DIAGNOSTIC_EXECUTION_COLO: z.string().optional().default(""),
  OPENAI_DIAGNOSTIC_EDGE_COLO: z.string().optional().default(""),
  OPENAI_DIAGNOSTIC_PLACEMENT: z.string().optional().default(""),
  LANGSMITH_API_KEY: z.string().optional().default(""),
  LANGSMITH_PROJECT: z.string().default("kfc-agent-backend-local"),
  LANGSMITH_ENDPOINT: z.string().url().default("https://api.smith.langchain.com"),
  LANGSMITH_TRACING_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(1),
  KFC_SHOWCASE_DATASET: z.string().default("kfc-showcase-scenarios-v1"),
  RELEASE_GIT_SHA: z.string().optional().default("unknown"),
  RELEASE_DEPLOYMENT_ID: z.string().optional().default("unknown"),
  RELEASE_BUILT_AT: z.string().optional().default(""),
  RELEASE_DIRTY: z.string().optional().default(""),
  RELEASE_DIGEST: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  MESSENGER_VERIFY_TOKEN: z.string().optional().default(""),
  META_PAGE_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_PAGE_ACCESS_TOKEN: z.string().optional().default(""),
  META_INBOX_URL_TEMPLATE: z.string().optional().default(""),
  MESSENGER_GRAPH_API_BASE_URL: z.string().optional().default(""),
  ZALO_OA_ID: z.string().optional().default(""),
  ZALO_ACCESS_TOKEN: z.string().optional().default(""),
  ZALO_INBOX_URL_TEMPLATE: z.string().optional().default(""),
  ZALO_REFRESH_TOKEN: z.string().optional().default(""),
  ZALO_APP_ID: z.string().optional().default(""),
  ZALO_APP_SECRET: z.string().optional().default(""),
  ZALO_API_BASE_URL: z.string().optional().default(""),
  KFC_COMMERCE_MODE: z.enum(["fixture", "gateway"]).default("gateway"),
  KFC_COMMERCE_ENVIRONMENT: z.enum(["production", "sandbox"]).optional(),
  KFC_MENU_API_URL: z.string().optional(),
  CATALOG_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).optional(),
  KFC_COMMERCE_GATEWAY_BASE_URL: z.string().optional().default(""),
  KFC_COMMERCE_GATEWAY_TOKEN: z.string().optional().default(""),
  KFC_POS_MODE: z.enum(["disabled", "http"]).default("disabled"),
  KFC_POS_BASE_URL: z.string().optional().default(""),
  KFC_POS_TOKEN: z.string().optional().default(""),
  KFC_DEMO_ADMIN_TOKEN: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
