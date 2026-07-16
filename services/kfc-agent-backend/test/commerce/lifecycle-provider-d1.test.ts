import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import {
  D1LifecycleRepository,
  InjectedLifecycleFault,
  LifecycleService,
  lifecycleBinding,
  SandboxLifecycleControls,
  type MutationContext,
} from "../../src/commerce/lifecycleProvider.js";

const context = (revision: number, key: string): MutationContext => ({
  expectedRevision: revision,
  idempotencyKey: key,
  requestFingerprint: key,
  traceId: "trace-d1",
  runId: "run-d1",
  requestId: `request-${key}`,
  actor: "d1-test",
});

const instances: Miniflare[] = [];

async function fixture() {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "lifecycle-test" } });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  await db.batch(readFileSync("migrations/0008_commerce_lifecycle.sql", "utf8").split(";").map((sql) => sql.trim()).filter(Boolean).map((sql) => db.prepare(sql)));
  const repository = new D1LifecycleRepository(db);
  const controls = new SandboxLifecycleControls(repository);
  const service = new LifecycleService(repository);
  const instance = await controls.create({
    instanceId: "d1-instance",
    environment: "sandbox",
    scenarioDefinitionVersion: "scenario-v1",
    releaseId: "release-1",
    catalogObservationId: "catalog-1",
    catalogHash: "sha256:catalog",
    customerBinding: "customer-1",
    sessionBinding: "session-1",
    paymentPolicy: "prepaid",
    fulfillmentPolicy: "delivery",
    logicalTime: 1_000,
    expiresAt: 10_000,
  });
  return { db, repository, controls, service, instance };
}

afterEach(async () => Promise.all(instances.splice(0).map((instance) => instance.dispose())));

describe("D1 commerce lifecycle repository", () => {
  it("finds only active session-bound instances for reset sealing", async () => {
    const { repository, controls, instance } = await fixture();
    expect(await repository.activeBySessionBinding("sandbox", instance.sessionBinding)).toEqual([instance]);
    await controls.seal(lifecycleBinding(instance), context(0, "session-reset"));
    expect(await repository.activeBySessionBinding("sandbox", instance.sessionBinding)).toEqual([]);
  });

  it("has one winner for concurrent transitions and atomic idempotent resets", async () => {
    const { db, controls, instance } = await fixture();
    const binding = lifecycleBinding(instance);
    const transitions = await Promise.allSettled([
      controls.transition(binding, { type: "order_accepted" }, context(0, "accept")),
      controls.transition(binding, { type: "order_rejected" }, context(0, "reject")),
    ]);
    expect(transitions.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const current = await controls.get(binding);
    const resets = await Promise.allSettled([
      controls.reset(binding, context(current.revision, "reset-a"), "replacement-a"),
      controls.reset(binding, context(current.revision, "reset-b"), "replacement-b"),
    ]);
    expect(resets.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const replacement = resets.find((result) => result.status === "fulfilled");
    if (!replacement || replacement.status !== "fulfilled") throw new Error("reset winner missing");
    expect(await controls.reset(binding, context(current.revision, replacement.value.instanceId === "replacement-a" ? "reset-a" : "reset-b"), "ignored")).toEqual(replacement.value);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM commerce_lifecycle_instances WHERE reset_from = ?").bind(instance.instanceId).first<{ count: number }>())?.count).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM commerce_lifecycle_events").first<{ count: number }>())?.count).toBeGreaterThanOrEqual(4);
  });

  it("claims configured one-shot faults atomically and replays the same failure", async () => {
    const { controls, service, instance } = await fixture();
    const binding = lifecycleBinding(instance);
    const configured = await controls.configureFault(binding, { operation: "order_accepted", occurrence: 1, type: "timeout", phase: "before_commit", oneShot: true }, context(0, "configure"));
    const attempts = await Promise.allSettled([
      controls.transition(binding, { type: "order_accepted" }, context(configured.revision, "fault")),
      controls.transition(binding, { type: "order_accepted" }, context(configured.revision, "fault")),
    ]);
    expect(attempts).toHaveLength(2);
    for (const result of attempts) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({ committed: false });
    }
    expect((await service.get(binding)).revision).toBe(configured.revision);
    await expect(controls.transition(binding, { type: "order_accepted" }, context(configured.revision, "retry"))).resolves.toMatchObject({ state: { order: { status: "accepted" } } });
    await expect(controls.transition(binding, { type: "order_accepted" }, context(configured.revision, "fault"))).rejects.toBeInstanceOf(InjectedLifecycleFault);
  });

  it("replays concurrent identical controls and rejects invalid fault rules at both boundaries", async () => {
    const { db, controls, instance } = await fixture();
    const binding = lifecycleBinding(instance);
    const rule = { operation: "order_accepted", occurrence: 1, type: "timeout", phase: "before_commit", oneShot: true } as const;
    const configured = await Promise.all([
      controls.configureFault(binding, rule, context(0, "same-config")),
      controls.configureFault(binding, rule, context(0, "same-config")),
    ]);
    expect(configured[0]).toEqual(configured[1]);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM commerce_lifecycle_faults").first<{ count: number }>())?.count).toBe(1);

    for (const invalid of [
      { ...rule, operation: "not_an_operation" },
      { ...rule, type: "not_a_fault" },
      { ...rule, phase: "not_a_phase" },
      { ...rule, oneShot: 1 },
    ]) {
      await expect(controls.configureFault(binding, invalid as never, context(configured[0].revision, `invalid-${String(Object.values(invalid).find((value) => String(value).startsWith("not_")) ?? "boolean")}`))).rejects.toMatchObject({ code: "conflict" });
    }

    await expect(db.prepare(`INSERT INTO commerce_lifecycle_faults (instance_id, operation, occurrence, fault_type, phase, one_shot, configured_revision, base_occurrence, consumed_at, created_at) VALUES (?, 'invalid', 1, 'timeout', 'before_commit', 1, 2, 0, NULL, ?)`)
      .bind(instance.instanceId, new Date().toISOString()).run()).rejects.toThrow();
  });
});
