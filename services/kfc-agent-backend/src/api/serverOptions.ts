import type { BuildServerOptions } from "./server.js";
import type { AppEnv } from "../config/env.js";
import {
  createAgentChatModel,
  resolveAgentModelProfile,
} from "../config/agentModelProfile.js";
import { OpenAIMonitorJudge } from "../llm/monitorJudge.js";
import { OpenAIContentSemanticRanker } from "../llm/contentSemanticRanker.js";
import { createKfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import { createHttpPosClient } from "../commerce/httpPosClient.js";
import { createOmsWithPos } from "../commerce/omsWithPos.js";
import { LangSmithAgentTracer } from "../observability/langsmithAgentTracer.js";
import { LangSmithShowcaseScenarioSource } from "../showcase/showcase.js";

function optionalValue(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function buildServerOptionsFromEnv(env: AppEnv): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const googleApiKey = optionalValue(env.GOOGLE_API_KEY);
  const agentIdentity = resolveAgentModelProfile({
    provider: env.KFC_AGENT_PROVIDER,
    model: optionalValue(env.KFC_AGENT_MODEL),
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
  const langsmithApiKey = optionalValue(env.LANGSMITH_API_KEY);
  const commerceBaseUrl = optionalValue(env.KFC_COMMERCE_GATEWAY_BASE_URL);
  const commerceToken = optionalValue(env.KFC_COMMERCE_GATEWAY_TOKEN);
  const menuApiUrl = optionalValue(env.KFC_MENU_API_URL);
  const posBaseUrl = optionalValue(env.KFC_POS_BASE_URL);
  const posToken = optionalValue(env.KFC_POS_TOKEN);
  const openAiDiagnosticContext = {
    workerRelease: optionalValue(env.OPENAI_DIAGNOSTIC_WORKER_RELEASE),
    executionColo: optionalValue(env.OPENAI_DIAGNOSTIC_EXECUTION_COLO),
    edgeColo: optionalValue(env.OPENAI_DIAGNOSTIC_EDGE_COLO),
    placement: optionalValue(env.OPENAI_DIAGNOSTIC_PLACEMENT),
  };
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
    agent,
    monitorJudge: openAiApiKey
      ? new OpenAIMonitorJudge({
          apiKey: openAiApiKey,
          model: env.OPENAI_MONITOR_JUDGE_MODEL,
          baseUrl: openAiBaseUrl,
          diagnosticContext: openAiDiagnosticContext,
        })
      : undefined,
    mockClientOptions: openAiApiKey
      ? {
          contentSemanticRanker: new OpenAIContentSemanticRanker({
            apiKey: openAiApiKey,
            baseUrl: openAiBaseUrl,
            diagnosticContext: openAiDiagnosticContext,
          }),
        }
      : undefined,
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
      release: {
        gitSha: env.RELEASE_GIT_SHA.trim() || "unknown",
        deploymentId: env.RELEASE_DEPLOYMENT_ID.trim() || "unknown",
        builtAt: env.RELEASE_BUILT_AT || "unknown",
        dirty: env.RELEASE_DIRTY !== "false",
      },
      runtime: {
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT,
        agent: agentIdentity,
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
        requiredCapabilities: ["orders", "payment"],
      },
      pos: {
        mode: env.KFC_POS_MODE,
        baseUrl: posBaseUrl,
        token: posToken,
      },
    },
  };
}
