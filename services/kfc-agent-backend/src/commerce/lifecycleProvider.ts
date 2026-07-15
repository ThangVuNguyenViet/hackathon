import type { D1DatabaseLike } from "../persistence/d1Store.js";

export type CommerceEnvironment = "production" | "sandbox";
export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";
export type OrderStatus = "accepted" | "rejected" | "preparing" | "ready" | "completed" | "cancelled";
export type DeliveryStatus = "pending_dispatch" | "assigned" | "delivering" | "delivered" | "failed" | "cancelled";
export type LifecycleFaultType = "timeout" | "connection" | "rejection" | "malformed" | "partial";
export type PaymentPolicy = "prepaid" | "pay_on_fulfillment";
export type FulfillmentPolicy = "delivery" | "pickup";

export interface LifecycleAttempt<S extends string> { attemptId: string; status: S }
export interface LifecycleState {
  payment: LifecycleAttempt<PaymentStatus> | null;
  order: { status: OrderStatus } | null;
  delivery: LifecycleAttempt<DeliveryStatus> | null;
}

export interface LifecycleInstance {
  instanceId: string;
  environment: CommerceEnvironment;
  scenarioDefinitionVersion: string;
  releaseId: string;
  catalogObservationId: string;
  catalogHash: string;
  customerBinding: string;
  sessionBinding: string;
  paymentPolicy: PaymentPolicy;
  fulfillmentPolicy: FulfillmentPolicy;
  logicalTime: number;
  expiresAt: number;
  revision: number;
  state: LifecycleState;
  sealedAt: number | null;
  resetFrom: string | null;
}

export type LifecycleTransition =
  | { type: "payment_pending"; attemptId: string }
  | { type: "payment_paid" | "payment_failed" | "payment_expired" | "payment_cancelled" }
  | { type: "order_accepted" | "order_rejected" | "order_preparing" | "order_ready" | "order_completed" | "order_cancelled" }
  | { type: "delivery_pending"; attemptId: string }
  | { type: "delivery_assigned" | "delivery_started" | "delivery_delivered" | "delivery_cancelled" | "delivery_failed" };

export interface MutationContext {
  expectedRevision: number;
  idempotencyKey: string;
  requestFingerprint: string;
  traceId?: string;
  runId?: string;
  requestId?: string;
  actor?: string;
}

export interface LifecycleBinding {
  environment: CommerceEnvironment;
  instanceId: string;
  customerBinding: string;
  sessionBinding: string;
  releaseId: string;
  scenarioDefinitionVersion: string;
  catalogObservationId: string;
  catalogHash: string;
}

export interface LifecycleEvent {
  instanceId: string;
  revision: number;
  eventId: string;
  eventType: string;
  payload: unknown;
  logicalTime: number;
  traceId?: string;
  runId?: string;
  requestId?: string;
  environment: CommerceEnvironment;
  scenarioDefinitionVersion: string;
  releaseId: string;
  catalogObservationId: string;
  catalogHash: string;
  customerBinding: string;
  sessionBinding: string;
  priorRevision: number | null;
  idempotencyKey?: string;
  requestFingerprint?: string;
  actor: string;
  outcome: "committed" | "fault_before_commit" | "fault_after_commit" | "control";
}

export interface FaultRule {
  operation: LifecycleTransition["type"];
  occurrence: number;
  type: LifecycleFaultType;
  phase: "before_commit" | "after_commit";
  oneShot: boolean;
}

interface ConfiguredFaultRule extends FaultRule { configuredRevision: number; baseOccurrence: number }
interface StoredIdempotency { fingerprint: string; result: LifecycleInstance; fault: ConfiguredFaultRule | null; committed: boolean }
interface TransitionExecution { current: LifecycleInstance; next: LifecycleInstance; transition: LifecycleTransition; context: MutationContext }

export interface LifecycleRepository {
  get(environment: CommerceEnvironment, instanceId: string): Promise<LifecycleInstance | null>;
  create(instance: LifecycleInstance, event: LifecycleEvent): Promise<void>;
  idempotency(instanceId: string, key: string): Promise<StoredIdempotency | null>;
  commit(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string): Promise<boolean>;
  executeTransition(execution: TransitionExecution): Promise<StoredIdempotency | null>;
  configureFault(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string, fault: FaultRule): Promise<boolean>;
  reset(previousRevision: number, sealed: LifecycleInstance, replacement: LifecycleInstance, events: [LifecycleEvent, LifecycleEvent], key: string, fingerprint: string): Promise<boolean>;
  audit(event: LifecycleEvent): Promise<void>;
}

export interface CommerceLifecycleProvider {
  get(binding: LifecycleBinding): Promise<LifecycleInstance>;
  transition(binding: LifecycleBinding, transition: LifecycleTransition, context: MutationContext): Promise<LifecycleInstance>;
}

export class LifecycleError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "gone" | "forbidden", message: string) { super(message); }
  get statusCode(): number { return this.code === "not_found" ? 404 : this.code === "gone" ? 410 : this.code === "forbidden" ? 403 : 409; }
}

export class InjectedLifecycleFault extends Error {
  constructor(readonly fault: ConfiguredFaultRule, readonly committed: boolean) { super(`Injected ${fault.type} fault ${fault.phase}`); }
}

const emptyState = (): LifecycleState => ({ payment: null, order: null, delivery: null });
const retryablePayment = new Set<PaymentStatus>(["failed", "expired", "cancelled"]);
const terminalDelivery = new Set<DeliveryStatus>(["delivered", "failed", "cancelled"]);

function assertActive(instance: LifecycleInstance): void {
  if (instance.sealedAt !== null) throw new LifecycleError("gone", "Lifecycle instance is sealed");
  if (instance.logicalTime >= instance.expiresAt) throw new LifecycleError("gone", "Lifecycle instance is expired");
}

export function applyLifecycleTransition(instance: Pick<LifecycleInstance, "state" | "paymentPolicy" | "fulfillmentPolicy">, transition: LifecycleTransition): LifecycleState {
  const state = instance.state;
  const next: LifecycleState = structuredClone(state);
  switch (transition.type) {
    case "payment_pending":
      if (next.payment?.status === "paid") throw new LifecycleError("conflict", "Paid payment cannot be retried");
      if (next.payment && !retryablePayment.has(next.payment.status)) throw new LifecycleError("conflict", "Payment attempt is already active");
      if (next.order && ["rejected", "completed", "cancelled"].includes(next.order.status)) throw new LifecycleError("conflict", "A terminal order cannot start payment");
      if (next.payment?.attemptId === transition.attemptId) throw new LifecycleError("conflict", "A terminal payment retry requires a new attempt ID");
      next.payment = { attemptId: transition.attemptId, status: "pending" };
      break;
    case "payment_paid": case "payment_failed": case "payment_expired": case "payment_cancelled":
      if (next.payment?.status !== "pending") throw new LifecycleError("conflict", "Payment must be pending");
      next.payment.status = transition.type.slice(8) as PaymentStatus;
      break;
    case "order_accepted": case "order_rejected":
      if (next.order) throw new LifecycleError("conflict", "Order decision already exists");
      next.order = { status: transition.type === "order_accepted" ? "accepted" : "rejected" };
      break;
    case "order_preparing":
      if (next.order?.status !== "accepted") throw new LifecycleError("conflict", "Only an accepted order can prepare");
      if (instance.paymentPolicy === "prepaid" && next.payment?.status !== "paid") throw new LifecycleError("conflict", "Prepaid order requires paid payment");
      next.order.status = "preparing";
      break;
    case "order_ready":
      if (next.order?.status !== "preparing") throw new LifecycleError("conflict", "Only a preparing order can become ready");
      next.order.status = "ready";
      break;
    case "order_completed":
      if (instance.fulfillmentPolicy !== "pickup" || next.order?.status !== "ready") throw new LifecycleError("conflict", "Only a ready pickup order can complete directly");
      if (instance.paymentPolicy === "pay_on_fulfillment" && next.payment?.status !== "paid") throw new LifecycleError("conflict", "Pickup completion requires paid payment");
      next.order.status = "completed";
      break;
    case "order_cancelled":
      if (next.order?.status !== "accepted" && next.order?.status !== "preparing") throw new LifecycleError("conflict", "Order cannot be cancelled from its current state");
      next.order.status = "cancelled";
      break;
    case "delivery_pending":
      if (instance.fulfillmentPolicy !== "delivery") throw new LifecycleError("conflict", "Pickup orders do not create delivery attempts");
      if (next.delivery && !terminalDelivery.has(next.delivery.status)) throw new LifecycleError("conflict", "Delivery attempt is already active");
      if (next.delivery?.attemptId === transition.attemptId) throw new LifecycleError("conflict", "A terminal delivery retry requires a new attempt ID");
      next.delivery = { attemptId: transition.attemptId, status: "pending_dispatch" };
      break;
    case "delivery_assigned":
      if (next.delivery?.status !== "pending_dispatch") throw new LifecycleError("conflict", "Delivery must await dispatch");
      if (next.order?.status !== "ready") throw new LifecycleError("conflict", "Delivery assignment requires a ready order");
      next.delivery.status = "assigned";
      break;
    case "delivery_started":
      if (next.delivery?.status !== "assigned") throw new LifecycleError("conflict", "Only assigned delivery can start");
      next.delivery.status = "delivering";
      break;
    case "delivery_delivered":
      if (next.delivery?.status !== "delivering") throw new LifecycleError("conflict", "Only an active delivery can complete");
      if (next.order?.status !== "ready") throw new LifecycleError("conflict", "Delivered requires a ready order");
      if (instance.paymentPolicy === "pay_on_fulfillment" && next.payment?.status !== "paid") throw new LifecycleError("conflict", "Delivery completion requires paid payment");
      next.delivery.status = "delivered";
      next.order.status = "completed";
      break;
    case "delivery_cancelled":
      if (next.delivery?.status !== "pending_dispatch" && next.delivery?.status !== "assigned") throw new LifecycleError("conflict", "Delivery cannot be cancelled from its current state");
      next.delivery.status = "cancelled";
      break;
    case "delivery_failed":
      if (next.delivery?.status !== "assigned" && next.delivery?.status !== "delivering") throw new LifecycleError("conflict", "Delivery cannot fail from its current state");
      next.delivery.status = "failed";
  }
  return next;
}

export class LifecycleService implements CommerceLifecycleProvider {
  constructor(private readonly repository: LifecycleRepository) {}

  async get(binding: LifecycleBinding): Promise<LifecycleInstance> {
    const found = await this.repository.get(binding.environment, binding.instanceId);
    if (!found) throw new LifecycleError("not_found", "Lifecycle instance not found");
    if (!matchesBinding(found, binding)) throw new LifecycleError("not_found", "Lifecycle instance not found");
    assertActive(found);
    return found;
  }

  async transition(binding: LifecycleBinding, transition: LifecycleTransition, context: MutationContext): Promise<LifecycleInstance> {
    const replay = await this.repository.idempotency(binding.instanceId, context.idempotencyKey);
    if (replay) {
      if (replay.fingerprint !== context.requestFingerprint) throw new LifecycleError("conflict", "Idempotency key fingerprint conflict");
      if (!matchesBinding(replay.result, binding)) throw new LifecycleError("not_found", "Lifecycle instance not found");
      return replayResult(replay);
    }
    const current = await this.get(binding);
    if (current.revision !== context.expectedRevision) throw new LifecycleError("conflict", "Stale lifecycle revision");
    const nextState = applyLifecycleTransition(current, transition);
    const next = { ...current, revision: current.revision + 1, state: nextState };
    const executed = await this.repository.executeTransition({ current, next, transition, context });
    if (!executed) {
      const raced = await this.repository.idempotency(binding.instanceId, context.idempotencyKey);
      if (raced?.fingerprint === context.requestFingerprint) return replayResult(raced);
      throw new LifecycleError("conflict", "Concurrent lifecycle mutation");
    }
    return replayResult(executed);
  }
}

function replayResult(replay: StoredIdempotency): LifecycleInstance {
  if (replay.fault) throw new InjectedLifecycleFault(replay.fault, replay.committed);
  return replay.result;
}

function matchesBinding(instance: LifecycleInstance, binding: LifecycleBinding): boolean {
  return instance.instanceId === binding.instanceId && matchesBindingContext(instance, binding);
}

function matchesBindingContext(instance: LifecycleInstance, binding: LifecycleBinding): boolean {
  return instance.environment === binding.environment && instance.customerBinding === binding.customerBinding && instance.sessionBinding === binding.sessionBinding &&
    instance.releaseId === binding.releaseId && instance.scenarioDefinitionVersion === binding.scenarioDefinitionVersion &&
    instance.catalogObservationId === binding.catalogObservationId && instance.catalogHash === binding.catalogHash;
}

export function lifecycleBinding(instance: LifecycleInstance): LifecycleBinding {
  const { environment, instanceId, customerBinding, sessionBinding, releaseId, scenarioDefinitionVersion, catalogObservationId, catalogHash } = instance;
  return { environment, instanceId, customerBinding, sessionBinding, releaseId, scenarioDefinitionVersion, catalogObservationId, catalogHash };
}

export interface CreateLifecycleInput extends Omit<LifecycleInstance, "instanceId" | "revision" | "state" | "sealedAt" | "resetFrom"> { instanceId?: string }

export class SandboxLifecycleControls {
  constructor(private readonly repository: LifecycleRepository, private readonly service = new LifecycleService(repository)) {}
  private sandbox(environment: CommerceEnvironment): void {
    if (environment !== "sandbox") throw new LifecycleError("forbidden", "Lifecycle controls are sandbox-only");
  }
  async create(input: CreateLifecycleInput): Promise<LifecycleInstance> {
    this.sandbox(input.environment);
    if (!input.scenarioDefinitionVersion || !input.releaseId || !input.catalogObservationId || !input.catalogHash || !input.customerBinding || !input.sessionBinding) throw new LifecycleError("conflict", "Lifecycle bindings are required");
    if (input.paymentPolicy !== "prepaid" && input.paymentPolicy !== "pay_on_fulfillment") throw new LifecycleError("conflict", "Invalid payment policy");
    if (input.fulfillmentPolicy !== "delivery" && input.fulfillmentPolicy !== "pickup") throw new LifecycleError("conflict", "Invalid fulfillment policy");
    const instance: LifecycleInstance = { ...input, instanceId: input.instanceId ?? crypto.randomUUID(), revision: 0, state: emptyState(), sealedAt: null, resetFrom: null };
    if (instance.expiresAt <= instance.logicalTime) throw new LifecycleError("conflict", "Expiry must be after logical time");
    await this.repository.create(instance, makeEvent(instance, "instance_created", input));
    return instance;
  }
  get(binding: LifecycleBinding): Promise<LifecycleInstance> {
    this.sandbox(binding.environment); return this.service.get(binding);
  }
  transition(binding: LifecycleBinding, transition: LifecycleTransition, context: MutationContext): Promise<LifecycleInstance> {
    this.sandbox(binding.environment); return this.service.transition(binding, transition, context);
  }
  async advanceClock(binding: LifecycleBinding, logicalTime: number, context: MutationContext): Promise<LifecycleInstance> {
    this.sandbox(binding.environment);
    return this.controlMutation(binding, context, "clock_advanced", (current) => {
      if (logicalTime <= current.logicalTime) throw new LifecycleError("conflict", "Logical clock must advance");
      return { ...current, logicalTime };
    });
  }
  async seal(binding: LifecycleBinding, context: MutationContext): Promise<LifecycleInstance> {
    this.sandbox(binding.environment);
    return this.controlMutation(binding, context, "instance_sealed", (current) => ({ ...current, sealedAt: current.logicalTime }));
  }
  async configureFault(binding: LifecycleBinding, fault: FaultRule, context: MutationContext): Promise<LifecycleInstance> {
    this.sandbox(binding.environment);
    if (!Number.isSafeInteger(fault.occurrence) || fault.occurrence < 1) throw new LifecycleError("conflict", "Fault occurrence must be a positive integer");
    const replay = await this.replay(binding, context);
    if (replay) return replay;
    const current = await this.loadRaw(binding);
    if (current.revision !== context.expectedRevision) throw new LifecycleError("conflict", "Stale lifecycle revision");
    const next = { ...current, revision: current.revision + 1 };
    const event = makeEvent(next, "fault_configured", { fault }, context, current.revision, "control");
    if (!await this.repository.configureFault(current.revision, next, event, context.idempotencyKey, context.requestFingerprint, fault)) throw new LifecycleError("conflict", "Concurrent lifecycle mutation");
    return next;
  }
  async reset(binding: LifecycleBinding, context: MutationContext, newInstanceId: string = crypto.randomUUID()): Promise<LifecycleInstance> {
    this.sandbox(binding.environment);
    const replay = await this.replay(binding, context, true);
    if (replay) return replay;
    const current = await this.loadRaw(binding);
    if (current.revision !== context.expectedRevision) throw new LifecycleError("conflict", "Stale lifecycle revision");
    const sealed = { ...current, revision: current.revision + 1, sealedAt: current.logicalTime };
    const reset: LifecycleInstance = { ...sealed, instanceId: newInstanceId, revision: 0, state: emptyState(), sealedAt: null, resetFrom: sealed.instanceId };
    const events: [LifecycleEvent, LifecycleEvent] = [
      makeEvent(sealed, "instance_sealed_for_reset", { replacementId: reset.instanceId }, context, current.revision, "control"),
      makeEvent(reset, "instance_reset", { resetFrom: sealed.instanceId }, context, null, "control"),
    ];
    if (!await this.repository.reset(current.revision, sealed, reset, events, context.idempotencyKey, context.requestFingerprint)) {
      const raced = await this.replay(binding, context, true);
      if (raced) return raced;
      throw new LifecycleError("conflict", "Concurrent lifecycle reset");
    }
    return reset;
  }
  private async controlMutation(binding: LifecycleBinding, context: MutationContext, type: string, change: (current: LifecycleInstance) => LifecycleInstance): Promise<LifecycleInstance> {
    const replay = await this.repository.idempotency(binding.instanceId, context.idempotencyKey);
    if (replay) {
      if (replay.fingerprint !== context.requestFingerprint) throw new LifecycleError("conflict", "Idempotency key fingerprint conflict");
      if (!matchesBinding(replay.result, binding)) throw new LifecycleError("not_found", "Lifecycle instance not found");
      return replay.result;
    }
    const current = await this.loadRaw(binding);
    if (current.revision !== context.expectedRevision) throw new LifecycleError("conflict", "Stale lifecycle revision");
    const next = { ...change(current), revision: current.revision + 1 };
    const event = makeEvent(next, type, {}, context, current.revision, "control");
    if (!await this.repository.commit(current.revision, next, event, context.idempotencyKey, context.requestFingerprint)) throw new LifecycleError("conflict", "Concurrent lifecycle mutation");
    return next;
  }
  private async loadRaw(binding: LifecycleBinding): Promise<LifecycleInstance> {
    const current = await this.repository.get(binding.environment, binding.instanceId);
    if (!current) throw new LifecycleError("not_found", "Lifecycle instance not found");
    if (!matchesBinding(current, binding)) throw new LifecycleError("not_found", "Lifecycle instance not found");
    assertActive(current);
    return current;
  }
  private async replay(binding: LifecycleBinding, context: MutationContext, allowResetReplacement = false): Promise<LifecycleInstance | null> {
    const replay = await this.repository.idempotency(binding.instanceId, context.idempotencyKey);
    if (!replay) return null;
    if (replay.fingerprint !== context.requestFingerprint) throw new LifecycleError("conflict", "Idempotency key fingerprint conflict");
    if (!(matchesBinding(replay.result, binding) || (allowResetReplacement && replay.result.resetFrom === binding.instanceId && matchesBindingContext(replay.result, binding)))) throw new LifecycleError("not_found", "Lifecycle instance not found");
    return replay.result;
  }
}

function makeEvent(instance: LifecycleInstance, eventType: string, payload: unknown, context: Partial<MutationContext> = {}, priorRevision: number | null = null, outcome: LifecycleEvent["outcome"] = "control"): LifecycleEvent {
  return { instanceId: instance.instanceId, revision: instance.revision, eventId: crypto.randomUUID(), eventType, payload, logicalTime: instance.logicalTime, traceId: context.traceId, runId: context.runId, requestId: context.requestId, environment: instance.environment, scenarioDefinitionVersion: instance.scenarioDefinitionVersion, releaseId: instance.releaseId, catalogObservationId: instance.catalogObservationId, catalogHash: instance.catalogHash, customerBinding: instance.customerBinding, sessionBinding: instance.sessionBinding, priorRevision, idempotencyKey: context.idempotencyKey, requestFingerprint: context.requestFingerprint, actor: context.actor ?? "system", outcome };
}

interface InstanceRow { instance_id: string; environment: CommerceEnvironment; scenario_definition_version: string; release_id: string; catalog_observation_id: string; catalog_hash: string; customer_binding: string; session_binding: string; payment_policy: PaymentPolicy; fulfillment_policy: FulfillmentPolicy; logical_time: number; expires_at: number; revision: number; state_json: string; sealed_at: number | null; reset_from: string | null }

export class D1LifecycleRepository implements LifecycleRepository {
  constructor(private readonly db: D1DatabaseLike) {}
  async get(environment: CommerceEnvironment, instanceId: string): Promise<LifecycleInstance | null> {
    const row = await this.db.prepare("SELECT * FROM commerce_lifecycle_instances WHERE environment = ? AND instance_id = ?").bind(environment, instanceId).first<InstanceRow>();
    return row ? fromRow(row) : null;
  }
  async create(instance: LifecycleInstance, event: LifecycleEvent): Promise<void> {
    if (!this.db.batch) throw new Error("D1 batch support is required for lifecycle persistence");
    const now = new Date().toISOString();
    await this.db.batch([
      instanceInsert(this.db, instance, now),
      eventStatement(this.db, event, now),
    ]);
  }
  async idempotency(instanceId: string, key: string): Promise<StoredIdempotency | null> {
    const row = await this.db.prepare("SELECT request_fingerprint, result_json, fault_json, committed FROM commerce_lifecycle_idempotency WHERE instance_id = ? AND idempotency_key = ?").bind(instanceId, key).first<{ request_fingerprint: string; result_json: string; fault_json: string | null; committed: number }>();
    return row ? { fingerprint: row.request_fingerprint, result: JSON.parse(row.result_json) as LifecycleInstance, fault: row.fault_json ? JSON.parse(row.fault_json) as ConfiguredFaultRule : null, committed: Boolean(row.committed) } : null;
  }
  async commit(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string): Promise<boolean> {
    if (!this.db.batch) throw new Error("D1 batch support is required for lifecycle persistence");
    const now = new Date().toISOString();
    const results = await this.db.batch([
      this.db.prepare(`UPDATE commerce_lifecycle_instances SET logical_time = ?, expires_at = ?, revision = ?, state_json = ?, sealed_at = ?, updated_at = ? WHERE instance_id = ? AND environment = ? AND revision = ?`).bind(instance.logicalTime, instance.expiresAt, instance.revision, JSON.stringify(instance.state), instance.sealedAt, now, instance.instanceId, instance.environment, previousRevision),
      eventStatement(this.db, event, now, true),
      this.db.prepare(`INSERT INTO commerce_lifecycle_idempotency (instance_id, idempotency_key, request_fingerprint, result_json, fault_json, committed, revision, created_at) SELECT ?, ?, ?, ?, NULL, 1, ?, ? WHERE changes() = 1`).bind(instance.instanceId, key, fingerprint, JSON.stringify(instance), instance.revision, now),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1;
  }
  async executeTransition({ current, next, transition, context }: TransitionExecution): Promise<StoredIdempotency | null> {
    if (!this.db.batch) throw new Error("D1 batch support is required for lifecycle persistence");
    const now = new Date().toISOString();
    const commandId = crypto.randomUUID();
    const faultSelect = `SELECT f.operation, f.occurrence, f.fault_type, f.phase, f.one_shot, f.configured_revision, f.base_occurrence,
      json_object('operation', f.operation, 'occurrence', f.occurrence, 'type', f.fault_type, 'phase', f.phase, 'oneShot', json(iif(f.one_shot = 1, 'true', 'false')), 'configuredRevision', f.configured_revision, 'baseOccurrence', f.base_occurrence) AS fault_json
      FROM commerce_lifecycle_faults f JOIN commerce_lifecycle_operation_occurrences o ON o.instance_id = f.instance_id AND o.operation = f.operation
      WHERE f.instance_id = ? AND f.operation = ? AND ((f.one_shot = 1 AND f.consumed_at IS NULL AND o.occurrence = f.base_occurrence + f.occurrence) OR (f.one_shot = 0 AND o.occurrence >= f.base_occurrence + f.occurrence))
      ORDER BY iif(o.occurrence = f.base_occurrence + f.occurrence, 0, 1), f.configured_revision DESC LIMIT 1`;
    const eventId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO commerce_lifecycle_command_claims (command_id, instance_id, expected_revision, idempotency_key, created_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM commerce_lifecycle_instances WHERE instance_id = ? AND environment = ? AND revision = ? AND sealed_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM commerce_lifecycle_idempotency WHERE instance_id = ? AND idempotency_key = ?)`)
        .bind(commandId, current.instanceId, current.revision, context.idempotencyKey, now, current.instanceId, current.environment, current.revision, current.instanceId, context.idempotencyKey),
      this.db.prepare(`INSERT INTO commerce_lifecycle_operation_occurrences (instance_id, operation, occurrence)
        SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM commerce_lifecycle_command_claims WHERE command_id = ?)
        ON CONFLICT(instance_id, operation) DO UPDATE SET occurrence = occurrence + 1 RETURNING occurrence`).bind(current.instanceId, transition.type, commandId),
      this.db.prepare(faultSelect).bind(current.instanceId, transition.type),
      this.db.prepare(`WITH fault AS (${faultSelect}) UPDATE commerce_lifecycle_instances SET revision = ?, state_json = ?, updated_at = ?
        WHERE instance_id = ? AND environment = ? AND revision = ? AND EXISTS (SELECT 1 FROM commerce_lifecycle_command_claims WHERE command_id = ?)
        AND COALESCE((SELECT phase FROM fault), '') <> 'before_commit'`)
        .bind(current.instanceId, transition.type, next.revision, JSON.stringify(next.state), now, current.instanceId, current.environment, current.revision, commandId),
      this.db.prepare(`WITH fault AS (${faultSelect}) INSERT INTO commerce_lifecycle_events
        (instance_id, revision, event_id, event_type, payload_json, logical_time, trace_id, run_id, request_id, environment, scenario_definition_version, release_id, catalog_observation_id, catalog_hash, customer_binding, session_binding, prior_revision, idempotency_key, request_fingerprint, actor, outcome, created_at)
        SELECT ?, iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', ?, ?), ?, iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', ?, ?),
          json_object('transition', json(?), 'previousState', json(?), 'nextState', json(?), 'fault', json(COALESCE((SELECT fault_json FROM fault), 'null'))),
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', 'fault_before_commit', iif(COALESCE((SELECT phase FROM fault), '') = 'after_commit', 'fault_after_commit', 'committed')), ?
        WHERE EXISTS (SELECT 1 FROM commerce_lifecycle_command_claims WHERE command_id = ?)`)
        .bind(current.instanceId, transition.type, current.instanceId, current.revision, next.revision, eventId, `${transition.type}_fault`, transition.type, JSON.stringify(transition), JSON.stringify(current.state), JSON.stringify(next.state), current.logicalTime, context.traceId ?? null, context.runId ?? null, context.requestId ?? null, current.environment, current.scenarioDefinitionVersion, current.releaseId, current.catalogObservationId, current.catalogHash, current.customerBinding, current.sessionBinding, current.revision, context.idempotencyKey, context.requestFingerprint, context.actor ?? "system", now, commandId),
      this.db.prepare(`WITH fault AS (${faultSelect}) INSERT INTO commerce_lifecycle_idempotency
        (instance_id, idempotency_key, request_fingerprint, result_json, fault_json, committed, revision, created_at)
        SELECT ?, ?, ?, iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', ?, ?), (SELECT fault_json FROM fault), iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', 0, 1), iif(COALESCE((SELECT phase FROM fault), '') = 'before_commit', ?, ?), ?
        WHERE EXISTS (SELECT 1 FROM commerce_lifecycle_command_claims WHERE command_id = ?)`)
        .bind(current.instanceId, transition.type, current.instanceId, context.idempotencyKey, context.requestFingerprint, JSON.stringify(current), JSON.stringify(next), current.revision, next.revision, now, commandId),
      this.db.prepare(`WITH fault AS (${faultSelect}) UPDATE commerce_lifecycle_faults SET consumed_at = ?
        WHERE instance_id = ? AND operation = ? AND configured_revision = (SELECT configured_revision FROM fault) AND one_shot = 1
        AND EXISTS (SELECT 1 FROM commerce_lifecycle_command_claims WHERE command_id = ?)`)
        .bind(current.instanceId, transition.type, now, current.instanceId, transition.type, commandId),
      this.db.prepare("DELETE FROM commerce_lifecycle_command_claims WHERE command_id = ?").bind(commandId),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return null;
    const row = results[2]?.results?.[0] as { operation: LifecycleTransition["type"]; occurrence: number; fault_type: LifecycleFaultType; phase: FaultRule["phase"]; one_shot: number; configured_revision: number; base_occurrence: number } | undefined;
    const fault = row ? { operation: row.operation, occurrence: row.occurrence, type: row.fault_type, phase: row.phase, oneShot: Boolean(row.one_shot), configuredRevision: row.configured_revision, baseOccurrence: row.base_occurrence } : null;
    return { fingerprint: context.requestFingerprint, result: fault?.phase === "before_commit" ? current : next, fault, committed: fault?.phase !== "before_commit" };
  }
  async configureFault(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string, fault: FaultRule): Promise<boolean> {
    if (!this.db.batch) throw new Error("D1 batch support is required for lifecycle persistence");
    const now = new Date().toISOString();
    const results = await this.db.batch([
      this.db.prepare("UPDATE commerce_lifecycle_instances SET revision = ?, updated_at = ? WHERE instance_id = ? AND environment = ? AND revision = ?").bind(instance.revision, now, instance.instanceId, instance.environment, previousRevision),
      eventStatement(this.db, event, now, true),
      this.db.prepare(`INSERT INTO commerce_lifecycle_idempotency (instance_id, idempotency_key, request_fingerprint, result_json, fault_json, committed, revision, created_at) SELECT ?, ?, ?, ?, NULL, 1, ?, ? WHERE changes() = 1`).bind(instance.instanceId, key, fingerprint, JSON.stringify(instance), instance.revision, now),
      this.db.prepare(`INSERT INTO commerce_lifecycle_faults (instance_id, operation, occurrence, fault_type, phase, one_shot, configured_revision, base_occurrence, consumed_at, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT occurrence FROM commerce_lifecycle_operation_occurrences WHERE instance_id = ? AND operation = ?), 0), NULL, ? WHERE changes() = 1`).bind(instance.instanceId, fault.operation, fault.occurrence, fault.type, fault.phase, fault.oneShot ? 1 : 0, instance.revision, instance.instanceId, fault.operation, now),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1;
  }
  async reset(previousRevision: number, sealed: LifecycleInstance, replacement: LifecycleInstance, events: [LifecycleEvent, LifecycleEvent], key: string, fingerprint: string): Promise<boolean> {
    if (!this.db.batch) throw new Error("D1 batch support is required for lifecycle persistence");
    const now = new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db.prepare("UPDATE commerce_lifecycle_instances SET revision = ?, sealed_at = ?, updated_at = ? WHERE instance_id = ? AND environment = ? AND revision = ? AND sealed_at IS NULL").bind(sealed.revision, sealed.sealedAt, now, sealed.instanceId, sealed.environment, previousRevision),
        eventStatement(this.db, events[0], now, true),
        instanceInsert(this.db, replacement, now, true, sealed.instanceId, sealed.revision),
        eventStatement(this.db, events[1], now, true),
        this.db.prepare(`INSERT INTO commerce_lifecycle_idempotency (instance_id, idempotency_key, request_fingerprint, result_json, fault_json, committed, revision, created_at) SELECT ?, ?, ?, ?, NULL, 1, ?, ? WHERE changes() = 1`).bind(sealed.instanceId, key, fingerprint, JSON.stringify(replacement), replacement.revision, now),
      ]);
      return Number(results[0]?.meta.changes ?? 0) === 1;
    } catch {
      return false;
    }
  }
  async audit(event: LifecycleEvent): Promise<void> { await eventStatement(this.db, event, new Date().toISOString()).run(); }
}

function eventStatement(db: D1DatabaseLike, event: LifecycleEvent, now: string, conditional = false) {
  const values = conditional
    ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`
    : `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return db.prepare(`INSERT INTO commerce_lifecycle_events (instance_id, revision, event_id, event_type, payload_json, logical_time, trace_id, run_id, request_id, environment, scenario_definition_version, release_id, catalog_observation_id, catalog_hash, customer_binding, session_binding, prior_revision, idempotency_key, request_fingerprint, actor, outcome, created_at) ${values}`).bind(event.instanceId, event.revision, event.eventId, event.eventType, JSON.stringify(event.payload), event.logicalTime, event.traceId ?? null, event.runId ?? null, event.requestId ?? null, event.environment, event.scenarioDefinitionVersion, event.releaseId, event.catalogObservationId, event.catalogHash, event.customerBinding, event.sessionBinding, event.priorRevision, event.idempotencyKey ?? null, event.requestFingerprint ?? null, event.actor, event.outcome, now);
}

function instanceInsert(db: D1DatabaseLike, instance: LifecycleInstance, now: string, guarded = false, guardId = "", guardRevision = -1) {
  const values = guarded
    ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM commerce_lifecycle_instances WHERE instance_id = ? AND revision = ? AND sealed_at IS NOT NULL)`
    : `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const statement = db.prepare(`INSERT INTO commerce_lifecycle_instances (instance_id, environment, scenario_definition_version, release_id, catalog_observation_id, catalog_hash, customer_binding, session_binding, payment_policy, fulfillment_policy, logical_time, expires_at, revision, state_json, sealed_at, reset_from, created_at, updated_at) ${values}`);
  const args: unknown[] = [instance.instanceId, instance.environment, instance.scenarioDefinitionVersion, instance.releaseId, instance.catalogObservationId, instance.catalogHash, instance.customerBinding, instance.sessionBinding, instance.paymentPolicy, instance.fulfillmentPolicy, instance.logicalTime, instance.expiresAt, instance.revision, JSON.stringify(instance.state), instance.sealedAt, instance.resetFrom, now, now];
  if (guarded) args.push(guardId, guardRevision);
  return statement.bind(...args);
}

function fromRow(row: InstanceRow): LifecycleInstance {
  return { instanceId: row.instance_id, environment: row.environment, scenarioDefinitionVersion: row.scenario_definition_version, releaseId: row.release_id, catalogObservationId: row.catalog_observation_id, catalogHash: row.catalog_hash, customerBinding: row.customer_binding, sessionBinding: row.session_binding, paymentPolicy: row.payment_policy, fulfillmentPolicy: row.fulfillment_policy, logicalTime: row.logical_time, expiresAt: row.expires_at, revision: row.revision, state: JSON.parse(row.state_json) as LifecycleState, sealedAt: row.sealed_at, resetFrom: row.reset_from };
}

export class MemoryLifecycleRepository implements LifecycleRepository {
  readonly instances = new Map<string, LifecycleInstance>();
  readonly events: LifecycleEvent[] = [];
  private readonly keys = new Map<string, StoredIdempotency>();
  private readonly faults = new Map<string, ConfiguredFaultRule & { consumed: boolean }>();
  private readonly occurrences = new Map<string, number>();
  async get(environment: CommerceEnvironment, instanceId: string) { const value = this.instances.get(instanceId); return value?.environment === environment ? structuredClone(value) : null; }
  async create(instance: LifecycleInstance, event: LifecycleEvent) { if (this.instances.has(instance.instanceId)) throw new LifecycleError("conflict", "Instance ID already exists"); this.instances.set(instance.instanceId, structuredClone(instance)); this.events.push(structuredClone(event)); }
  async idempotency(instanceId: string, key: string) { const found = this.keys.get(`${instanceId}:${key}`); return found ? structuredClone(found) : null; }
  async commit(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string) { const current = this.instances.get(instance.instanceId); if (!current || current.revision !== previousRevision) return false; this.instances.set(instance.instanceId, structuredClone(instance)); this.events.push(structuredClone(event)); this.keys.set(`${instance.instanceId}:${key}`, { fingerprint, result: structuredClone(instance), fault: null, committed: true }); return true; }
  async executeTransition({ current, next, transition, context }: TransitionExecution) {
    const stored = this.instances.get(current.instanceId);
    if (!stored || stored.revision !== current.revision || this.keys.has(`${current.instanceId}:${context.idempotencyKey}`)) return null;
    const occurrenceKey = `${current.instanceId}:${transition.type}`;
    const occurrence = (this.occurrences.get(occurrenceKey) ?? 0) + 1;
    this.occurrences.set(occurrenceKey, occurrence);
    const faultEntry = [...this.faults.entries()].filter(([, fault]) => fault.operation === transition.type &&
      occurrence >= fault.baseOccurrence + fault.occurrence && (!fault.oneShot || (!fault.consumed && occurrence === fault.baseOccurrence + fault.occurrence)))
      .sort(([, a], [, b]) => Number(occurrence !== a.baseOccurrence + a.occurrence) - Number(occurrence !== b.baseOccurrence + b.occurrence) || b.configuredRevision - a.configuredRevision)[0];
    const fault = faultEntry ? (({ consumed: _, ...rule }) => rule)(faultEntry[1]) : null;
    const committed = fault?.phase !== "before_commit";
    const result = committed ? next : current;
    if (committed) this.instances.set(next.instanceId, structuredClone(next));
    if (faultEntry?.[1].oneShot) faultEntry[1].consumed = true;
    this.events.push(makeEvent(result, fault?.phase === "before_commit" ? `${transition.type}_fault` : transition.type, { transition, previousState: current.state, nextState: next.state, fault }, context, current.revision, fault?.phase === "before_commit" ? "fault_before_commit" : fault ? "fault_after_commit" : "committed"));
    const replay = { fingerprint: context.requestFingerprint, result: structuredClone(result), fault: fault ? structuredClone(fault) : null, committed };
    this.keys.set(`${current.instanceId}:${context.idempotencyKey}`, replay);
    return structuredClone(replay);
  }
  async configureFault(previousRevision: number, instance: LifecycleInstance, event: LifecycleEvent, key: string, fingerprint: string, fault: FaultRule) { const current = this.instances.get(instance.instanceId); if (!current || current.revision !== previousRevision) return false; this.instances.set(instance.instanceId, structuredClone(instance)); this.events.push(structuredClone(event)); this.keys.set(`${instance.instanceId}:${key}`, { fingerprint, result: structuredClone(instance), fault: null, committed: true }); const baseOccurrence = this.occurrences.get(`${instance.instanceId}:${fault.operation}`) ?? 0; this.faults.set(`${instance.instanceId}:${fault.operation}:${instance.revision}`, { ...fault, configuredRevision: instance.revision, baseOccurrence, consumed: false }); return true; }
  async reset(previousRevision: number, sealed: LifecycleInstance, replacement: LifecycleInstance, events: [LifecycleEvent, LifecycleEvent], key: string, fingerprint: string) { const current = this.instances.get(sealed.instanceId); if (!current || current.revision !== previousRevision || current.sealedAt !== null || this.instances.has(replacement.instanceId) || [...this.instances.values()].some((item) => item.resetFrom === sealed.instanceId)) return false; this.instances.set(sealed.instanceId, structuredClone(sealed)); this.instances.set(replacement.instanceId, structuredClone(replacement)); this.events.push(...structuredClone(events)); this.keys.set(`${sealed.instanceId}:${key}`, { fingerprint, result: structuredClone(replacement), fault: null, committed: true }); return true; }
  async audit(event: LifecycleEvent) { this.events.push(structuredClone(event)); }
}
