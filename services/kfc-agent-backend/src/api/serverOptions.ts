import type { BuildServerOptions } from './server.js';
import type { AppEnv } from '../config/env.js';
import {
  createConfiguredAgentChatModel,
  liveAgentModelCandidateIds,
  resolveAgentModelProfile,
  type AgentModelCandidateId,
  type AgentModelIdentity,
  type AgentModelProfile,
} from '../config/agentModelProfile.js';
import {
  createMonitorChatModel,
  resolveMonitorModelProfile,
} from '../config/monitorModelProfile.js';
import { ModelMonitorJudge } from '../llm/monitorJudge.js';
import { LangSmithAgentTracer } from '../observability/langsmithAgentTracer.js';
import { LangSmithShowcaseScenarioSource } from '../showcase/showcase.js';
import { kfcRecommendationPackStateDefinition } from '../recommendations/application/context-factory.js';
import { createRecommendationInspectionService } from '../recommendations/application/inspection-service.js';
import { createBundledRecommendationApplicationService } from '../recommendations/application/recommendation-service.js';
import type { RecommendationRouteServicesFactory } from './routeHandlerContracts.js';

export const KFC_RECOMMENDATION_STORE_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function createBundledRecommendationRouteServicesFactory(
  storeTimezone = KFC_RECOMMENDATION_STORE_TIMEZONE,
): RecommendationRouteServicesFactory {
  return {
    create(store) {
      const persistence = store;
      return {
        application: createBundledRecommendationApplicationService({
          persistence,
          contextSource: {
            load: async () => ({ storeTimezone }),
          },
          clock: {
            now: () => new Date().toISOString(),
          },
        }),
        inspection: createRecommendationInspectionService({
          persistence,
          packState: kfcRecommendationPackStateDefinition,
        }),
      };
    },
  };
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function modelIdentity(profile: AgentModelProfile): AgentModelIdentity {
  return {
    candidateId: profile.candidateId,
    provider: profile.provider,
    model: profile.model,
    profile: profile.profile,
    transport: profile.transport,
  };
}

export function buildServerOptionsFromEnv(env: AppEnv): BuildServerOptions {
  const openAiApiKey = optionalValue(env.OPENAI_API_KEY);
  const openAiBaseUrl = optionalValue(env.OPENAI_BASE_URL);
  const openCodeApiKey = optionalValue(env.OPENCODE_API_KEY);
  const googleApiKey = optionalValue(env.GOOGLE_API_KEY);
  const agentIdentity = resolveAgentModelProfile({
    candidateId: env.KFC_AGENT_CANDIDATE,
  });
  const monitorIdentity = resolveMonitorModelProfile({
    agentCandidateId: agentIdentity.candidateId,
    candidateId: env.KFC_MONITOR_CANDIDATE,
  });
  const configuredCredentials = {
    OPENAI_API_KEY: Boolean(openAiApiKey),
    OPENCODE_API_KEY: Boolean(openCodeApiKey),
    GOOGLE_API_KEY: Boolean(googleApiKey),
  } as const;
  const agentCandidates = Object.freeze(
    Object.fromEntries(
      liveAgentModelCandidateIds.flatMap((candidateId) => {
        const profile = resolveAgentModelProfile({ candidateId });
        if (!configuredCredentials[profile.credentialEnv]) return [];
        return [
          [
            candidateId,
            createConfiguredAgentChatModel({
              profile,
              openAiApiKey,
              openAiBaseUrl,
              openCodeApiKey,
              googleApiKey,
            }),
          ],
        ];
      }),
    ) as Partial<
      Record<
        AgentModelCandidateId,
        ReturnType<typeof createConfiguredAgentChatModel>
      >
    >,
  );
  const agentConfigured = configuredCredentials[agentIdentity.credentialEnv];
  const agentBinding = agentConfigured
    ? createConfiguredAgentChatModel({
        profile: agentIdentity,
        openAiApiKey,
        openAiBaseUrl,
        openCodeApiKey,
        googleApiKey,
      })
    : undefined;
  const agentRuntimeIdentity =
    agentBinding?.identity ?? modelIdentity(agentIdentity);
  const monitorRuntimeIdentity = modelIdentity(monitorIdentity);
  const monitorConfigured =
    configuredCredentials[monitorIdentity.credentialEnv];
  const monitorExplicitlyConfigured = env.KFC_MONITOR_CANDIDATE !== undefined;
  if (monitorExplicitlyConfigured && !monitorConfigured) {
    throw new Error(
      `${monitorIdentity.credentialEnv} is required for the explicitly configured KFC monitor candidate`,
    );
  }
  const monitorJudge = monitorConfigured
    ? new ModelMonitorJudge({
        identity: monitorIdentity,
        model: createMonitorChatModel({
          profile: monitorIdentity,
          openAiApiKey,
          openAiBaseUrl,
          openCodeApiKey,
          googleApiKey,
        }),
      })
    : undefined;
  const langsmithApiKey = optionalValue(env.LANGSMITH_API_KEY);
  return {
    recommendations: createBundledRecommendationRouteServicesFactory(),
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
    agent: agentBinding,
    agentCandidates,
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
          agent: agentRuntimeIdentity,
        }
      : undefined,
    readiness: {
      agentConfigured,
      monitorConfigured: monitorJudge !== undefined,
      release: {
        gitSha: env.RELEASE_GIT_SHA.trim() || 'unknown',
        deploymentId: env.RELEASE_DEPLOYMENT_ID.trim() || 'unknown',
        builtAt: env.RELEASE_BUILT_AT || 'unknown',
        dirty: env.RELEASE_DIRTY !== 'false',
      },
      runtime: {
        agent: agentRuntimeIdentity,
        monitor: monitorRuntimeIdentity,
      },
      langsmith: {
        configured: Boolean(langsmithApiKey),
        project: env.LANGSMITH_PROJECT,
        endpoint: env.LANGSMITH_ENDPOINT,
        samplingRate: env.LANGSMITH_TRACING_SAMPLING_RATE,
      },
      commerce: {
        mode: 'fixture',
      },
    },
  };
}
