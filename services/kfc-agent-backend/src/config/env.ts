import { z } from 'zod';

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  DATABASE_URL: z.string().default('postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default('gpt-4.1'),
  OPENAI_BASE_URL: z.string().optional().default('https://api.openai.com/v1'),
  LANGSMITH_API_KEY: z.string().optional().default(''),
  LANGSMITH_PROJECT: z.string().default('kfc-agent-backend-local'),
  MESSENGER_VERIFY_TOKEN: z.string().optional().default(''),
  META_PAGE_ID: z.string().optional().default('118976205445198'),
  META_PAGE_ACCESS_TOKEN: z.string().optional().default(''),
  MESSENGER_GRAPH_API_BASE_URL: z.string().optional().default(''),
  ZALO_OA_ID: z.string().optional().default(''),
  ZALO_ACCESS_TOKEN: z.string().optional().default(''),
  ZALO_API_BASE_URL: z.string().optional().default(''),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
