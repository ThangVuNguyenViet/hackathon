import { z } from 'zod';

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  DATABASE_URL: z.string().default('postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent'),
  OPENAI_API_KEY: z.string().optional().default(''),
  LANGSMITH_API_KEY: z.string().optional().default(''),
  LANGSMITH_PROJECT: z.string().default('kfc-agent-backend-local'),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
