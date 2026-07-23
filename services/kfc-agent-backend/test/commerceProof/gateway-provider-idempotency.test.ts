import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  commerceContractVersion,
} from "../../src/commerceProof/contracts.js";
import {
  createCommerceProofGatewayMutationState,
  restoreCommerceProofGatewayMutationState,
  snapshotCommerceProofGatewayMutationState,
  type CommerceProofGatewayMutationState,
} from "../../src/commerceProof/gatewayMutationContracts.js";
import { buildCommerceProofGatewayServer } from "../../src/commerceProof/gatewayServer.js";
import { buildCommerceProofMockOmsServer } from "../../src/commerceProof/mockOmsServer.js";
import { buildCommerceProofMockPosServer } from "../../src/commerceProof/mockPosServer.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).reverse().map((server) => server.close()));
});

async function listen(server: FastifyInstance): Promise<string> {
  servers.push(server);
  return server.listen({ host: "127.0.0.1", port: 0 });
}

function orderCommand(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: commerceContractVersion,
    traceId: "trace-provider-fence-1",
    scenarioId: "provider-fence",
    sessionId: "kfc:provider-fence",
    clientMessageId: "message-provider-fence",
    idempotencyKey: "provider-fence:placeOrder",
    bindingFingerprint: "a".repeat(64),
    toolName: "placeOrder",
    order: {
      previewId: "preview-provider-fence",
      storeId: "KFCVN0001",
      items: [{ itemCode: "20751", quantity: 1 }],
      totalVnd: 117000,
      paymentMethod: "cash",
      userConfirmed: true,
    },
    ...overrides,
  };
}

async function gatewayHarness(input?: {
  mutationState?: CommerceProofGatewayMutationState;
  timeoutMs?: number;
  delayFirstOmsResponseMs?: number;
}) {
  const oms = buildCommerceProofMockOmsServer({
    token: "oms-token",
    adminToken: "oms-admin-token",
  });
  const pos = buildCommerceProofMockPosServer({
    token: "pos-token",
    adminToken: "pos-admin-token",
  });
  let delayFirstOmsResponse = input?.delayFirstOmsResponseMs !== undefined;
  oms.addHook("onSend", async (request, _reply, payload) => {
    if (
      delayFirstOmsResponse &&
      request.method === "POST" &&
      request.url === "/v1/orders"
    ) {
      delayFirstOmsResponse = false;
      await new Promise((resolve) =>
        setTimeout(resolve, input?.delayFirstOmsResponseMs),
      );
    }
    return payload;
  });
  const downstreamCalls: string[] = [];
  oms.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    if (request.url === "/v1/orders") downstreamCalls.push("oms:create");
    if (request.url.endsWith("/cancel")) downstreamCalls.push("oms:cancel");
  });
  pos.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    if (request.url === "/v1/tickets") downstreamCalls.push("pos:create");
    if (request.url.endsWith("/cancel")) downstreamCalls.push("pos:cancel");
  });
  const [omsBaseUrl, posBaseUrl] = await Promise.all([
    listen(oms),
    listen(pos),
  ]);
  const mutationState =
    input?.mutationState ?? createCommerceProofGatewayMutationState();
  const createGateway = (
    timeoutMs = input?.timeoutMs ?? 3_000,
    state = mutationState,
    persistMutationSnapshot: Parameters<
      typeof buildCommerceProofGatewayServer
    >[0]["persistMutationSnapshot"] = async () => {},
  ) =>
    buildCommerceProofGatewayServer({
      token: "gateway-token",
      oms: { baseUrl: omsBaseUrl, token: "oms-token" },
      pos: { baseUrl: posBaseUrl, token: "pos-token" },
      timeoutMs,
      readinessTimeoutMs: 3_000,
      mutationState: state,
      persistMutationSnapshot,
    });
  return { createGateway, downstreamCalls, mutationState };
}

function injectOrder(
  gateway: FastifyInstance,
  payload: Record<string, unknown>,
) {
  return gateway.inject({
    method: "POST",
    url: "/v1/orders",
    headers: { authorization: "Bearer gateway-token" },
    payload,
  });
}

function must<Value>(
  value: Value | null | undefined,
  message: string,
): Value {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function deferred() {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolver) throw new Error("deferred_resolver_missing");
      resolver();
    },
  };
}

describe("commerce proof provider mutation fence", () => {
  it("retains the original payload, binding, and order ID after an unknown OMS outcome and gateway rebuild", async () => {
    const harness = await gatewayHarness({
      timeoutMs: 50,
      delayFirstOmsResponseMs: 200,
    });
    const firstGateway = harness.createGateway();
    const first = await injectOrder(firstGateway, orderCommand());

    expect(first.statusCode).toBe(503);
    expect(first.json()).toMatchObject({
      errorCode: "provider_idempotency_outcome_unknown",
      commerceOrderId: "COM-0001",
    });
    await firstGateway.close();

    const persistedSnapshot: unknown = JSON.parse(JSON.stringify(
      snapshotCommerceProofGatewayMutationState(harness.mutationState),
    ));
    const rebuiltState =
      restoreCommerceProofGatewayMutationState(persistedSnapshot);
    const rebuiltGateway = harness.createGateway(3_000, rebuiltState);
    servers.push(rebuiltGateway);
    const resumed = await injectOrder(rebuiltGateway, {
      ...orderCommand(),
      traceId: "trace-provider-fence-retry",
    });
    const replay = await injectOrder(rebuiltGateway, {
      ...orderCommand(),
      traceId: "trace-provider-fence-replay",
    });

    expect(resumed.statusCode).toBe(201);
    expect(resumed.json()).toMatchObject({
      traceId: "trace-provider-fence-1",
      outcome: "accepted",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(resumed.json());
    expect(harness.downstreamCalls).toEqual([
      "oms:create",
      "oms:create",
      "pos:create",
    ]);
  });

  it("conflicts before dispatch when one key is rebound or its canonical payload changes", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const first = await injectOrder(gateway, orderCommand());
    const rebound = await injectOrder(gateway, {
      ...orderCommand(),
      bindingFingerprint: "b".repeat(64),
    });
    const changedPayload = await injectOrder(gateway, {
      ...orderCommand(),
      order: {
        ...orderCommand().order,
        items: [{ itemCode: "20751", quantity: 2 }],
      },
    });

    expect(first.statusCode).toBe(201);
    expect(rebound.statusCode).toBe(409);
    expect(changedPayload.statusCode).toBe(409);
    expect(rebound.json().errorCode).toBe("provider_idempotency_conflict");
    expect(changedPayload.json().errorCode).toBe(
      "provider_idempotency_conflict",
    );
    expect(harness.downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("requires and replays exact payment and cancellation identities across a gateway rebuild", async () => {
    const harness = await gatewayHarness();
    const firstGateway = harness.createGateway();
    const placed = await injectOrder(firstGateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const paymentUrl = `/v1/orders/${commerceOrderId}/payment-links`;
    const cancelUrl = `/v1/orders/${commerceOrderId}/cancel`;
    const headers = { authorization: "Bearer gateway-token" };

    const missingPaymentIdentity = await firstGateway.inject({
      method: "POST",
      url: paymentUrl,
      headers,
      payload: { methodId: "zalopay_wallet" },
    });
    const payment = await firstGateway.inject({
      method: "POST",
      url: paymentUrl,
      headers,
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "provider-fence:createPaymentLink",
        bindingFingerprint: "b".repeat(64),
      },
    });
    const changedPayment = await firstGateway.inject({
      method: "POST",
      url: paymentUrl,
      headers,
      payload: {
        methodId: "momo_wallet",
        idempotencyKey: "provider-fence:createPaymentLink",
        bindingFingerprint: "b".repeat(64),
      },
    });
    const missingCancellationIdentity = await firstGateway.inject({
      method: "POST",
      url: cancelUrl,
      headers,
      payload: {},
    });
    const whitespaceCancellationIdentity = await firstGateway.inject({
      method: "POST",
      url: cancelUrl,
      headers,
      payload: {
        idempotencyKey: " provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });
    const cancellation = await firstGateway.inject({
      method: "POST",
      url: cancelUrl,
      headers,
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });
    await firstGateway.close();

    const persistedSnapshot: unknown = JSON.parse(JSON.stringify(
      snapshotCommerceProofGatewayMutationState(harness.mutationState),
    ));
    const rebuiltState =
      restoreCommerceProofGatewayMutationState(persistedSnapshot);
    const rebuiltGateway = harness.createGateway(3_000, rebuiltState);
    servers.push(rebuiltGateway);
    const paymentReplay = await rebuiltGateway.inject({
      method: "POST",
      url: paymentUrl,
      headers,
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "provider-fence:createPaymentLink",
        bindingFingerprint: "b".repeat(64),
      },
    });
    const cancellationReplay = await rebuiltGateway.inject({
      method: "POST",
      url: cancelUrl,
      headers,
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });

    expect(missingPaymentIdentity.statusCode).toBe(400);
    expect(changedPayment.statusCode).toBe(409);
    expect(missingCancellationIdentity.statusCode).toBe(400);
    expect(whitespaceCancellationIdentity.statusCode).toBe(400);
    expect(paymentReplay.statusCode).toBe(payment.statusCode);
    expect(paymentReplay.json()).toEqual(payment.json());
    expect(cancellationReplay.statusCode).toBe(cancellation.statusCode);
    expect(cancellationReplay.json()).toEqual(cancellation.json());
    expect(harness.downstreamCalls).toEqual([
      "oms:create",
      "pos:create",
      "pos:cancel",
      "oms:cancel",
    ]);
  });

  it("rejects a rebound cancellation identity before replaying its completed result", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const placed = await injectOrder(gateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const url = `/v1/orders/${commerceOrderId}/cancel`;
    const headers = { authorization: "Bearer gateway-token" };
    const original = await gateway.inject({
      method: "POST",
      url,
      headers,
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });
    const rebound = await gateway.inject({
      method: "POST",
      url,
      headers,
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "d".repeat(64),
      },
    });

    expect(original.statusCode).toBe(200);
    expect(rebound.statusCode).toBe(409);
    expect(rebound.json().errorCode).toBe("provider_idempotency_conflict");
    expect(harness.downstreamCalls).toEqual([
      "oms:create",
      "pos:create",
      "pos:cancel",
      "oms:cancel",
    ]);
  });

  it("atomically claims one cancellation per order across concurrent distinct keys", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const placed = await injectOrder(gateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const url = `/v1/orders/${commerceOrderId}/cancel`;
    const headers = { authorization: "Bearer gateway-token" };

    const responses = await Promise.all([
      gateway.inject({
        method: "POST",
        url,
        headers,
        payload: {
          idempotencyKey: "provider-fence:cancel-concurrent-a",
          bindingFingerprint: "c".repeat(64),
        },
      }),
      gateway.inject({
        method: "POST",
        url,
        headers,
        payload: {
          idempotencyKey: "provider-fence:cancel-concurrent-b",
          bindingFingerprint: "d".repeat(64),
        },
      }),
    ]);
    const status = await gateway.inject({
      method: "GET",
      url: `/v1/orders/${commerceOrderId}?traceId=post-cancel-race`,
      headers,
    });

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200,
      409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json()
        .errorCode,
    ).toBe("provider_idempotency_conflict");
    expect(status.json()).toMatchObject({
      outcome: "cancelled",
      customerStatus: "cancelled",
      value: { status: "cancelled", posStatus: "cancelled" },
    });
    expect(
      harness.mutationState.cancellationsByIdempotencyKey.size,
    ).toBe(1);
    expect(harness.downstreamCalls).toEqual([
      "oms:create",
      "pos:create",
      "pos:cancel",
      "oms:cancel",
    ]);
  });

  it("shares one in-flight cancellation across concurrent exact retries", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const placed = await injectOrder(gateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const request = {
      method: "POST" as const,
      url: `/v1/orders/${commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        idempotencyKey: "provider-fence:cancel-concurrent-exact",
        bindingFingerprint: "c".repeat(64),
      },
    };

    const [left, right] = await Promise.all([
      gateway.inject(request),
      gateway.inject(request),
    ]);

    expect([left.statusCode, right.statusCode]).toEqual([200, 200]);
    expect(right.json()).toEqual(left.json());
    expect(harness.downstreamCalls).toEqual([
      "oms:create",
      "pos:create",
      "pos:cancel",
      "oms:cancel",
    ]);
  });

  it.each([
    { name: "missing binding", change: { bindingFingerprint: undefined } },
    { name: "missing key", change: { idempotencyKey: undefined } },
    { name: "leading whitespace", change: { idempotencyKey: " fenced-key" } },
    { name: "trailing whitespace", change: { idempotencyKey: "fenced-key " } },
  ])("rejects $name without dispatching an order mutation", async ({ change }) => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const response = await injectOrder(gateway, {
      ...orderCommand(),
      ...change,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("invalid_commerce_command");
    expect(harness.downstreamCalls).toEqual([]);
  });

  it("rejects missing, aliased, noncanonical, or incoherent durable snapshots", async () => {
    expect(() => restoreCommerceProofGatewayMutationState(undefined)).toThrow();

    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    const placed = await injectOrder(gateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const orderOnly = snapshotCommerceProofGatewayMutationState(
      harness.mutationState,
    );

    const missingEvidence = structuredClone(orderOnly);
    const accepted = must(
      must(
        missingEvidence.ordersByIdempotencyKey[0],
        "order snapshot missing",
      )[1].response,
      "accepted response missing",
    );
    delete accepted.omsOrderId;
    delete accepted.posTicketId;
    delete accepted.omsStatus;
    delete accepted.posStatus;

    const missingPosSubmissionReceipt = structuredClone(orderOnly);
    delete must(
      missingPosSubmissionReceipt.ordersByIdempotencyKey[0],
      "order receipt snapshot missing",
    )[1].posSubmitEvidence;

    const aliasedOrderId = structuredClone(orderOnly);
    const aliased = must(
      aliasedOrderId.ordersByIdempotencyKey[0],
      "aliased order snapshot missing",
    )[1];
    aliased.commerceOrderId = "COM-1";
    must(aliased.response, "aliased response missing").commerceOrderId =
      "COM-1";
    must(
      aliasedOrderId.orderKeyByCommerceOrderId[0],
      "aliased reverse index missing",
    )[0] = "COM-1";

    await gateway.inject({
      method: "POST",
      url: `/v1/orders/${commerceOrderId}/payment-links`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "provider-fence:createPaymentLink",
        bindingFingerprint: "b".repeat(64),
      },
    });
    await gateway.inject({
      method: "POST",
      url: `/v1/orders/${commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });
    const complete = snapshotCommerceProofGatewayMutationState(
      harness.mutationState,
    );

    const duplicateKey = structuredClone(complete);
    duplicateKey.ordersByIdempotencyKey.push(
      structuredClone(must(
        duplicateKey.ordersByIdempotencyKey[0],
        "duplicate source order missing",
      )),
    );

    const advancedSequence = structuredClone(complete);
    advancedSequence.nextCommerceSequence += 1;

    const leadingSequenceGap = structuredClone(orderOnly);
    const gapOrder = must(
      leadingSequenceGap.ordersByIdempotencyKey[0],
      "gap order missing",
    )[1];
    gapOrder.commerceOrderId = "COM-0002";
    must(gapOrder.response, "gap response missing").commerceOrderId =
      "COM-0002";
    gapOrder.omsCreateEvidence!.commerceOrderId = "COM-0002";
    gapOrder.posSubmitEvidence!.commerceOrderId = "COM-0002";
    must(
      leadingSequenceGap.orderKeyByCommerceOrderId[0],
      "gap reverse index missing",
    )[0] = "COM-0002";
    leadingSequenceGap.nextCommerceSequence = 2;

    const noncanonicalPayment = structuredClone(complete);
    const paymentEntry = must(
      noncanonicalPayment.paymentLinksByIdempotencyKey[0],
      "payment snapshot missing",
    );
    paymentEntry[1].canonicalPayload = JSON.stringify({
      methodId: "zalopay_wallet",
      commerceOrderId,
    });
    must(
      noncanonicalPayment.authorityByIdempotencyKey
        .find(([key]) => key === paymentEntry[0]),
      "payment authority missing",
    )[1].canonicalPayload = paymentEntry[1].canonicalPayload;

    const forgedCancellation = structuredClone(complete);
    must(
      forgedCancellation.cancellationsByIdempotencyKey[0],
      "cancellation snapshot missing",
    )[1].context.posTicketId = "POS-FORGED";

    const missingPosCancellationReceipt = structuredClone(complete);
    delete must(
      missingPosCancellationReceipt.cancellationsByIdempotencyKey[0],
      "POS cancellation receipt snapshot missing",
    )[1].posCancellationEvidence;

    const missingOmsCancellationReceipt = structuredClone(complete);
    delete must(
      missingOmsCancellationReceipt.cancellationsByIdempotencyKey[0],
      "OMS cancellation receipt snapshot missing",
    )[1].omsCancellationEvidence;

    const missingCollection = structuredClone(complete);
    Reflect.deleteProperty(missingCollection, "authorityByIdempotencyKey");

    const missingProviderRuntimeBinding = structuredClone(complete);
    Reflect.deleteProperty(
      missingProviderRuntimeBinding,
      "providerRuntimeBinding",
    );

    for (const invalid of [
      missingEvidence,
      missingPosSubmissionReceipt,
      aliasedOrderId,
      duplicateKey,
      advancedSequence,
      leadingSequenceGap,
      noncanonicalPayment,
      forgedCancellation,
      missingPosCancellationReceipt,
      missingOmsCancellationReceipt,
      missingCollection,
      missingProviderRuntimeBinding,
    ]) {
      expect(() =>
        restoreCommerceProofGatewayMutationState(invalid),
      ).toThrow();
    }
    expect(() =>
      restoreCommerceProofGatewayMutationState(complete),
    ).not.toThrow();
  });

  it("rejects a coherently forged provider checkpoint during startup reconciliation", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);
    await injectOrder(gateway, orderCommand());
    const forged = structuredClone(
      snapshotCommerceProofGatewayMutationState(harness.mutationState),
    );
    const stored = must(
      forged.ordersByIdempotencyKey[0],
      "stored order missing",
    )[1];
    must(stored.posSubmitEvidence, "POS evidence missing").posTicketId =
      "POS-FORGED";
    must(stored.response, "stored response missing").posTicketId =
      "POS-FORGED";
    const internallyCoherent =
      restoreCommerceProofGatewayMutationState(forged);
    const rebuiltGateway = harness.createGateway(
      3_000,
      internallyCoherent,
    );
    servers.push(rebuiltGateway);

    await expect(rebuiltGateway.ready()).rejects.toThrow(
      "gateway_restored_provider_state_unverified",
    );
  });

  it("fails startup explicitly when gateway state is restored over fresh mock providers", async () => {
    const firstHarness = await gatewayHarness();
    const firstGateway = firstHarness.createGateway();
    servers.push(firstGateway);
    await injectOrder(firstGateway, orderCommand());
    const restored = restoreCommerceProofGatewayMutationState(
      structuredClone(
        snapshotCommerceProofGatewayMutationState(
          firstHarness.mutationState,
        ),
      ),
    );
    const freshProviderHarness = await gatewayHarness({
      mutationState: restored,
    });
    const restartedGateway = freshProviderHarness.createGateway();
    servers.push(restartedGateway);

    await expect(restartedGateway.ready()).rejects.toThrow(
      "gateway_restored_provider_state_unverified",
    );
    expect(freshProviderHarness.downstreamCalls).toEqual([]);
  });

  it("does not dispatch until the pending fence is durable", async () => {
    const harness = await gatewayHarness();
    let rejectPersistence = true;
    const gateway = harness.createGateway(
      3_000,
      harness.mutationState,
      async () => {
        if (rejectPersistence) throw new Error("durable_store_unavailable");
      },
    );
    servers.push(gateway);

    const rejected = await injectOrder(gateway, orderCommand());
    expect(rejected.statusCode).toBe(500);
    expect(harness.downstreamCalls).toEqual([]);
    expect(
      snapshotCommerceProofGatewayMutationState(harness.mutationState),
    ).toEqual({
      nextCommerceSequence: 0,
      ordersByIdempotencyKey: [],
      orderKeyByCommerceOrderId: [],
      authorityByIdempotencyKey: [],
      paymentLinksByIdempotencyKey: [],
      cancellationsByIdempotencyKey: [],
    });

    rejectPersistence = false;
    const retried = await injectOrder(gateway, orderCommand());
    expect(retried.statusCode).toBe(201);
    expect(harness.downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("keeps a durable cancellation authoritative after rebuild and order replay", async () => {
    const harness = await gatewayHarness();
    const firstGateway = harness.createGateway();
    const placed = await injectOrder(firstGateway, orderCommand());
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const headers = { authorization: "Bearer gateway-token" };
    const cancellation = await firstGateway.inject({
      method: "POST",
      url: `/v1/orders/${commerceOrderId}/cancel`,
      headers,
      payload: {
        idempotencyKey: "provider-fence:cancelOrder",
        bindingFingerprint: "c".repeat(64),
      },
    });
    expect(cancellation.statusCode).toBe(200);
    await firstGateway.close();

    const rebuiltState = restoreCommerceProofGatewayMutationState(
      structuredClone(
        snapshotCommerceProofGatewayMutationState(harness.mutationState),
      ),
    );
    const rebuiltGateway = harness.createGateway(3_000, rebuiltState);
    servers.push(rebuiltGateway);
    const callsBeforeBlockedOperations = [...harness.downstreamCalls];

    const status = await rebuiltGateway.inject({
      method: "GET",
      url: `/v1/orders/${commerceOrderId}?traceId=cancelled-status`,
      headers,
    });
    const payment = await rebuiltGateway.inject({
      method: "POST",
      url: `/v1/orders/${commerceOrderId}/payment-links`,
      headers,
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "provider-fence:payment-after-cancel",
        bindingFingerprint: "d".repeat(64),
      },
    });
    const paymentStatus = await rebuiltGateway.inject({
      method: "GET",
      url: `/v1/orders/${commerceOrderId}/payment-status`,
      headers,
    });
    const secondCancellation = await rebuiltGateway.inject({
      method: "POST",
      url: `/v1/orders/${commerceOrderId}/cancel`,
      headers,
      payload: {
        idempotencyKey: "provider-fence:second-cancel",
        bindingFingerprint: "e".repeat(64),
      },
    });
    const orderReplay = await injectOrder(rebuiltGateway, orderCommand());
    const statusAfterReplay = await rebuiltGateway.inject({
      method: "GET",
      url: `/v1/orders/${commerceOrderId}?traceId=cancelled-after-replay`,
      headers,
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      outcome: "cancelled",
      customerStatus: "cancelled",
      value: { status: "cancelled", posStatus: "cancelled" },
    });
    expect(payment.statusCode).toBe(409);
    expect(payment.json().errorCode).toBe("commerce_order_not_payable");
    expect(paymentStatus.statusCode).toBe(409);
    expect(paymentStatus.json().errorCode).toBe(
      "commerce_order_not_payable",
    );
    expect(secondCancellation.statusCode).toBe(409);
    expect(orderReplay.statusCode).toBe(201);
    expect(statusAfterReplay.json()).toMatchObject({
      outcome: "cancelled",
      customerStatus: "cancelled",
    });
    expect(rebuiltState.paymentLinksByIdempotencyKey.has(
      "provider-fence:payment-after-cancel",
    )).toBe(false);
    expect(harness.downstreamCalls).toEqual(callsBeforeBlockedOperations);
  });

  it("allocates contiguous order IDs for concurrent distinct durable fences", async () => {
    const harness = await gatewayHarness();
    const gateway = harness.createGateway();
    servers.push(gateway);

    const [first, second] = await Promise.all([
      injectOrder(gateway, orderCommand({
        idempotencyKey: "provider-fence:concurrent-1",
        bindingFingerprint: "1".repeat(64),
        clientMessageId: "concurrent-message-1",
      })),
      injectOrder(gateway, orderCommand({
        idempotencyKey: "provider-fence:concurrent-2",
        bindingFingerprint: "2".repeat(64),
        clientMessageId: "concurrent-message-2",
        order: {
          ...orderCommand().order,
          previewId: "preview-provider-fence-2",
        },
      })),
    ]);
    const snapshot = snapshotCommerceProofGatewayMutationState(
      harness.mutationState,
    );

    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(new Set([
      first.json().commerceOrderId,
      second.json().commerceOrderId,
    ])).toEqual(new Set(["COM-0001", "COM-0002"]));
    expect(snapshot.nextCommerceSequence).toBe(2);
    expect(() =>
      restoreCommerceProofGatewayMutationState(structuredClone(snapshot)),
    ).not.toThrow();
  });

  it("holds concurrent terminal replay until the exact result is durable", async () => {
    const harness = await gatewayHarness();
    let terminalAttempts = 0;
    const firstTerminalStarted = deferred();
    const firstTerminalRelease = deferred();
    const gateway = harness.createGateway(
      3_000,
      harness.mutationState,
      async (snapshot) => {
        const state = snapshot.ordersByIdempotencyKey[0]?.[1].state;
        if (state !== "completed") return;
        terminalAttempts += 1;
        if (terminalAttempts === 1) {
          firstTerminalStarted.resolve();
          await firstTerminalRelease.promise;
          throw new Error("terminal_write_failed");
        }
      },
    );
    servers.push(gateway);

    const first = injectOrder(gateway, orderCommand());
    await firstTerminalStarted.promise;
    let replaySettled = false;
    const replay = injectOrder(gateway, orderCommand()).finally(() => {
      replaySettled = true;
    });
    await Promise.resolve();
    expect(replaySettled).toBe(false);

    firstTerminalRelease.resolve();
    expect((await first).statusCode).toBe(500);
    const replayed = await replay;
    expect(replayed.statusCode).toBe(201);
    expect(terminalAttempts).toBe(2);
    expect(harness.downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("does not expose an accepted order to reads or mutations while its terminal write is blocked", async () => {
    const harness = await gatewayHarness();
    const terminalStarted = deferred();
    const terminalRelease = deferred();
    const gateway = harness.createGateway(
      3_000,
      harness.mutationState,
      async (snapshot) => {
        if (
          snapshot.ordersByIdempotencyKey[0]?.[1].state === "completed"
        ) {
          terminalStarted.resolve();
          await terminalRelease.promise;
          throw new Error("terminal_write_failed");
        }
      },
    );
    servers.push(gateway);

    const first = injectOrder(gateway, orderCommand());
    await terminalStarted.promise;
    const headers = { authorization: "Bearer gateway-token" };
    let readSettled = false;
    let paymentSettled = false;
    let cancellationSettled = false;
    const read = gateway.inject({
      method: "GET",
      url: "/v1/orders/COM-0001?traceId=blocked-terminal-read",
      headers,
    }).finally(() => {
      readSettled = true;
    });
    const payment = gateway.inject({
      method: "POST",
      url: "/v1/orders/COM-0001/payment-links",
      headers,
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "provider-fence:blocked-payment",
        bindingFingerprint: "b".repeat(64),
      },
    }).finally(() => {
      paymentSettled = true;
    });
    const cancellation = gateway.inject({
      method: "POST",
      url: "/v1/orders/COM-0001/cancel",
      headers,
      payload: {
        idempotencyKey: "provider-fence:blocked-cancel",
        bindingFingerprint: "c".repeat(64),
      },
    }).finally(() => {
      cancellationSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect({
      readSettled,
      paymentSettled,
      cancellationSettled,
    }).toEqual({
      readSettled: false,
      paymentSettled: false,
      cancellationSettled: false,
    });

    terminalRelease.resolve();
    expect((await first).statusCode).toBe(500);
    const [readResponse, paymentResponse, cancellationResponse] =
      await Promise.all([read, payment, cancellation]);
    expect(readResponse.statusCode).toBe(404);
    expect(paymentResponse.statusCode).toBe(404);
    expect(cancellationResponse.statusCode).toBe(404);
    expect(harness.downstreamCalls).toEqual(["oms:create", "pos:create"]);
    expect(
      harness.mutationState.paymentLinksByIdempotencyKey.size,
    ).toBe(0);
    expect(
      harness.mutationState.cancellationsByIdempotencyKey.size,
    ).toBe(0);
  });
});
