import type { BuildServerOptions } from "./server.js";
import type { AppEnv } from "../config/env.js";
import { OpenAIMonitorJudge } from "../llm/monitorJudge.js";
import { OpenAIResponseComposer } from "../llm/responseComposer.js";
import { OpenAISmallTalkRouter } from "../llm/smallTalkRouter.js";
import { OpenAIToolPlanner } from "../llm/toolPlanner.js";
import { createKfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import { createHttpPosClient } from "../commerce/httpPosClient.js";
import { createOmsWithPos } from "../commerce/omsWithPos.js";
import { LangSmithAgentTracer } from "../observability/langsmithAgentTracer.js";

function optionalValue(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function buildServerOptionsFromEnv(env: AppEnv): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const langsmithApiKey = optionalValue(env.LANGSMITH_API_KEY);
  const commerceBaseUrl = optionalValue(env.KFC_COMMERCE_GATEWAY_BASE_URL);
  const commerceToken = optionalValue(env.KFC_COMMERCE_GATEWAY_TOKEN);
  const posBaseUrl = optionalValue(env.KFC_POS_BASE_URL);
  const posToken = optionalValue(env.KFC_POS_TOKEN);
  const openAiDiagnosticContext = {
    workerRelease: optionalValue(env.OPENAI_DIAGNOSTIC_WORKER_RELEASE),
    executionColo: optionalValue(env.OPENAI_DIAGNOSTIC_EXECUTION_COLO),
    placement: optionalValue(env.OPENAI_DIAGNOSTIC_PLACEMENT),
  };
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
    responseComposer: openAiApiKey
      ? new OpenAIResponseComposer({
          apiKey: openAiApiKey,
          model: env.OPENAI_RESPONSE_MODEL,
          baseUrl: openAiBaseUrl,
          diagnosticContext: openAiDiagnosticContext,
        })
      : undefined,
    toolPlanner: openAiApiKey
      ? new OpenAIToolPlanner({
          apiKey: openAiApiKey,
          model: env.OPENAI_TOOL_PLANNER_MODEL,
          baseUrl: openAiBaseUrl,
          timeoutMs: env.OPENAI_TOOL_PLANNER_TIMEOUT_MS,
          diagnosticContext: openAiDiagnosticContext,
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
    agentTracer: langsmithApiKey
      ? new LangSmithAgentTracer({
          projectName: env.LANGSMITH_PROJECT,
          apiKey: langsmithApiKey,
          apiUrl: env.LANGSMITH_ENDPOINT,
          samplingRate: env.LANGSMITH_TRACING_SAMPLING_RATE,
        })
      : undefined,
    kfcCommerceGateway: commerceGateway
      ? {
          ...commerceGateway,
          oms: posClient
            ? createOmsWithPos({ oms: commerceGateway.oms, pos: posClient })
            : commerceGateway.oms,
        }
      : undefined,
    readiness: {
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
      },
      pos: {
        mode: env.KFC_POS_MODE,
        baseUrl: posBaseUrl,
        token: posToken,
      },
    },
  };
}
