import { z } from 'zod';
import { agentModelCandidateIds } from './agentModelProfile.js';

const optionalUrlSchema = z
  .string()
  .refine(
    (value) => value.trim() === '' || z.string().url().safeParse(value).success,
    'Must be empty or a valid URL',
  );

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  KFC_AGENT_CANDIDATE: z
    .enum(agentModelCandidateIds)
    .default('openai-gpt-4.1-mini'),
  KFC_MONITOR_CANDIDATE: z.enum(agentModelCandidateIds).optional(),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENCODE_API_KEY: z.string().optional().default(''),
  GOOGLE_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().optional().default('https://api.openai.com/v1'),
  OPENAI_DIAGNOSTIC_WORKER_RELEASE: z.string().optional().default(''),
  OPENAI_DIAGNOSTIC_EXECUTION_COLO: z.string().optional().default(''),
  OPENAI_DIAGNOSTIC_EDGE_COLO: z.string().optional().default(''),
  OPENAI_DIAGNOSTIC_PLACEMENT: z.string().optional().default(''),
  LANGSMITH_API_KEY: z.string().optional().default(''),
  LANGSMITH_PROJECT: z.string().default('kfc-agent-backend-local'),
  LANGSMITH_ENDPOINT: z
    .string()
    .url()
    .default('https://api.smith.langchain.com'),
  LANGSMITH_TRACING_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(1),
  KFC_SHOWCASE_DATASET: z.string().default('kfc-showcase-scenarios-v1'),
  RELEASE_GIT_SHA: z.string().optional().default('unknown'),
  RELEASE_DEPLOYMENT_ID: z.string().optional().default('unknown'),
  RELEASE_BUILT_AT: z.string().optional().default(''),
  RELEASE_DIRTY: z.string().optional().default(''),
  MESSENGER_VERIFY_TOKEN: z.string().optional().default(''),
  META_PAGE_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_PAGE_ACCESS_TOKEN: z.string().optional().default(''),
  META_INBOX_URL_TEMPLATE: z.string().optional().default(''),
  MESSENGER_GRAPH_API_BASE_URL: z.string().optional().default(''),
  ZALO_OA_ID: z.string().optional().default(''),
  ZALO_ACCESS_TOKEN: z.string().optional().default(''),
  ZALO_INBOX_URL_TEMPLATE: z.string().optional().default(''),
  ZALO_REFRESH_TOKEN: z.string().optional().default(''),
  ZALO_APP_ID: z.string().optional().default(''),
  ZALO_APP_SECRET: z.string().optional().default(''),
  ZALO_API_BASE_URL: z.string().optional().default(''),
  KFC_DEMO_ADMIN_TOKEN: z.string().optional().default(''),
  KFC_RECOMMENDATION_SHADOW_URL: optionalUrlSchema.optional().default(''),
  KFC_RECOMMENDATION_SHADOW_MODEL_REVISION: z.string().optional().default(''),
  KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE: z
    .literal('local_docker_cloudflare_tunnel')
    .default('local_docker_cloudflare_tunnel'),
  KFC_RECOMMENDATION_OUTPUT_MODE: z
    .enum(['baseline', 'learned_technical'])
    .default('baseline'),
  SANITY_PROJECT_ID: z.string().optional().default(''),
  SANITY_DATASET: z.string().optional().default(''),
  SANITY_API_VERSION: z.string().optional().default(''),
  SANITY_READ_TOKEN: z.string().optional().default(''),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
