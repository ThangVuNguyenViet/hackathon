import { fetchCatalogObservation } from './catalog/catalogObservation.js';
import { D1LifecycleRepository, LifecycleError, SandboxLifecycleControls, lifecycleBinding } from './commerce/lifecycleProvider.js';
import { D1Store } from './persistence/d1Store.js';
import type { WorkerEnv } from './worker.js';

export function workerLifecycleOptions(env: WorkerEnv, store: D1Store) {
  if (env.KFC_COMMERCE_ENVIRONMENT !== "sandbox" || !env.KFC_MENU_API_URL) return undefined;
  const repository = new D1LifecycleRepository(env.DB);
  const controls = new SandboxLifecycleControls(repository);
  return {
    environment: "sandbox" as const,
    controls,
    async createInput(sessionId: string) {
      const observation = await fetchCatalogObservation({
        environment: "sandbox",
        sourceUrl: env.KFC_MENU_API_URL!,
        fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : 300,
      });
      await store.appendEvent(sessionId, "catalog_observation_pinned", { observation });
      const customerBinding = await workerBindingHash(`customer:${sessionId.startsWith("kfc:") ? sessionId.slice(4) : sessionId}`);
      const sessionBinding = await workerBindingHash(`session:${sessionId}`);
      const logicalTime = Date.now();
      return {
        environment: "sandbox" as const,
        scenarioDefinitionVersion: "kfc-genui-proof-v1",
        releaseId: env.RELEASE_GIT_SHA ?? "unknown",
        catalogObservationId: observation.id,
        catalogHash: observation.sha256,
        customerBinding,
        sessionBinding,
        paymentPolicy: "prepaid" as const,
        fulfillmentPolicy: "delivery" as const,
        logicalTime,
        expiresAt: logicalTime + 60 * 60 * 1000,
      };
    },
    async binding(instanceId: string) {
      const instance = await repository.get("sandbox", instanceId);
      if (!instance) throw new LifecycleError("not_found", "Lifecycle instance not found");
      return lifecycleBinding(instance);
    },
    async activeForSession(sessionId: string) {
      const sessionBinding = await workerBindingHash(`session:${sessionId}`);
      const active = await repository.activeBySessionBinding("sandbox", sessionBinding);
      if (active.length > 1) throw new LifecycleError("conflict", "Session has multiple active lifecycle instances");
      return active[0] ? controls.get(lifecycleBinding(active[0])) : null;
    },
    async proofForSession(sessionId: string) {
      const sessionBinding = await workerBindingHash(`session:${sessionId}`);
      const active = await repository.activeBySessionBinding("sandbox", sessionBinding);
      if (active.length > 1) throw new LifecycleError("conflict", "Session has multiple active lifecycle instances");
      const instance = active[0] ? await controls.get(lifecycleBinding(active[0])) : null;
      const rows = await env.DB.prepare(
        `SELECT revision, event_id, event_type, outcome, prior_revision, created_at
         FROM commerce_lifecycle_events WHERE session_binding = ? ORDER BY revision ASC, created_at ASC, event_id ASC`,
      ).bind(sessionBinding).all<{ revision: number; event_id: string; event_type: string; outcome: string; prior_revision: number | null; created_at: string }>();
      return {
        instance,
        audit: (rows.results ?? []).map((row) => ({ revision: Number(row.revision), eventId: row.event_id, eventType: row.event_type, outcome: row.outcome, priorRevision: row.prior_revision === null ? null : Number(row.prior_revision), createdAt: row.created_at })),
      };
    },
  };
}

export function workerSessionResetHook(env: WorkerEnv) {
  if (env.KFC_COMMERCE_ENVIRONMENT !== "sandbox") return undefined;
  return async (sessionId: string) => {
    const repository = new D1LifecycleRepository(env.DB);
    const controls = new SandboxLifecycleControls(repository);
    const sessionBinding = await workerBindingHash(`session:${sessionId}`);
    for (const instance of await repository.activeBySessionBinding("sandbox", sessionBinding)) {
      await controls.seal(lifecycleBinding(instance), {
        expectedRevision: instance.revision,
        idempotencyKey: `session-reset:${sessionId}:${instance.instanceId}:${instance.revision}`,
        requestFingerprint: await workerBindingHash(`session-reset:${sessionId}:${instance.instanceId}:${instance.revision}`),
        actor: "session-reset",
      });
    }
  };
}

export async function workerBindingHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
