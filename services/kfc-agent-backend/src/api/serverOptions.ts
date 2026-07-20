import type { BuildServerOptions } from "./server.js";
import { z } from 'zod';
import type { AppEnv } from "../config/env.js";
import {
  createConfirmationApprovalKeyRing,
} from './confirmationApprovalCapability.js';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
  resolveResponseVerifierModelProfile,
} from "../config/agentModelProfile.js";
import {
  createMonitorChatModel,
  resolveMonitorModelProfile,
} from "../config/monitorModelProfile.js";
import { ModelMonitorJudge } from "../llm/monitorJudge.js";
import { createKfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import { createHttpPosClient } from "../commerce/httpPosClient.js";
import { createOmsWithPos } from "../commerce/omsWithPos.js";
import { LangSmithAgentTracer } from "../observability/langsmithAgentTracer.js";
import { LangSmithShowcaseScenarioSource } from "../showcase/showcase.js";

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

const previousConfirmationSigningKeysSchema = z.array(z.object({
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
  secret: z.string().min(32),
}).strict()).max(4);

function confirmationApprovalKeyRing(
  env: ServerOptionsEnv,
) {
  const secret = optionalValue(env.KFC_CONFIRMATION_SIGNING_SECRET);
  const rawPrevious = optionalValue(
    env.KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS,
  );
  if (!secret) {
    if (rawPrevious) {
      throw new Error(
        'KFC_CONFIRMATION_SIGNING_SECRET is required when previous confirmation keys are configured',
      );
    }
    return undefined;
  }
  let previous: z.infer<
    typeof previousConfirmationSigningKeysSchema
  > = [];
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
      throw new Error(
        'KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS is invalid',
      );
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
type ServerOptionsEnv = Omit<AppEnv, "KFC_AGENT_PROFILE_MODE"> &
  Partial<Pick<AppEnv, "KFC_AGENT_PROFILE_MODE">>;

export function buildServerOptionsFromEnv(
  env: ServerOptionsEnv,
): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const googleApiKey = optionalValue(env.GOOGLE_API_KEY);
  const agentIdentity = resolveAgentModelProfile({
    provider: env.KFC_AGENT_PROVIDER,
    model: optionalValue(env.KFC_AGENT_MODEL),
    mode: env.KFC_AGENT_PROFILE_MODE,
  });
  const responseVerifierIdentity = resolveResponseVerifierModelProfile({
    agentProvider: agentIdentity.provider,
    provider: env.KFC_RESPONSE_VERIFIER_PROVIDER,
    model: optionalValue(env.KFC_RESPONSE_VERIFIER_MODEL),
    mode: env.KFC_AGENT_PROFILE_MODE,
  });
  const monitorIdentity = resolveMonitorModelProfile({
    agentProvider: agentIdentity.provider,
    provider: env.KFC_MONITOR_PROVIDER,
    model: optionalValue(env.KFC_MONITOR_MODEL),
  });
  const agentConfigured = agentIdentity.provider === "openai"
    ? Boolean(openAiApiKey)
    : Boolean(googleApiKey);
  const agent = agentConfigured
    ? {
        identity: agentIdentity,
        model: createAgentChatModel({
          profile: agentIdentity,
          openAiApiKey,
          openAiBaseUrl,
          googleApiKey,
        }),
      }
    : undefined;
  const responseVerifier = responseVerifierIdentity
    ? {
        identity: responseVerifierIdentity,
        model: createAgentChatModel({
          profile: responseVerifierIdentity,
          openAiApiKey,
          openAiBaseUrl,
          googleApiKey,
          role: 'response_verifier',
        }),
      }
    : undefined;
  const monitorConfigured = monitorIdentity.provider === "openai"
    ? Boolean(openAiApiKey)
    : Boolean(googleApiKey);
  const monitorExplicitlyConfigured =
    env.KFC_MONITOR_PROVIDER !== undefined ||
    optionalValue(env.KFC_MONITOR_MODEL) !== undefined;
  if (monitorExplicitlyConfigured && !monitorConfigured) {
    throw new Error(
      `${monitorIdentity.provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY"} is required for the explicitly configured KFC monitor provider`,
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
  if (
    env.KFC_COMMERCE_MODE === "gateway" &&
    (!commerceBaseUrl || !commerceToken || !menuApiUrl || !env.KFC_COMMERCE_ENVIRONMENT)
  ) {
    throw new Error(
      "KFC_COMMERCE_GATEWAY_BASE_URL, KFC_COMMERCE_GATEWAY_TOKEN, KFC_MENU_API_URL, and KFC_COMMERCE_ENVIRONMENT are required in gateway mode",
    );
  }
  const commerceGateway =
    env.KFC_COMMERCE_MODE === "gateway" && commerceBaseUrl && commerceToken
      ? createKfcCommerceGatewayClients({
          baseUrl: commerceBaseUrl,
          token: commerceToken,
        })
      : undefined;
  const posClient =
    env.KFC_POS_MODE === "http" && posBaseUrl && posToken
      ? createHttpPosClient({ baseUrl: posBaseUrl, token: posToken })
      : undefined;
  return {
    demoAdminToken: optionalValue(env.KFC_DEMO_ADMIN_TOKEN),
    messengerVerifyToken: optionalValue(env.MESSENGER_VERIFY_TOKEN),
    metaAppSecret: optionalValue(env.META_APP_SECRET),
    metaPageId: optionalValue(env.META_PAGE_ID),
    messengerPageAccessToken: optionalValue(env.META_PAGE_ACCESS_TOKEN),
    metaInboxUrlTemplate: optionalValue(env.META_INBOX_URL_TEMPLATE),
    messengerGraphApiBaseUrl: optionalValue(env.MESSENGER_GRAPH_API_BASE_URL),
    zaloOaId: optionalValue(env.ZALO_OA_ID),
    zaloAccessToken: optionalValue(env.ZALO_ACCESS_TOKEN),
    zaloInboxUrlTemplate: optionalValue(env.ZALO_INBOX_URL_TEMPLATE),
    zaloApiBaseUrl: optionalValue(env.ZALO_API_BASE_URL),
    confirmationApprovalKeyRing: confirmationApprovalKeyRing(env),
    agent,
    responseVerifier,
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
          releaseSha: env.RELEASE_GIT_SHA.trim() || "unknown",
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
    catalog: env.KFC_COMMERCE_MODE === "gateway" && menuApiUrl && env.KFC_COMMERCE_ENVIRONMENT
      ? {
          sourceUrl: menuApiUrl,
          environment: env.KFC_COMMERCE_ENVIRONMENT,
          fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ?? 300,
        }
      : undefined,
    readiness: {
      agentConfigured,
      responseVerifierConfigured: responseVerifier !== undefined,
      monitorConfigured: monitorJudge !== undefined,
      release: {
        gitSha: env.RELEASE_GIT_SHA.trim() || "unknown",
        deploymentId: env.RELEASE_DEPLOYMENT_ID.trim() || "unknown",
        builtAt: env.RELEASE_BUILT_AT || "unknown",
        dirty: env.RELEASE_DIRTY !== "false",
      },
      runtime: {
        agentProfileMode: env.KFC_AGENT_PROFILE_MODE ?? 'production',
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT,
        agent: agentIdentity,
        responseVerifier: responseVerifierIdentity,
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
        requiredCapabilities: [
          "orders",
          "payment",
          "handoff_resolution",
        ],
        implementedCapabilities: [
          "orders",
          "payment",
        ],
      },
      pos: {
        mode: env.KFC_POS_MODE,
        baseUrl: posBaseUrl,
        token: posToken,
      },
    },
  };
}
