import { z } from "zod";

const strictBooleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  DATABASE_URL: z
    .string()
    .default("postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4.1"),
  OPENAI_TOOL_PLANNER_MODEL: z.string().default("gpt-4.1"),
  OPENAI_RESPONSE_MODEL: z.string().default("gpt-4.1-nano"),
  OPENAI_SMALL_TALK_ROUTER_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  OPENAI_MONITOR_JUDGE_MODEL: z.string().default("gpt-4.1-nano"),
  OPENAI_BASE_URL: z.string().optional().default("https://api.openai.com/v1"),
  LANGSMITH_API_KEY: z.string().optional().default(""),
  LANGSMITH_PROJECT: z.string().default("kfc-agent-backend-local"),
  LANGSMITH_ENDPOINT: z.string().url().default("https://api.smith.langchain.com"),
  LANGSMITH_TRACING_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(1),
  MESSENGER_VERIFY_TOKEN: z.string().optional().default(""),
  META_PAGE_ID: z.string().optional().default(""),
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
  KFC_COMMERCE_MODE: z.enum(["fixture", "gateway"]).default("fixture"),
  KFC_COMMERCE_GATEWAY_BASE_URL: z.string().optional().default(""),
  KFC_COMMERCE_GATEWAY_TOKEN: z.string().optional().default(""),
  KFC_POS_MODE: z.enum(["disabled", "http"]).default("disabled"),
  KFC_POS_BASE_URL: z.string().optional().default(""),
  KFC_POS_TOKEN: z.string().optional().default(""),
  KFC_CUSTOMER_CHAT_STREAMING_MODE: z
    .enum(["off", "internal", "cohort", "on"])
    .default("off"),
  KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(0),
  KFC_CUSTOMER_CHAT_STREAMING_POLICY_REVISION: z
    .string()
    .trim()
    .min(1)
    .default("customer-streaming-v1-off"),
  KFC_CUSTOMER_CHAT_STREAMING_INTERNAL_CUSTOMER_IDS: z
    .string()
    .optional()
    .default(""),
  KFC_CUSTOMER_CHAT_STREAMING_COHORT_SALT: z.string().optional().default(""),
  KFC_CUSTOMER_CHAT_STREAMING_SCHEMA_MIN: z.coerce.number().int().positive().default(1),
  KFC_CUSTOMER_CHAT_STREAMING_SCHEMA_MAX: z.coerce.number().int().positive().default(1),
  KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED: strictBooleanString,
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
