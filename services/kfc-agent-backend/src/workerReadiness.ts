import { fetchCatalogObservation } from './catalog/catalogObservation.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import type { WorkerEnv } from './worker.js';

export async function checkWorkerReadiness(
  env: WorkerEnv,
  deep: boolean,
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
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
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
    await env.DB.prepare("SELECT 1").first();
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
    configured: Boolean(env.OPENAI_API_KEY),
  };
  const configuredSamplingRate = Number(
    env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1",
  );
  const observability = {
    ok: true,
    langsmith: {
      configured: Boolean(
        env.LANGSMITH_API_KEY &&
          env.LANGSMITH_PROJECT &&
          env.LANGSMITH_ENDPOINT,
      ),
      project: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      endpoint:
        env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      samplingRate: Number.isFinite(configuredSamplingRate)
        ? configuredSamplingRate
        : 1,
    },
  };
  const checks: Record<
    string,
    {
      ok: boolean;
      required?: boolean;
      configured?: boolean;
      message?: string;
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
    }
  > = {
    database,
    fixtures,
    messenger,
    zalo,
    openai,
    observability,
  };
  if (deep) {
    checks.messengerToken = await checkMessengerToken(env);
  }
  let catalogObservation: Awaited<ReturnType<typeof fetchCatalogObservation>> | undefined;
  if (env.KFC_COMMERCE_MODE === "gateway" || !env.KFC_COMMERCE_MODE) {
    checks.commerceGateway = await checkWorkerCommerceGateway(env, deep);
    const catalogCheck = await runWorkerReadinessCheck(async () => {
      if (!env.KFC_COMMERCE_ENVIRONMENT || !env.KFC_MENU_API_URL) {
        return { ok: false, configured: false, message: "Missing KFC_COMMERCE_ENVIRONMENT or KFC_MENU_API_URL" };
      }
      if (!deep) return { ok: true, configured: true };
      catalogObservation = await fetchCatalogObservation({
        environment: env.KFC_COMMERCE_ENVIRONMENT,
        sourceUrl: env.KFC_MENU_API_URL,
        fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : 300,
      });
      return { ok: catalogObservation.itemCount > 0, configured: true };
    });
    checks.catalog = catalogCheck;
  }
  if (deep) {
    checks.graphCheckpoint = await runWorkerReadinessCheck(async () => {
      await env.DB.prepare("SELECT checkpoint_id FROM langgraph_checkpoints LIMIT 1").first();
      return { ok: true, configured: true };
    });
    checks.lifecycle = env.KFC_COMMERCE_ENVIRONMENT === "sandbox"
      ? await runWorkerReadinessCheck(async () => {
          await env.DB.prepare("SELECT instance_id FROM commerce_lifecycle_instances LIMIT 1").first();
          return { ok: true, configured: true };
        })
      : { ok: true, configured: false, message: "Lifecycle proof controls are not registered in production" };
  }
  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "kfc-agent-backend",
    checks,
    release: {
      gitSha: env.RELEASE_GIT_SHA ?? "unknown",
      deploymentId: env.RELEASE_DEPLOYMENT_ID ?? "unknown",
      releaseBuiltAt: env.RELEASE_BUILT_AT ?? "unknown",
      dirty: env.RELEASE_DIRTY !== "false",
    },
    ...(deep ? {
      proof: {
        deployment: { gitSha: env.RELEASE_GIT_SHA ?? "unknown", deploymentId: env.RELEASE_DEPLOYMENT_ID ?? "unknown", builtAt: env.RELEASE_BUILT_AT ?? "unknown", dirty: env.RELEASE_DIRTY !== "false" },
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT ?? null,
        providerFingerprint: catalogObservation?.providerFingerprint ?? null,
        catalogObservation: catalogObservation ? {
          id: catalogObservation.id,
          sha256: catalogObservation.sha256,
          observedAt: catalogObservation.observedAt,
          expiresAt: catalogObservation.expiresAt ?? null,
          itemCount: catalogObservation.itemCount,
          modifierTreeCount: catalogObservation.modifierTreeCount,
        } : null,
        lifecycle: { provider: env.KFC_COMMERCE_ENVIRONMENT === "sandbox" ? "d1" : null, controlsRegistered: env.KFC_COMMERCE_ENVIRONMENT === "sandbox" },
        graph: { runtime: "langgraph-stategraph-v1", checkpoint: "d1-v1" },
        versions: {
          plannerModel: env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1-mini",
          responseModel: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
          prompt: "tool-planner-v1",
          toolCatalog: "typed-commerce-tools-v1",
          ranker: "deterministic-safety-rerank-v1",
          ledger: "kfc-scenario-ledger-v1",
        },
      },
    } : {}),
    timestamp: new Date().toISOString(),
  };
}

export async function checkWorkerCommerceGateway(env: WorkerEnv, deep: boolean) {
  const baseUrl = env.KFC_COMMERCE_GATEWAY_BASE_URL;
  const token = env.KFC_COMMERCE_GATEWAY_TOKEN;
  const environment = env.KFC_COMMERCE_ENVIRONMENT;
  if (!baseUrl || !token || !environment) {
    return { ok: false, configured: false, message: "Missing commerce gateway configuration" };
  }
  if (!deep) return { ok: true, configured: true };
  return runWorkerReadinessCheck(async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json() as { ok?: boolean; capabilities?: unknown[] };
    const capabilities = new Set((payload.capabilities ?? []).filter((value): value is string => typeof value === "string"));
    const missing = ["orders", "payment"].filter((capability) => !capabilities.has(capability));
    return { ok: response.ok && payload.ok === true && missing.length === 0, configured: true, message: missing.length ? `Missing gateway capabilities: ${missing.join(", ")}` : undefined };
  });
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
        error instanceof Error ? error.message : "Readiness check failed",
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
    !env.MESSENGER_VERIFY_TOKEN ? "MESSENGER_VERIFY_TOKEN" : undefined,
    !env.META_PAGE_ID ? "META_PAGE_ID" : undefined,
    !env.META_APP_SECRET ? "META_APP_SECRET" : undefined,
    !env.META_PAGE_ACCESS_TOKEN ? "META_PAGE_ACCESS_TOKEN" : undefined,
    !env.META_INBOX_URL_TEMPLATE ? "META_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured,
    required: true,
    configured,
    message: configured ? undefined : `Missing ${missing.join(", ")}`,
  };
}

export function checkWorkerZaloConfig(env: WorkerEnv): {
  ok: boolean;
  required: false;
  configured: boolean;
  message?: string;
} {
  const missing = [
    !env.ZALO_OA_ID ? "ZALO_OA_ID" : undefined,
    !env.ZALO_ACCESS_TOKEN ? "ZALO_ACCESS_TOKEN" : undefined,
    !env.ZALO_INBOX_URL_TEMPLATE ? "ZALO_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: true,
    required: false,
    configured,
    message: configured ? undefined : `Missing ${missing.join(", ")}`,
  };
}

export async function checkMessengerToken(env: WorkerEnv): Promise<{
  ok: boolean;
  required: boolean;
  configured: boolean;
  message?: string;
}> {
  const token = env.META_PAGE_ACCESS_TOKEN ?? "";
  if (!token) {
    return {
      ok: false,
      required: true,
      configured: false,
      message: "META_PAGE_ACCESS_TOKEN is not configured",
    };
  }

  const baseUrl = (
    env.MESSENGER_GRAPH_API_BASE_URL || "https://graph.facebook.com"
  ).replace(/\/$/, "");
  const pageId = env.META_PAGE_ID ?? "";
  const endpoint = new URL(`${baseUrl}/${pageId}/subscribed_apps`);
  endpoint.searchParams.set("access_token", token);

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
        error instanceof Error ? error.message : "Messenger token check failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
