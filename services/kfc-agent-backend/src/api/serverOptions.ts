import type { BuildServerOptions } from "./server.js";
import type { AppEnv } from "../config/env.js";
import OpenAI from "openai";
import {
  OpenAiKfcAgent,
  type ResponsesClientLike,
} from "../agent/openAiKfcAgent.js";
import { OpenAIMonitorJudge } from "../llm/monitorJudge.js";
import {
  OpenAIContentSemanticRanker,
  type EmbeddingsClientLike,
} from "../llm/contentSemanticRanker.js";
import { OpenAIResponseComposer } from "../llm/responseComposer.js";
import { OpenAISmallTalkRouter } from "../llm/smallTalkRouter.js";
import { OpenAIToolPlanner } from "../llm/toolPlanner.js";
import { createVertexPlannerFetch } from "../llm/vertexPlannerTransport.js";
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
  const openAiClient = openAiApiKey
    ? new OpenAI({ apiKey: openAiApiKey, baseURL: openAiBaseUrl })
    : undefined;
  const plannerProvider = env.TOOL_PLANNER_PROVIDER;
  const plannerModel = optionalValue(env.TOOL_PLANNER_MODEL) ?? env.OPENAI_TOOL_PLANNER_MODEL;
  const plannerFastModel = optionalValue(env.TOOL_PLANNER_FAST_MODEL) ?? env.OPENAI_TOOL_PLANNER_FAST_MODEL;
  const plannerStatusModel = optionalValue(env.TOOL_PLANNER_STATUS_MODEL) ?? env.OPENAI_TOOL_PLANNER_STATUS_MODEL;
  const vertexServiceAccount = optionalValue(env.VERTEX_SERVICE_ACCOUNT_JSON);
  const plannerConfigured = plannerProvider === "vertex" ? Boolean(vertexServiceAccount) : Boolean(openAiApiKey);
  const plannerFetch = plannerProvider === "vertex" && vertexServiceAccount
    ? createVertexPlannerFetch({
        serviceAccountJson: vertexServiceAccount,
        model: plannerModel,
        location: env.VERTEX_LOCATION,
      })
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
    openAiAgent: openAiClient
      ? new OpenAiKfcAgent({
          client: openAiClient as unknown as ResponsesClientLike,
          model: env.OPENAI_MODEL,
        })
      : undefined,
    responseComposer: openAiApiKey
      ? new OpenAIResponseComposer({
          apiKey: openAiApiKey,
          model: env.OPENAI_RESPONSE_MODEL,
          baseUrl: openAiBaseUrl,
          diagnosticContext: openAiDiagnosticContext,
        })
      : undefined,
    toolPlanner: plannerConfigured
      ? new OpenAIToolPlanner({
          apiKey: openAiApiKey ?? "",
          model: plannerModel,
          fastModel: plannerFastModel,
          statusModel: plannerStatusModel,
          baseUrl: plannerProvider === "vertex" ? "https://vertex-planner.invalid/v1" : openAiBaseUrl,
          fetchImpl: plannerFetch,
          timeoutMs: env.OPENAI_TOOL_PLANNER_TIMEOUT_MS,
          diagnosticContext: { ...openAiDiagnosticContext, provider: plannerProvider },
        })
      : undefined,
    smallTalkRouter: openAiApiKey
      ? new OpenAISmallTalkRouter({
          apiKey: openAiApiKey,
          model: env.OPENAI_SMALL_TALK_ROUTER_MODEL,
          baseUrl: openAiBaseUrl,
          timeoutMs: env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS,
          diagnosticContext: openAiDiagnosticContext,
        })
      : undefined,
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
            client: openAiClient as unknown as EmbeddingsClientLike,
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
          plannerModel,
          responseModel: env.OPENAI_RESPONSE_MODEL,
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
      plannerConfigured,
      plannerProvider,
      release: {
        gitSha: env.RELEASE_GIT_SHA.trim() || "unknown",
        deploymentId: env.RELEASE_DEPLOYMENT_ID.trim() || "unknown",
        builtAt: env.RELEASE_BUILT_AT || "unknown",
        dirty: env.RELEASE_DIRTY !== "false",
      },
      runtime: {
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT,
        plannerProvider,
        plannerModel,
        responseModel: env.OPENAI_RESPONSE_MODEL,
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
