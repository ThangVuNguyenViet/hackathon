import type { AgentModelIdentity } from './config/agentModelProfile.js';
import type { MonitorModelIdentity } from './config/monitorModelProfile.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import type { WorkerEnv } from './worker.js';
import { recommendationShadowReadiness } from './config/recommendationShadow.js';
import {
  checkRecommendationSanityReadiness,
  createSanityMerchandisingPolicyRepository,
  recommendationSanityConfig,
  type RecommendationSanityReadiness,
  unconfiguredRecommendationSanityReadiness,
} from './config/recommendationSanity.js';

export type WorkerAgentReadiness = (
  | {
      configured: boolean;
      identity: AgentModelIdentity;
      configurationError?: false;
    }
  | {
      configured: false;
      configurationError: true;
      identity?: never;
    }
) & {
  monitor?:
    | {
        configured: boolean;
        identity: MonitorModelIdentity;
        configurationError?: false;
      }
    | {
        configured: false;
        configurationError: true;
        identity?: never;
      };
};

export async function checkWorkerReadiness(
  env: WorkerEnv,
  deep: boolean,
  agent: WorkerAgentReadiness,
): Promise<{
  ok: boolean;
  service: string;
  checks: Record<
    string,
    {
      ok: boolean;
      required?: boolean;
      configured?: boolean;
      message?: string;
      provider?: string;
      model?: string;
      profile?: string;
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
      outputMode?: 'baseline' | 'learned_technical';
      authority?: 'sanity';
      reachable?: boolean;
      policyCount?: number;
      snapshotDigest?: string;
    }
  >;
  release: {
    gitSha: string;
    deploymentId: string;
    releaseBuiltAt: string;
    dirty: boolean;
  };
  proof?: Record<string, unknown>;
  timestamp: string;
}> {
  const database = await runWorkerReadinessCheck(async () => {
    await env.DB.prepare('SELECT 1').first();
    return { ok: true };
  });
  const fixtures = await runWorkerReadinessCheck(async () => {
    const generated = loadBundledGeneratedFixtures();
    return {
      ok: generated.menuItems.length > 0 && generated.stores.length > 0,
    };
  });
  const messenger = checkWorkerMessengerConfig(env);
  const zalo = checkWorkerZaloConfig(env);
  const openai = {
    ok: true,
    required: false,
    configured: Boolean(env.OPENAI_API_KEY?.trim()),
  };
  const agentCheck = agent.configurationError
    ? {
        ok: false,
        required: false,
        configured: false,
        provider: 'invalid',
        model: 'invalid',
        profile: 'invalid',
        message: 'KFC agent configuration is invalid',
      }
    : {
        ok: agent.configured,
        required: false,
        configured: agent.configured,
        provider: agent.identity.provider,
        model: agent.identity.model,
        profile: agent.identity.profile,
      };
  const monitorCheck = agent.monitor?.configurationError
    ? {
        ok: true,
        required: false,
        configured: false,
        provider: 'invalid',
        model: 'invalid',
        profile: 'invalid',
        message: 'KFC monitor configuration is invalid',
      }
    : agent.monitor?.identity
      ? {
          ok: true,
          required: false,
          configured: agent.monitor.configured,
          provider: agent.monitor.identity.provider,
          model: agent.monitor.identity.model,
          profile: agent.monitor.identity.profile,
          message: agent.monitor.configured
            ? undefined
            : 'The configured asynchronous monitor model is unavailable',
        }
      : {
          ok: true,
          required: false,
          configured: false,
          provider: 'unconfigured',
          model: 'unconfigured',
          profile: 'unconfigured',
        };
  const configuredSamplingRate = Number(
    env.LANGSMITH_TRACING_SAMPLING_RATE ?? '1',
  );
  const observability = {
    ok: true,
    langsmith: {
      configured: Boolean(
        env.LANGSMITH_API_KEY &&
        env.LANGSMITH_PROJECT &&
        env.LANGSMITH_ENDPOINT,
      ),
      project: env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
      endpoint: env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com',
      samplingRate: Number.isFinite(configuredSamplingRate)
        ? configuredSamplingRate
        : 1,
    },
  };
  const recommendationSanity =
    await checkWorkerRecommendationSanityReadiness(env);
  const checks: Record<
    string,
    {
      ok: boolean;
      required?: boolean;
      configured?: boolean;
      message?: string;
      provider?: string;
      model?: string;
      profile?: string;
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
      outputMode?: 'baseline' | 'learned_technical';
    }
  > = {
    database,
    fixtures,
    messenger,
    zalo,
    openai,
    agent: agentCheck,
    monitor: monitorCheck,
    observability,
    commerce: {
      ok: true,
      configured: true,
      message: 'Bundled fixture commerce is enabled',
    },
    recommendationShadow: recommendationShadowReadiness({
      shadowUrl: env.KFC_RECOMMENDATION_SHADOW_URL ?? '',
      modelRevision: env.KFC_RECOMMENDATION_SHADOW_MODEL_REVISION ?? '',
      outputMode: env.KFC_RECOMMENDATION_OUTPUT_MODE ?? 'baseline',
    }),
    recommendationSanity,
  };
  if (deep) {
    checks.messengerToken = await checkMessengerToken(env);
  }
  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: 'kfc-agent-backend',
    checks,
    release: {
      gitSha: env.RELEASE_GIT_SHA ?? 'unknown',
      deploymentId: env.RELEASE_DEPLOYMENT_ID ?? 'unknown',
      releaseBuiltAt: env.RELEASE_BUILT_AT ?? 'unknown',
      dirty: env.RELEASE_DIRTY !== 'false',
    },
    ...(deep
      ? {
          proof: {
            deployment: {
              gitSha: env.RELEASE_GIT_SHA ?? 'unknown',
              deploymentId: env.RELEASE_DEPLOYMENT_ID ?? 'unknown',
              builtAt: env.RELEASE_BUILT_AT ?? 'unknown',
              dirty: env.RELEASE_DIRTY !== 'false',
            },
            commerceEnvironment: 'fixture',
            providerFingerprint: null,
            catalogObservation: null,
            lifecycle: {
              provider: null,
              controlsRegistered: false,
            },
            agentRuntime: {
              runtime: 'simple-model-tool-loop',
              context: 'conversation-history',
            },
            versions: {
              agent: agent.identity ?? null,
              monitor: agent.monitor?.identity ?? null,
              toolCatalog: 'typed-commerce-tools-v1',
              ranker: 'deterministic-safety-rerank-v1',
              ledger: 'kfc-scenario-ledger-v1',
              recommendationShadow: checks.recommendationShadow,
              recommendationSanity: {
                authority: recommendationSanity.authority,
                configured: recommendationSanity.configured,
                reachable: recommendationSanity.reachable ?? false,
                snapshotDigest: recommendationSanity.snapshotDigest ?? null,
              },
            },
          },
        }
      : {}),
    timestamp: new Date().toISOString(),
  };
}

async function checkWorkerRecommendationSanityReadiness(
  env: WorkerEnv,
): Promise<RecommendationSanityReadiness> {
  try {
    const config = recommendationSanityConfig({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET,
      apiVersion: env.SANITY_API_VERSION,
      readToken: env.SANITY_READ_TOKEN,
    });
    if (!config) return unconfiguredRecommendationSanityReadiness();
    const repository = createSanityMerchandisingPolicyRepository(
      config,
      env.SANITY_CLIENT ? () => env.SANITY_CLIENT! : undefined,
    );
    return await checkRecommendationSanityReadiness(repository);
  } catch {
    return {
      ok: false,
      required: true,
      configured: false,
      authority: 'sanity',
      message: 'Sanity merchandising configuration is invalid',
    };
  }
}

export async function runWorkerReadinessCheck(
  check: () => Promise<{
    ok: boolean;
    required?: boolean;
    configured?: boolean;
    message?: string;
  }>,
): Promise<{
  ok: boolean;
  required?: boolean;
  configured?: boolean;
  message?: string;
}> {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Readiness check failed',
    };
  }
}

export function checkWorkerMessengerConfig(env: WorkerEnv): {
  ok: boolean;
  required: true;
  configured: boolean;
  message?: string;
} {
  const missing = [
    !env.MESSENGER_VERIFY_TOKEN ? 'MESSENGER_VERIFY_TOKEN' : undefined,
    !env.META_PAGE_ID ? 'META_PAGE_ID' : undefined,
    !env.META_APP_SECRET ? 'META_APP_SECRET' : undefined,
    !env.META_PAGE_ACCESS_TOKEN ? 'META_PAGE_ACCESS_TOKEN' : undefined,
    !env.META_INBOX_URL_TEMPLATE ? 'META_INBOX_URL_TEMPLATE' : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured,
    required: true,
    configured,
    message: configured ? undefined : `Missing ${missing.join(', ')}`,
  };
}

export function checkWorkerZaloConfig(env: WorkerEnv): {
  ok: boolean;
  required: false;
  configured: boolean;
  message?: string;
} {
  const missing = [
    !env.ZALO_OA_ID ? 'ZALO_OA_ID' : undefined,
    !env.ZALO_ACCESS_TOKEN ? 'ZALO_ACCESS_TOKEN' : undefined,
    !env.ZALO_INBOX_URL_TEMPLATE ? 'ZALO_INBOX_URL_TEMPLATE' : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: true,
    required: false,
    configured,
    message: configured ? undefined : `Missing ${missing.join(', ')}`,
  };
}

export async function checkMessengerToken(env: WorkerEnv): Promise<{
  ok: boolean;
  required: boolean;
  configured: boolean;
  message?: string;
}> {
  const token = env.META_PAGE_ACCESS_TOKEN ?? '';
  if (!token) {
    return {
      ok: false,
      required: true,
      configured: false,
      message: 'META_PAGE_ACCESS_TOKEN is not configured',
    };
  }

  const baseUrl = (
    env.MESSENGER_GRAPH_API_BASE_URL || 'https://graph.facebook.com'
  ).replace(/\/$/, '');
  const pageId = env.META_PAGE_ID ?? '';
  const endpoint = new URL(`${baseUrl}/${pageId}/subscribed_apps`);
  endpoint.searchParams.set('access_token', token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await (env.MESSENGER_FETCH ?? fetch)(endpoint, {
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown[];
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (response.ok && Array.isArray(body.data))
      return { ok: true, required: true, configured: true };
    return {
      ok: false,
      required: true,
      configured: true,
      message:
        body.error?.message ??
        `Messenger token check failed with HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      configured: true,
      message:
        error instanceof Error ? error.message : 'Messenger token check failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}
