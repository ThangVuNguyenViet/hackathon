import type { BuildServerOptions } from './server.js';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import { createConfiguredPvcfcPublicDataProvider } from '../businesses/pvcfc/public-data/configuredPvcfcPublicDataProvider.js';
import { createConfirmationApprovalKeyRing } from './confirmationApprovalCapability.js';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
} from '../config/agentModelProfile.js';
import {
  createMonitorChatModel,
  resolveMonitorModelProfile,
} from '../config/monitorModelProfile.js';
import { ModelMonitorJudge } from '../llm/monitorJudge.js';
import { createKfcCommerceGatewayClients } from '../clients/kfcCommerceGateway.js';
import { createHttpPosClient } from '../commerce/httpPosClient.js';
import { createOmsWithPos } from '../commerce/omsWithPos.js';
import { LangSmithAgentTracer } from '../observability/langsmithAgentTracer.js';
import { LangSmithShowcaseScenarioSource } from '../showcase/showcase.js';
import { createOtelRuntimeProbe } from '../observability/runtimeProbe.js';
import { createTinyFishClient } from '../web/tinyFishClient.js';

const WEB_EVIDENCE_CLIENT_TIMEOUT_MS = 4_000;

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

const previousConfirmationSigningKeysSchema = z
  .array(
    z
      .object({
        keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
        secret: z.string().min(32),
      })
      .strict(),
  )
  .max(4);

function confirmationApprovalKeyRing(env: ServerOptionsEnv) {
  const secret = optionalValue(env.KFC_CONFIRMATION_SIGNING_SECRET);
  const rawPrevious = optionalValue(env.KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS);
  if (!secret) {
    if (rawPrevious) {
      throw new Error(
        'KFC_CONFIRMATION_SIGNING_SECRET is required when previous confirmation keys are configured',
      );
    }
    return undefined;
  }
  let previous: z.infer<typeof previousConfirmationSigningKeysSchema> = [];
  if (rawPrevious) {
    let raw: unknown;
    try {
      raw = JSON.parse(rawPrevious) as unknown;
    } catch {
      throw new Error(
        'KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS must be valid JSON',
      );
    }
    const parsed = previousConfirmationSigningKeysSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS is invalid');
    }
    previous = parsed.data;
  }
  return createConfirmationApprovalKeyRing({
    active: {
      keyId: env.KFC_CONFIRMATION_SIGNING_KEY_ID,
      secret,
    },
    previous,
  });
}

// Older callers may omit the switch; an absent mode always takes the
// resolver's production-only default.
type NodeOptionalKey =
  | 'HOST'
  | 'ZALO_OA_SECRET'
  | 'ZALO_TOKEN_ENCRYPTION_KEY'
  | 'ZALO_SETUP_TOKEN'
  | 'ZALO_PUBLIC_BASE_URL'
  | 'ZALO_OAUTH_BASE_URL';
type ServerOptionsEnv = Omit<
  AppEnv,
  'KFC_AGENT_PROFILE_MODE' | NodeOptionalKey
> &
  Partial<Pick<AppEnv, 'KFC_AGENT_PROFILE_MODE' | NodeOptionalKey>> & {
    PVCFC_ASTRAFLOW_API_KEY?: string;
    PVCFC_ASTRAFLOW_BASE_URL?: string;
    PVCFC_ASTRAFLOW_MODEL?: string;
    PVCFC_PUBLIC_DATA_MODE?: 'fixture' | 'api';
  };

export function buildServerOptionsFromEnv(
  env: ServerOptionsEnv,
  dependencies: {
    tinyFishClientFactory?: typeof createTinyFishClient;
  } = {},
): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const pvcfcAstraFlowApiKey = optionalValue(env.PVCFC_ASTRAFLOW_API_KEY);
  const pvcfcPublicDataProvider = createConfiguredPvcfcPublicDataProvider({
    enabled:
      pvcfcAstraFlowApiKey !== undefined ||
      env.PVCFC_PUBLIC_DATA_MODE !== undefined,
    mode: env.PVCFC_PUBLIC_DATA_MODE,
  });
  const pvcfcAgentModel = pvcfcAstraFlowApiKey
    ? new ChatOpenAI({
        apiKey: pvcfcAstraFlowApiKey,
        model: env.PVCFC_ASTRAFLOW_MODEL,
        maxRetries: 0,
        supportsStrictToolCalling: true,
        configuration: {
          baseURL: env.PVCFC_ASTRAFLOW_BASE_URL,
        },
      })
    : undefined;
  const tinyFishApiKey = optionalValue(env.TINYFISH_API_KEY);
  const webEvidenceClient = tinyFishApiKey
    ? (dependencies.tinyFishClientFactory ?? createTinyFishClient)({
        apiKey: tinyFishApiKey,
        timeoutMs: WEB_EVIDENCE_CLIENT_TIMEOUT_MS,
      })
    : undefined;
  const googleApiKey = optionalValue(env.GOOGLE_API_KEY);
  const agentIdentity = resolveAgentModelProfile({
    provider: env.KFC_AGENT_PROVIDER,
    model: optionalValue(env.KFC_AGENT_MODEL),
    mode: env.KFC_AGENT_PROFILE_MODE,
  });
  const monitorIdentity = resolveMonitorModelProfile({
    agentProvider: agentIdentity.provider,
    provider: env.KFC_MONITOR_PROVIDER,
    model: optionalValue(env.KFC_MONITOR_MODEL),
  });
  const agentConfigured =
    agentIdentity.provider === 'openai'
      ? Boolean(openAiApiKey)
      : Boolean(googleApiKey);
  const monitorConfigured =
    monitorIdentity.provider === 'openai'
      ? Boolean(openAiApiKey)
      : Boolean(googleApiKey);
  const monitorExplicitlyConfigured =
    env.KFC_MONITOR_PROVIDER !== undefined ||
    optionalValue(env.KFC_MONITOR_MODEL) !== undefined;
  if (monitorExplicitlyConfigured && !monitorConfigured) {
    throw new Error(
      `${monitorIdentity.provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY'} is required for the explicitly configured KFC monitor provider`,
    );
  }
  const monitorJudge = monitorConfigured
    ? new ModelMonitorJudge({
        identity: monitorIdentity,
        model: createMonitorChatModel({
          profile: monitorIdentity,
          openAiApiKey,
          openAiBaseUrl,
          googleApiKey,
        }),
      })
    : undefined;
  const langsmithApiKey = optionalValue(env.LANGSMITH_API_KEY);
  const commerceBaseUrl = optionalValue(env.KFC_COMMERCE_GATEWAY_BASE_URL);
  const commerceToken = optionalValue(env.KFC_COMMERCE_GATEWAY_TOKEN);
  const menuApiUrl = optionalValue(env.KFC_MENU_API_URL);
  const posBaseUrl = optionalValue(env.KFC_POS_BASE_URL);
  const posToken = optionalValue(env.KFC_POS_TOKEN);
  const zaloOaId = optionalValue(env.ZALO_OA_ID);
  if (
    env.KFC_COMMERCE_MODE === 'gateway' &&
    (!commerceBaseUrl ||
      !commerceToken ||
      !menuApiUrl ||
      !env.KFC_COMMERCE_ENVIRONMENT)
  ) {
    throw new Error(
      'KFC_COMMERCE_GATEWAY_BASE_URL, KFC_COMMERCE_GATEWAY_TOKEN, KFC_MENU_API_URL, and KFC_COMMERCE_ENVIRONMENT are required in gateway mode',
    );
  }
  const commerceGateway =
    env.KFC_COMMERCE_MODE === 'gateway' && commerceBaseUrl && commerceToken
      ? createKfcCommerceGatewayClients({
          baseUrl: commerceBaseUrl,
          token: commerceToken,
        })
      : undefined;
  const posClient =
    env.KFC_POS_MODE === 'http' && posBaseUrl && posToken
      ? createHttpPosClient({ baseUrl: posBaseUrl, token: posToken })
      : undefined;
  return {
    ...(agentConfigured
      ? {
          agent: {
            identity: agentIdentity,
            model: createAgentChatModel({
              profile: agentIdentity,
              openAiApiKey,
              openAiBaseUrl,
              googleApiKey,
            }),
          },
        }
      : {}),
    ...(env.RELEASE_DIGEST && env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? {
          runtimeProbe: createOtelRuntimeProbe({
            endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
            releaseDigest: env.RELEASE_DIGEST,
          }),
        }
      : {}),
    demoAdminToken: optionalValue(env.KFC_DEMO_ADMIN_TOKEN),
    messengerVerifyToken: optionalValue(env.MESSENGER_VERIFY_TOKEN),
    metaAppSecret: optionalValue(env.META_APP_SECRET),
    metaPageId: optionalValue(env.META_PAGE_ID),
    messengerPageAccessToken: optionalValue(env.META_PAGE_ACCESS_TOKEN),
    metaInboxUrlTemplate: optionalValue(env.META_INBOX_URL_TEMPLATE),
    messengerGraphApiBaseUrl: optionalValue(env.MESSENGER_GRAPH_API_BASE_URL),
    zaloOaId,
    zaloAppId: optionalValue(env.ZALO_APP_ID),
    zaloWebhookSecret: optionalValue(env.ZALO_OA_SECRET),
    zaloSetupToken: optionalValue(env.ZALO_SETUP_TOKEN),
    zaloPublicBaseUrl: optionalValue(env.ZALO_PUBLIC_BASE_URL),
    zaloAccessToken: optionalValue(env.ZALO_ACCESS_TOKEN),
    zaloInboxUrlTemplate: optionalValue(env.ZALO_INBOX_URL_TEMPLATE),
    zaloApiBaseUrl: optionalValue(env.ZALO_API_BASE_URL),
    confirmationApprovalKeyRing: confirmationApprovalKeyRing(env),
    pvcfcPublicDataProvider,
    pvcfcAgentModel,
    pvcfcWebEvidenceClient: webEvidenceClient,
    kfcWebEvidenceClient: webEvidenceClient,
    monitorJudge,
    agentTracer: langsmithApiKey
      ? new LangSmithAgentTracer({
          projectName: env.LANGSMITH_PROJECT,
          apiKey: langsmithApiKey,
          apiUrl: env.LANGSMITH_ENDPOINT,
          samplingRate: env.LANGSMITH_TRACING_SAMPLING_RATE,
        })
      : undefined,
    showcase: langsmithApiKey
      ? {
          source: new LangSmithShowcaseScenarioSource({
            apiKey: langsmithApiKey,
            apiUrl: env.LANGSMITH_ENDPOINT,
            datasetName: env.KFC_SHOWCASE_DATASET,
            projectName: env.LANGSMITH_PROJECT,
          }),
          releaseSha: env.RELEASE_GIT_SHA.trim() || 'unknown',
          agent: agentIdentity,
        }
      : undefined,
    kfcCommerceGateway: commerceGateway
      ? {
          ...commerceGateway,
          oms: posClient
            ? createOmsWithPos({ oms: commerceGateway.oms, pos: posClient })
            : commerceGateway.oms,
        }
      : undefined,
    catalog:
      env.KFC_COMMERCE_MODE === 'gateway' &&
      menuApiUrl &&
      env.KFC_COMMERCE_ENVIRONMENT
        ? {
            sourceUrl: menuApiUrl,
            environment: env.KFC_COMMERCE_ENVIRONMENT,
            fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ?? 300,
          }
        : undefined,
    readiness: {
      agentConfigured,
      agentGatesReadiness: pvcfcAgentModel === undefined,
      monitorConfigured: monitorJudge !== undefined,
      webSearch: {
        configured: webEvidenceClient !== undefined,
        provider: 'tinyfish',
        mode: 'search-fetch',
      },
      release: {
        gitSha: env.RELEASE_GIT_SHA.trim() || 'unknown',
        deploymentId: env.RELEASE_DEPLOYMENT_ID.trim() || 'unknown',
        builtAt: env.RELEASE_BUILT_AT || 'unknown',
        dirty: env.RELEASE_DIRTY !== 'false',
      },
      runtime: {
        agentProfileMode: env.KFC_AGENT_PROFILE_MODE ?? 'production',
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT,
        agent: agentIdentity,
        monitor: monitorIdentity,
      },
      langsmith: {
        configured: Boolean(langsmithApiKey),
        project: env.LANGSMITH_PROJECT,
        endpoint: env.LANGSMITH_ENDPOINT,
        samplingRate: env.LANGSMITH_TRACING_SAMPLING_RATE,
      },
      commerce: {
        mode: env.KFC_COMMERCE_MODE,
        baseUrl: commerceBaseUrl,
        token: commerceToken,
        requiredCapabilities: ['orders', 'payment', 'handoff_resolution'],
        implementedCapabilities: ['orders', 'payment'],
      },
      pos: {
        mode: env.KFC_POS_MODE,
        baseUrl: posBaseUrl,
        token: posToken,
      },
    },
  };
}
