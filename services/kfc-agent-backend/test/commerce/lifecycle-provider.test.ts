import { describe, expect, it } from "vitest";
import {
  InjectedLifecycleFault,
  LifecycleError,
  LifecycleService,
  lifecycleBinding,
  MemoryLifecycleRepository,
  SandboxLifecycleControls,
  projectLifecycleCommerceClients,
  type LifecycleInstance,
  type MutationContext,
} from "../../src/commerce/lifecycleProvider.js";

const baseInput = {
  environment: "sandbox" as const,
  scenarioDefinitionVersion: "scenario-v1",
  releaseId: "release-1",
  catalogObservationId: "catalog-1",
  catalogHash: "sha256:catalog",
  customerBinding: "customer-1",
  sessionBinding: "session-1",
  paymentPolicy: "prepaid" as const,
  fulfillmentPolicy: "delivery" as const,
  logicalTime: 1_000,
  expiresAt: 10_000,
};

const context = (revision: number, key: string, fingerprint = key): MutationContext => ({
  expectedRevision: revision,
  idempotencyKey: key,
  requestFingerprint: fingerprint,
  traceId: "trace-1",
  runId: "run-1",
  requestId: "request-1",
});

async function fixture(instanceId = "instance-1") {
  const repository = new MemoryLifecycleRepository();
  const controls = new SandboxLifecycleControls(repository);
  const service = new LifecycleService(repository);
  const instance = await controls.create({ ...baseInput, instanceId });
  return { repository, controls, service, instance };
}

describe("commerce lifecycle provider", () => {
  it("runs valid payment, order and delivery transitions with atomic completion", async () => {
    const { controls, instance } = await fixture();
    let current = await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1", orderId: "order-1" }, context(0, "p1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "payment_paid" }, context(1, "p2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_accepted", orderId: "order-1" }, context(2, "o1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_preparing" }, context(3, "o2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_ready" }, context(4, "o3"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_pending", attemptId: "delivery-1" }, context(5, "d1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_assigned" }, context(6, "d2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_started" }, context(7, "d3"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_delivered" }, context(8, "d4"));

    expect(current.revision).toBe(9);
    expect(current.state.delivery?.status).toBe("delivered");
    expect(current.state.order?.status).toBe("completed");
  });

  it("projects lifecycle payment, order, and delivery state through customer commerce clients", async () => {
    const { controls, instance } = await fixture();
    let current = await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1", orderId: "order-1" }, context(0, "p1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "payment_paid" }, context(1, "p2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_accepted", orderId: "order-1" }, context(2, "o1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_preparing" }, context(3, "o2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "order_ready" }, context(4, "o3"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_pending", attemptId: "d1", orderId: "order-1" }, context(5, "d1"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_assigned" }, context(6, "d2"));
    current = await controls.transition(lifecycleBinding(instance), { type: "delivery_started" }, context(7, "d3"));
    const order = {
      id: "order-1", cart: { id: "cart-1", items: [], subtotalVnd: 0, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 0, voucherCode: null },
      status: "created" as const, paymentStatus: "pending" as const, assignedStoreId: "store-1", createdAt: "2026-07-15T00:00:00Z",
    };
    const clients = projectLifecycleCommerceClients({
      oms: {
        previewOrder: async () => ({ ok: true, value: order, message: "ok" }), placeOrder: async () => ({ ok: true, value: order, message: "ok" }),
        getOrderStatus: async () => ({ ok: true, value: order, message: "ok" }), cancelOrder: async () => ({ ok: true, value: order, message: "ok" }),
      },
      payment: {
        listMethods: async () => ({ ok: true, value: [], message: "ok" }), createPaymentLink: async () => ({ ok: true, value: { url: "https://pay.example", status: "pending" }, message: "ok" }),
        checkPaymentStatus: async () => ({ ok: true, value: { status: "pending" }, message: "ok" }),
      },
    }, current);

    await expect(clients.payment.checkPaymentStatus(order.id)).resolves.toMatchObject({ value: { status: "paid" } });
    await expect(clients.oms.getOrderStatus(order.id)).resolves.toMatchObject({ value: { status: "delivering", paymentStatus: "paid" } });
    await expect(clients.payment.checkPaymentStatus("another-order")).resolves.toMatchObject({ value: { status: "pending" } });
    await expect(clients.oms.getOrderStatus("another-order")).resolves.toMatchObject({ value: { id: "order-1", status: "created", paymentStatus: "pending" } });
  });

  it("rejects invalid transitions and preserves revision and event history", async () => {
    const { controls, repository, instance } = await fixture();

    await expect(controls.transition(lifecycleBinding(instance), { type: "order_ready" }, context(0, "bad")))
      .rejects.toMatchObject({ code: "conflict" });

    expect(repository.instances.get(instance.instanceId)?.revision).toBe(0);
    expect(repository.events).toHaveLength(1);
  });

  it("enforces payment and delivery cross-machine guards", async () => {
    const { controls, instance } = await fixture();
    await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1" }, context(0, "p1"));
    await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(1, "o1"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_preparing" }, context(2, "o2")))
      .rejects.toThrow("requires paid payment");
    await controls.transition(lifecycleBinding(instance), { type: "delivery_pending", attemptId: "d-1" }, context(2, "d1"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "delivery_assigned" }, context(3, "d2")))
      .rejects.toThrow("requires a ready order");
  });

  it("requires new attempt IDs when retrying terminal payment and delivery attempts", async () => {
    const { controls, instance } = await fixture();
    await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1" }, context(0, "p1"));
    await controls.transition(lifecycleBinding(instance), { type: "payment_failed" }, context(1, "p2"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1" }, context(2, "p3")))
      .rejects.toThrow("new attempt ID");
    const retried = await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-2" }, context(2, "p4"));
    expect(retried.state.payment).toEqual({ attemptId: "pay-2", status: "pending", orderId: null });
  });

  it("rejects lifecycle transitions bound to a different order", async () => {
    const { controls, instance } = await fixture();
    await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1", orderId: "order-1" }, context(0, "p1"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_accepted", orderId: "order-2" }, context(1, "o1")))
      .rejects.toThrow("binding mismatch");
  });

  it("isolates instance and environment bindings", async () => {
    const { controls, service, instance } = await fixture("sandbox-one");
    const other = await controls.create({ ...baseInput, instanceId: "sandbox-two", customerBinding: "customer-2" });
    await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(0, "one"));

    expect((await service.get(lifecycleBinding(other))).revision).toBe(0);
    await expect(service.get({ ...lifecycleBinding(instance), environment: "production" })).rejects.toMatchObject({ code: "not_found" });
    await expect(service.get({ ...lifecycleBinding(instance), customerBinding: "wrong" })).rejects.toMatchObject({ code: "not_found" });
    await expect(service.get({ ...lifecycleBinding(instance), releaseId: "wrong" })).rejects.toMatchObject({ code: "not_found" });
    await expect(service.get({ ...lifecycleBinding(instance), scenarioDefinitionVersion: "wrong" })).rejects.toMatchObject({ code: "not_found" });
    await expect(service.get({ ...lifecycleBinding(instance), catalogHash: "wrong" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns idempotent replay and rejects a changed fingerprint", async () => {
    const { controls, repository, instance } = await fixture();
    const first = await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(0, "same", "fp-1"));
    const replay = await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(0, "same", "fp-1"));

    expect(replay).toEqual(first);
    expect(repository.events).toHaveLength(2);
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_rejected" }, context(0, "same", "fp-2")))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("advances only a monotonic logical clock and expires deterministically", async () => {
    const { controls, instance } = await fixture();
    const advanced = await controls.advanceClock(lifecycleBinding(instance), 10_000, context(0, "clock"));
    expect(advanced.logicalTime).toBe(10_000);
    await expect(controls.advanceClock(lifecycleBinding(instance), 9_999, context(1, "back"))).rejects.toBeInstanceOf(LifecycleError);
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(1, "expired")))
      .rejects.toMatchObject({ code: "gone", statusCode: 410 });
    await expect(controls.get(lifecycleBinding(instance))).rejects.toMatchObject({ code: "gone", statusCode: 410 });
  });

  it("validates transitions before counting repeatable faults relative to their configuration revision", async () => {
    const { controls, repository, instance } = await fixture();
    await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-1" }, context(0, "pending"));
    await controls.transition(lifecycleBinding(instance), { type: "payment_failed" }, context(1, "failed"));
    const repeatConfigured = await controls.configureFault(lifecycleBinding(instance), { operation: "payment_pending", occurrence: 1, type: "timeout", phase: "before_commit", oneShot: false }, context(2, "configure-repeat"));
    const configured = await controls.configureFault(lifecycleBinding(instance), { operation: "order_ready", occurrence: 1, type: "rejection", phase: "before_commit", oneShot: true }, context(repeatConfigured.revision, "configure-invalid"));

    await expect(controls.transition(lifecycleBinding(instance), { type: "order_ready" }, context(configured.revision, "invalid"))).rejects.toMatchObject({ code: "conflict" });
    await expect(controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-2" }, context(configured.revision, "repeat-1"))).rejects.toMatchObject({ committed: false });
    await expect(controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-2" }, context(configured.revision, "repeat-2"))).rejects.toMatchObject({ committed: false });
    expect(repository.events.filter((event) => event.outcome === "fault_before_commit")).toHaveLength(2);
    expect(repository.events.at(-1)).toMatchObject({ releaseId: "release-1", catalogObservationId: "catalog-1", customerBinding: "customer-1", idempotencyKey: "repeat-2", actor: "system" });
  });

  it("injects deterministic one-shot faults before and after commit", async () => {
    const { controls, repository, instance } = await fixture();
    await controls.configureFault(lifecycleBinding(instance), { operation: "order_accepted", occurrence: 1, type: "timeout", phase: "before_commit", oneShot: true }, context(0, "configure-before"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(1, "fault-before")))
      .rejects.toMatchObject({ committed: false });
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(1, "fault-before")))
      .rejects.toMatchObject({ committed: false });
    expect(repository.instances.get(instance.instanceId)?.revision).toBe(1);
    let accepted = await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(1, "retry"));
    accepted = await controls.transition(lifecycleBinding(instance), { type: "payment_pending", attemptId: "pay-fault" }, context(accepted.revision, "pay-pending"));
    accepted = await controls.transition(lifecycleBinding(instance), { type: "payment_paid" }, context(accepted.revision, "pay-paid"));

    const configured = await controls.configureFault(lifecycleBinding(instance), { operation: "order_preparing", occurrence: 1, type: "connection", phase: "after_commit", oneShot: true }, context(accepted.revision, "configure-after"));
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_preparing" }, context(configured.revision, "fault-after")))
      .rejects.toBeInstanceOf(InjectedLifecycleFault);
    expect(repository.instances.get(instance.instanceId)?.state.order?.status).toBe("preparing");
    await expect(controls.transition(lifecycleBinding(instance), { type: "order_preparing" }, context(configured.revision, "fault-after")))
      .rejects.toMatchObject({ committed: true });
    expect((await controls.get(lifecycleBinding(instance))).state.order?.status).toBe("preparing");
  });

  it("seals old identity and resets to a new clean instance", async () => {
    const { controls, service, instance } = await fixture();
    await controls.transition(lifecycleBinding(instance), { type: "order_accepted" }, context(0, "order"));
    const reset = await controls.reset(lifecycleBinding(instance), context(1, "reset"), "instance-reset");

    expect(reset.instanceId).toBe("instance-reset");
    expect(reset.resetFrom).toBe(instance.instanceId);
    expect(reset.state).toEqual({ payment: null, order: null, delivery: null });
    expect(reset.revision).toBe(0);
    expect(await controls.reset(lifecycleBinding(instance), context(1, "reset"), "ignored-on-replay")).toEqual(reset);
    await expect(service.transition(lifecycleBinding(instance), { type: "order_cancelled" }, context(2, "old")))
      .rejects.toMatchObject({ code: "gone" });
    await expect(service.get(lifecycleBinding(instance))).rejects.toMatchObject({ code: "gone", statusCode: 410 });
  });

  it("keeps the ordinary provider contract environment-neutral while controls reject production", async () => {
    const repository = new MemoryLifecycleRepository();
    const controls = new SandboxLifecycleControls(repository);
    const production: LifecycleInstance = {
      ...baseInput,
      environment: "production",
      instanceId: "production-1",
      revision: 0,
      state: { payment: null, order: null, delivery: null },
      sealedAt: null,
      resetFrom: null,
    };
    await repository.create(production, { instanceId: production.instanceId, revision: 0, eventId: "event-1", eventType: "instance_created", payload: {}, logicalTime: production.logicalTime, environment: "production", scenarioDefinitionVersion: production.scenarioDefinitionVersion, releaseId: production.releaseId, catalogObservationId: production.catalogObservationId, catalogHash: production.catalogHash, customerBinding: production.customerBinding, sessionBinding: production.sessionBinding, priorRevision: null, actor: "test", outcome: "control" });
    const service = new LifecycleService(repository);

    expect((await service.transition(lifecycleBinding(production), { type: "order_accepted" }, context(0, "prod"))).state.order?.status).toBe("accepted");
    await expect(controls.advanceClock(lifecycleBinding(production), 2_000, context(1, "control")))
      .rejects.toMatchObject({ code: "forbidden", statusCode: 403 });
  });

  it("completes pickup orders without creating a delivery", async () => {
    const repository = new MemoryLifecycleRepository();
    const controls = new SandboxLifecycleControls(repository);
    const pickup = await controls.create({ ...baseInput, paymentPolicy: "pay_on_fulfillment", fulfillmentPolicy: "pickup", instanceId: "pickup-1" });
    let current = await controls.transition(lifecycleBinding(pickup), { type: "order_accepted" }, context(0, "a"));
    current = await controls.transition(lifecycleBinding(pickup), { type: "order_preparing" }, context(current.revision, "p"));
    current = await controls.transition(lifecycleBinding(pickup), { type: "order_ready" }, context(current.revision, "r"));
    await expect(controls.transition(lifecycleBinding(pickup), { type: "order_completed" }, context(current.revision, "unpaid"))).rejects.toThrow("requires paid payment");
    current = await controls.transition(lifecycleBinding(pickup), { type: "payment_pending", attemptId: "pickup-payment" }, context(current.revision, "payment-pending"));
    current = await controls.transition(lifecycleBinding(pickup), { type: "payment_paid" }, context(current.revision, "payment-paid"));
    current = await controls.transition(lifecycleBinding(pickup), { type: "order_completed" }, context(current.revision, "c"));
    expect(current.state).toMatchObject({ order: { status: "completed" }, delivery: null });
    await expect(controls.transition(lifecycleBinding(pickup), { type: "delivery_pending", attemptId: "bad" }, context(current.revision, "d"))).rejects.toThrow("Pickup orders");
  });

  it("requires pay-on-fulfillment payment before delivered completion", async () => {
    const { controls } = await fixture();
    const delivery = await controls.create({ ...baseInput, paymentPolicy: "pay_on_fulfillment", instanceId: "delivery-cod" });
    let current = await controls.transition(lifecycleBinding(delivery), { type: "order_accepted" }, context(0, "a"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "order_preparing" }, context(current.revision, "p"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "order_ready" }, context(current.revision, "r"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "delivery_pending", attemptId: "delivery-1" }, context(current.revision, "dp"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "delivery_assigned" }, context(current.revision, "da"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "delivery_started" }, context(current.revision, "ds"));
    await expect(controls.transition(lifecycleBinding(delivery), { type: "delivery_delivered" }, context(current.revision, "unpaid"))).rejects.toThrow("requires paid payment");
    current = await controls.transition(lifecycleBinding(delivery), { type: "payment_pending", attemptId: "payment-1" }, context(current.revision, "pp"));
    current = await controls.transition(lifecycleBinding(delivery), { type: "payment_paid" }, context(current.revision, "paid"));
    await expect(controls.transition(lifecycleBinding(delivery), { type: "delivery_delivered" }, context(current.revision, "delivered"))).resolves.toMatchObject({ state: { order: { status: "completed" }, delivery: { status: "delivered" } } });
  });
});
