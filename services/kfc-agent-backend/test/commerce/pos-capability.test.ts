import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalCallContext,
  OmsClient,
  ProviderMutationIdentity,
} from "../../src/clients/interfaces.js";
import { createHttpPosClient } from "../../src/commerce/httpPosClient.js";
import { createOmsWithPos } from "../../src/commerce/omsWithPos.js";
import { buildMockPosServer } from "../../src/commerce/mockPosServer.js";
import type { PosClient, PosTicket } from "../../src/commerce/posTypes.js";
import type { Order } from "../../src/domain/types.js";

const openServers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function externalCallContext(
  signal = new AbortController().signal,
): ExternalCallContext {
  return { signal, deadlineAt: Date.now() + 10_000 };
}

function providerIdentity(
  suffix: string,
  bindingFingerprint = "a".repeat(64),
): ProviderMutationIdentity {
  return {
    idempotencyKey: `pos-capability:${suffix}`,
    bindingFingerprint,
  };
}

function placeOrder(
  client: OmsClient,
  input: Parameters<OmsClient["placeOrder"]>[0],
  context: ExternalCallContext,
  identity = providerIdentity(`place:${input.preview.id}`),
) {
  return client.placeOrder(input, context, identity);
}

function cancelOrder(
  client: OmsClient,
  orderId: string,
  context: ExternalCallContext,
  identity = providerIdentity(`cancel:${orderId}`, "c".repeat(64)),
) {
  return client.cancelOrder(orderId, context, identity);
}

function submitPosOrder(
  client: PosClient,
  input: Parameters<PosClient["submitOrder"]>[0],
  context: ExternalCallContext,
  identity = providerIdentity(`pos-submit:${input.order.id}`),
) {
  return client.submitOrder(input, context, identity);
}

function cancelPosTicket(
  client: PosClient,
  ticketId: string,
  context: ExternalCallContext,
  identity = providerIdentity(`pos-cancel:${ticketId}`, "d".repeat(64)),
) {
  return client.cancelTicket(ticketId, context, identity);
}

function order(id = "OMS-1001", itemCode = "20751"): Order {
  return {
    id,
    status: "created",
    paymentStatus: "pending",
    assignedStoreId: "KFCVN0001",
    createdAt: "2026-07-11T00:00:00.000Z",
    cart: {
      id: "cart-1",
      items: [{ itemCode, name: "Combo", quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
  };
}

async function mockPos(input: { rejectItemCodes?: string[] } = {}) {
  const server = buildMockPosServer({ token: "pos-token", ...input });
  openServers.push(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock POS did not bind");
  return {
    server,
    client: createHttpPosClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "pos-token",
    }),
  };
}

function oms(createdOrder = order()) {
  const client: OmsClient = {
    previewOrder: vi.fn(async (input) => ({
      ok: true,
      value: {
        ...createdOrder,
        ...input,
        id: "preview-1",
        status: "previewed",
      },
      message: "previewed",
    })),
    placeOrder: vi.fn(async () => ({
      ok: true,
      value: createdOrder,
      message: "order_created",
    })),
    getOrderStatus: vi.fn(async () => ({
      ok: true,
      value: createdOrder,
      message: "found",
    })),
    cancelOrder: vi.fn(async () => ({
      ok: true,
      value: { ...createdOrder, status: "cancelled" as const },
      message: "cancelled",
    })),
  };
  return client;
}

function ticket(
  status: PosTicket["status"] = "accepted",
): PosTicket {
  return {
    id: "POS-1001",
    omsOrderId: "OMS-1001",
    storeId: "KFCVN0001",
    status,
    createdAt: "2026-07-11T00:00:00.000Z",
  };
}

function stubPos(overrides: Partial<PosClient> = {}): PosClient {
  return {
    submitOrder: vi.fn(async () => ({
      ok: true,
      value: ticket(),
      message: "pos_ticket_created",
    })),
    getTicket: vi.fn(async () => ({
      ok: true,
      value: ticket(),
      message: "pos_ticket_found",
    })),
    cancelTicket: vi.fn(async () => ({
      ok: true,
      value: ticket("cancelled"),
      message: "pos_ticket_cancelled",
    })),
    ...overrides,
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("OMS and POS capability proof", () => {
  it("creates one correlated POS ticket for an idempotently placed OMS order", async () => {
    const { client: pos } = await mockPos();
    const omsClient = oms();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const preview = order("preview-1");
    const context = externalCallContext();

    const first = await placeOrder(coordinated,
      {
        preview,
        userConfirmed: true,
      },
      context,
    );
    const duplicate = await placeOrder(coordinated,
      {
        preview,
        userConfirmed: true,
      },
      context,
    );

    expect(first.ok).toBe(true);
    expect(first.value).toMatchObject({
      id: "OMS-1001",
      posTicketId: expect.stringMatching(/^POS-/),
      posStatus: "accepted",
    });
    expect(duplicate).toEqual(first);
    expect(omsClient.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a POS client labels a rejected mutation as success", async () => {
    const omsClient = oms();
    const pos = stubPos({
      submitOrder: vi.fn(async () => ({
        ok: true,
        value: ticket("rejected"),
        message: "misleading_submission_success",
      })),
    });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    await expect(
      placeOrder(
        coordinated,
        {
          preview: order("preview-misleading-pos-success"),
          userConfirmed: true,
        },
        externalCallContext(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_order_rejected",
    });
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
  });

  it("propagates one bound provider identity and rejects preview rebinding", async () => {
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-bound"),
      userConfirmed: true,
    };
    const identity = {
      idempotencyKey: "confirmation:request-1:placeOrder:digest",
      bindingFingerprint: "a".repeat(64),
    };
    const context = externalCallContext();

    const first = await placeOrder(coordinated, input, context, identity);
    const replay = await placeOrder(coordinated, input, context, identity);
    const conflict = await placeOrder(coordinated, input, context, {
      ...identity,
      bindingFingerprint: "b".repeat(64),
    });
    const crossPreviewConflict = await placeOrder(coordinated,
      {
        ...input,
        preview: { ...input.preview, id: "preview-other" },
      },
      context,
      {
        ...identity,
        bindingFingerprint: "b".repeat(64),
      },
    );

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(crossPreviewConflict).toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(omsClient.placeOrder).toHaveBeenCalledWith(
      input,
      context,
      identity,
    );
    expect(pos.submitOrder).toHaveBeenCalledOnce();
    expect(pos.submitOrder).toHaveBeenCalledWith(
      {
        order: expect.objectContaining({ id: "OMS-1001" }),
      },
      context,
      {
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:pos-submit-order:[a-f0-9]{64}$/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    );
  });

  it("rejects missing, non-canonical, and payload-rebound OMS identities before dispatch", async () => {
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const context = externalCallContext();
    const input = {
      preview: order("preview-strict-identity"),
      userConfirmed: true,
    };

    await expect(
      // @ts-expect-error Provider mutation identity is mandatory.
      coordinated.placeOrder(input, context),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    for (const invalidIdentity of [
      {
        idempotencyKey: " leading",
        bindingFingerprint: "a".repeat(64),
      },
      {
        idempotencyKey: "trailing ",
        bindingFingerprint: "a".repeat(64),
      },
      {
        idempotencyKey: "\u00a0unicode-edge",
        bindingFingerprint: "a".repeat(64),
      },
      {
        ...providerIdentity("uppercase-fingerprint"),
        bindingFingerprint: "A".repeat(64),
      },
    ]) {
      await expect(
        placeOrder(
          coordinated,
          input,
          context,
          invalidIdentity,
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "provider_mutation_identity_required",
      });
    }
    expect(omsClient.placeOrder).not.toHaveBeenCalled();
    expect(pos.submitOrder).not.toHaveBeenCalled();

    const identity = providerIdentity("place:strict-identity");
    await expect(
      placeOrder(coordinated, input, context, identity),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      placeOrder(
        coordinated,
        {
          ...input,
          preview: {
            ...input.preview,
            cart: {
              ...input.preview.cart,
              totalVnd: input.preview.cart.totalVnd + 1,
            },
          },
        },
        context,
        identity,
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(pos.submitOrder).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "unsafe integer",
      value: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      name: "positive infinity",
      value: Number.POSITIVE_INFINITY,
    },
    {
      name: "not-a-number",
      value: Number.NaN,
    },
  ])("rejects a $name before canonical identity derivation or provider dispatch", async ({
    value,
  }) => {
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const unsafe = order("preview-unsafe-canonical-number");
    unsafe.cart.totalVnd = value;

    await expect(
      placeOrder(
        coordinated,
        { preview: unsafe, userConfirmed: true },
        externalCallContext(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_payload_invalid",
    });
    expect(omsClient.placeOrder).not.toHaveBeenCalled();
    expect(pos.submitOrder).not.toHaveBeenCalled();
  });

  it("requires a fresh canonical cancellation identity before OMS or POS dispatch", async () => {
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const context = externalCallContext();
    await expect(
      placeOrder(
        coordinated,
        {
          preview: order("preview-before-strict-cancel"),
          userConfirmed: true,
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      // @ts-expect-error Provider mutation identity is mandatory.
      coordinated.cancelOrder("OMS-1001", context),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    await expect(
      cancelOrder(
        coordinated,
        "OMS-1001",
        context,
        {
          idempotencyKey: " cancel",
          bindingFingerprint: "c".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
    expect(pos.cancelTicket).not.toHaveBeenCalled();

    await expect(
      cancelOrder(coordinated, "OMS-1001", context),
    ).resolves.toMatchObject({ ok: true });
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).toHaveBeenCalledOnce();
  });

  it("shares one in-flight OMS and POS placement across concurrent callers", async () => {
    const context = externalCallContext();
    const secondContext = externalCallContext();
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-concurrent"),
      userConfirmed: true,
    };

    const firstPromise = placeOrder(coordinated, input, context);
    const secondPromise = placeOrder(coordinated, input, secondContext);
    expect(secondPromise).toBe(firstPromise);
    const [first, second] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(omsClient.placeOrder).toHaveBeenCalledWith(
      input,
      context,
      providerIdentity("place:preview-concurrent"),
    );
    expect(pos.submitOrder).toHaveBeenCalledOnce();
    expect(pos.submitOrder).toHaveBeenCalledWith(
      expect.any(Object),
      context,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:pos-submit-order:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("clears a safe failed placement fence before the caller retries", async () => {
    const firstContext = externalCallContext();
    const retryContext = externalCallContext();
    const omsClient = oms();
    vi.mocked(omsClient.placeOrder)
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "commerce_gateway_request_cancelled",
        message: "cancelled before OMS dispatch",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: order(),
        message: "order_created",
      });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-safe-retry"),
      userConfirmed: true,
    };

    await expect(
      placeOrder(coordinated, input, firstContext),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_request_cancelled",
    });
    await expect(
      placeOrder(coordinated, input, retryContext),
    ).resolves.toMatchObject({ ok: true });

    expect(omsClient.placeOrder).toHaveBeenCalledTimes(2);
    expect(omsClient.placeOrder).toHaveBeenLastCalledWith(
      input,
      retryContext,
      providerIdentity("place:preview-safe-retry"),
    );
    expect(pos.submitOrder).toHaveBeenCalledOnce();
  });

  it("cancels the OMS order when the POS rejects an item", async () => {
    const { client: pos } = await mockPos({ rejectItemCodes: ["REJECT-ME"] });
    const omsClient = oms(order("OMS-REJECTED", "REJECT-ME"));
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const context = externalCallContext();

    const result = await placeOrder(coordinated,
      {
        preview: order("preview-rejected", "REJECT-ME"),
        userConfirmed: true,
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "pos_order_rejected",
    });
    expect(omsClient.cancelOrder).toHaveBeenCalledWith(
      "OMS-REJECTED",
      context,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:oms-compensate-pos-rejection:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("projects mock POS preparation status onto the correlated order", async () => {
    const { server, client: pos } = await mockPos();
    const coordinated = createOmsWithPos({ oms: oms(), pos });
    const context = externalCallContext();
    const placed = await placeOrder(coordinated,
      {
        preview: order("preview-1"),
        userConfirmed: true,
      },
      context,
    );
    const ticketId = placed.value?.posTicketId;
    expect(ticketId).toBeTruthy();

    await server.inject({
      method: "POST",
      url: `/__admin/tickets/${ticketId}/status`,
      headers: { authorization: "Bearer pos-token" },
      payload: { status: "preparing" },
    });
    const current = await coordinated.getOrderStatus(
      "OMS-1001",
      context,
    );

    expect(current.value).toMatchObject({
      posTicketId: ticketId,
      posStatus: "preparing",
      status: "preparing",
    });
  });

  it("passes the exact signal to POS and classifies an aborted submit as ambiguous", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(
          controller.signal.reason ??
            new DOMException("aborted", "AbortError"),
        );
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });
    });
    const pos = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl,
    });
    const context = externalCallContext(controller.signal);
    const pending = submitPosOrder(pos,
      { order: order() },
      context,
      providerIdentity("order-1"),
    );
    controller.abort(new DOMException("customer run cancelled", "AbortError"));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });
  });

  it("does not dispatch a pre-aborted or expired POS mutation", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled before dispatch", "AbortError"));
    const fetchImpl = vi.fn<typeof fetch>();
    const pos = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl,
    });

    await expect(
      submitPosOrder(pos,
        { order: order() },
        externalCallContext(controller.signal),
        providerIdentity("pre-aborted"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_request_cancelled",
    });
    await expect(
      submitPosOrder(pos,
        { order: order() },
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() - 1,
        },
        providerIdentity("expired"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_request_cancelled",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires and preserves exact POS key and binding headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) => {
        const isCancellation =
          String(_input).endsWith("/POS-1001/cancel");
        return new Response(JSON.stringify({
          ok: true,
          value: ticket(isCancellation ? "cancelled" : "accepted"),
          message: isCancellation
            ? "pos_ticket_cancelled"
            : "pos_ticket_created",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const pos = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl,
    });
    const context = externalCallContext();

    await expect(
      // @ts-expect-error Provider mutation identity is mandatory.
      pos.submitOrder({ order: order() }, context),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    await expect(
      // @ts-expect-error Provider mutation identity is mandatory.
      pos.cancelTicket("POS-1001", context),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    for (const invalidIdentity of [
      {
        idempotencyKey: " leading",
        bindingFingerprint: "a".repeat(64),
      },
      {
        idempotencyKey: "trailing ",
        bindingFingerprint: "a".repeat(64),
      },
      {
        idempotencyKey: "valid-key",
        bindingFingerprint: "not-a-digest",
      },
    ]) {
      await expect(
        submitPosOrder(
          pos,
          { order: order() },
          context,
          invalidIdentity,
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "provider_mutation_identity_required",
      });
      await expect(
        cancelPosTicket(
          pos,
          "POS-1001",
          context,
          invalidIdentity,
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "provider_mutation_identity_required",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    const submitIdentity = providerIdentity("http-submit");
    const cancelIdentity = providerIdentity(
      "http-cancel",
      "b".repeat(64),
    );
    await expect(
      submitPosOrder(
        pos,
        { order: order() },
        context,
        submitIdentity,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      cancelPosTicket(
        pos,
        "POS-1001",
        context,
        cancelIdentity,
      ),
    ).resolves.toMatchObject({ ok: true });

    const submitHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(submitHeaders.get("idempotency-key")).toBe(
      submitIdentity.idempotencyKey,
    );
    expect(
      submitHeaders.get("x-provider-binding-fingerprint"),
    ).toBe(submitIdentity.bindingFingerprint);
    const cancelHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(cancelHeaders.get("idempotency-key")).toBe(
      cancelIdentity.idempotencyKey,
    );
    expect(
      cancelHeaders.get("x-provider-binding-fingerprint"),
    ).toBe(cancelIdentity.bindingFingerprint);
  });

  it.each([
    {
      operation: "submit" as const,
      status: "rejected",
      errorCode: "pos_order_rejected",
    },
    {
      operation: "submit" as const,
      status: "cancelled",
      errorCode: "pos_mutation_ambiguous",
    },
    {
      operation: "cancel" as const,
      status: "rejected",
      errorCode: "pos_cancellation_rejected",
    },
    {
      operation: "cancel" as const,
      status: "cancellation_failed",
      errorCode: "pos_mutation_ambiguous",
    },
    {
      operation: "submit" as const,
      status: "unknown",
      errorCode: "pos_mutation_ambiguous",
    },
  ])("does not treat HTTP success with $status as a successful $operation mutation", async ({
    operation,
    status,
    errorCode,
  }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        value: {
          ...ticket(),
          status,
        },
        message: "misleading_pos_success",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pos = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl,
    });
    const result = operation === "submit"
      ? await submitPosOrder(
          pos,
          { order: order() },
          externalCallContext(),
          providerIdentity(`misleading-${status}`),
        )
      : await cancelPosTicket(
          pos,
          "POS-1001",
          externalCallContext(),
          providerIdentity(`misleading-${status}`),
        );

    expect(result).toMatchObject({ ok: false, errorCode });
  });

  it("fences post-dispatch POS transport and body-decode failures as ambiguous", async () => {
    const transportFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection reset after write"));
    const transportClient = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl: transportFetch,
    });
    await expect(
      submitPosOrder(
        transportClient,
        { order: order() },
        externalCallContext(),
        providerIdentity("transport-error"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });

    const decodeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{", {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    const decodeClient = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl: decodeFetch,
    });
    await expect(
      submitPosOrder(
        decodeClient,
        { order: order() },
        externalCallContext(),
        providerIdentity("decode-error"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });
    expect(transportFetch).toHaveBeenCalledOnce();
    expect(decodeFetch).toHaveBeenCalledOnce();
  });

  it.each(["submission", "cancellation"] as const)(
    "rejects a structurally invalid successful POS %s response as mutation ambiguity",
    async (operation) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const pos = createHttpPosClient({
        baseUrl: "https://pos.internal.example",
        token: "pos-token",
        fetchImpl,
      });
      const context = externalCallContext();

      const result =
        operation === "submission"
          ? await submitPosOrder(pos,
              { order: order() },
              context,
              providerIdentity("invalid-response"),
            )
          : await cancelPosTicket(pos, "POS-1001", context);

      expect(result).toMatchObject({
        ok: false,
        errorCode: "pos_mutation_ambiguous",
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("returns a typed invalid-provider failure for a structurally invalid POS read", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pos = createHttpPosClient({
      baseUrl: "https://pos.internal.example",
      token: "pos-token",
      fetchImpl,
    });

    await expect(
      pos.getTicket("POS-1001", externalCallContext()),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_invalid_provider_response",
    });
  });

  it("reconciles an ambiguous POS mutation with the exact bound payload and identity", async () => {
    const context = externalCallContext();
    const omsClient = oms();
    const submitOrder = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "pos_mutation_ambiguous",
        message: "POS mutation outcome is ambiguous",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: ticket(),
        message: "pos_ticket_reconciled",
      });
    const pos = stubPos({ submitOrder });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-ambiguous"),
      userConfirmed: true,
    };

    const first = await placeOrder(coordinated, input, context);
    const replay = await placeOrder(coordinated, input, context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });
    expect(replay).toMatchObject({
      ok: true,
      value: { id: "OMS-1001", posTicketId: "POS-1001" },
    });
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(submitOrder).toHaveBeenCalledTimes(2);
    expect(submitOrder.mock.calls[1]).toEqual(submitOrder.mock.calls[0]);
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
  });

  it("replays an unknown POS outcome across coordinator restart without a second provider mutation", async () => {
    const context = externalCallContext();
    const input = {
      preview: order("preview-restart-replay"),
      userConfirmed: true,
    };
    const identity = providerIdentity("place:restart-replay");
    let omsSideEffects = 0;
    let posSideEffects = 0;
    let omsBinding:
      | { key: string; fingerprint: string; result: Order }
      | undefined;
    let posBinding:
      | {
          key: string;
          fingerprint: string;
          canonicalInput: string;
          result: PosTicket;
        }
      | undefined;

    const omsClient = oms();
    vi.mocked(omsClient.placeOrder).mockImplementation(
      async (_request, _callContext, mutationIdentity) => {
        if (omsBinding) {
          return omsBinding.key === mutationIdentity.idempotencyKey &&
            omsBinding.fingerprint ===
              mutationIdentity.bindingFingerprint
            ? {
                ok: true,
                value: omsBinding.result,
                message: "oms_order_replayed",
              }
            : {
                ok: false,
                errorCode: "provider_idempotency_conflict",
                message: "OMS identity conflicts",
              };
        }
        omsSideEffects += 1;
        omsBinding = {
          key: mutationIdentity.idempotencyKey,
          fingerprint: mutationIdentity.bindingFingerprint,
          result: order(),
        };
        return {
          ok: true,
          value: omsBinding.result,
          message: "oms_order_created",
        };
      },
    );
    const submitOrder = vi.fn(
      async (
        request: Parameters<PosClient["submitOrder"]>[0],
        _callContext: ExternalCallContext,
        mutationIdentity: ProviderMutationIdentity,
      ) => {
        const canonicalInput = JSON.stringify(request);
        if (posBinding) {
          if (
            posBinding.key !== mutationIdentity.idempotencyKey ||
            posBinding.fingerprint !==
              mutationIdentity.bindingFingerprint ||
            posBinding.canonicalInput !== canonicalInput
          ) {
            return {
              ok: false,
              errorCode: "provider_idempotency_conflict",
              message: "POS identity or payload conflicts",
            };
          }
          return {
            ok: true,
            value: posBinding.result,
            message: "pos_ticket_replayed",
          };
        }
        posSideEffects += 1;
        posBinding = {
          key: mutationIdentity.idempotencyKey,
          fingerprint: mutationIdentity.bindingFingerprint,
          canonicalInput,
          result: ticket(),
        };
        return {
          ok: false,
          errorCode: "pos_mutation_ambiguous",
          message: "POS committed but the response was lost",
        };
      },
    );
    const pos = stubPos({ submitOrder });

    const beforeRestart = createOmsWithPos({ oms: omsClient, pos });
    await expect(
      placeOrder(beforeRestart, input, context, identity),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });

    const afterRestart = createOmsWithPos({ oms: omsClient, pos });
    await expect(
      placeOrder(afterRestart, input, context, identity),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: "OMS-1001",
        posTicketId: "POS-1001",
      },
    });

    expect(omsSideEffects).toBe(1);
    expect(posSideEffects).toBe(1);
    expect(omsClient.placeOrder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(omsClient.placeOrder).mock.calls[1]).toEqual(
      vi.mocked(omsClient.placeOrder).mock.calls[0],
    );
    expect(submitOrder).toHaveBeenCalledTimes(2);
    expect(submitOrder.mock.calls[1]).toEqual(
      submitOrder.mock.calls[0],
    );

    const conflictingRestart = createOmsWithPos({
      oms: omsClient,
      pos,
    });
    await expect(
      placeOrder(
        conflictingRestart,
        input,
        context,
        {
          ...identity,
          bindingFingerprint: "b".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(omsSideEffects).toBe(1);
    expect(posSideEffects).toBe(1);
    expect(submitOrder).toHaveBeenCalledTimes(2);
  });

  it("reconciles an ambiguous OMS placement with the exact bound request", async () => {
    const context = externalCallContext();
    const omsClient = oms();
    vi.mocked(omsClient.placeOrder)
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "commerce_gateway_mutation_ambiguous",
        message: "OMS placement outcome is ambiguous",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: order(),
        message: "order_reconciled",
      });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-oms-ambiguous"),
      userConfirmed: true,
    };

    const first = await placeOrder(coordinated, input, context);
    const replay = await placeOrder(coordinated, input, context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(replay).toMatchObject({ ok: true });
    expect(omsClient.placeOrder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(omsClient.placeOrder).mock.calls[1]).toEqual(
      vi.mocked(omsClient.placeOrder).mock.calls[0],
    );
    expect(pos.submitOrder).toHaveBeenCalledOnce();
  });

  it.each([
    ["pos_request_cancelled", "commerce_placement_partial", false],
    ["pos_unavailable", "pos_mutation_ambiguous", true],
  ] as const)(
    "handles POS submission outcome %s without unsafe compensation",
    async (errorCode, expectedErrorCode, shouldReconcile) => {
      const context = externalCallContext();
      const omsClient = oms();
      const submitOrder = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          errorCode,
          message: `POS failed with ${errorCode}`,
        });
      if (shouldReconcile) {
        submitOrder.mockResolvedValueOnce({
          ok: true,
          value: ticket(),
          message: "pos_ticket_reconciled",
        });
      }
      const pos = stubPos({ submitOrder });
      const coordinated = createOmsWithPos({ oms: omsClient, pos });
      const input = {
        preview: order(`preview-${errorCode}`),
        userConfirmed: true,
      };

      const first = await placeOrder(coordinated, input, context);
      const replay = await placeOrder(coordinated, input, context);

      expect(first).toMatchObject({
        ok: false,
        errorCode: expectedErrorCode,
      });
      if (shouldReconcile) {
        expect(replay).toMatchObject({ ok: true });
        expect(submitOrder.mock.calls[1]).toEqual(
          submitOrder.mock.calls[0],
        );
      } else {
        expect(replay).toEqual(first);
      }
      expect(omsClient.placeOrder).toHaveBeenCalledOnce();
      expect(submitOrder).toHaveBeenCalledTimes(
        shouldReconcile ? 2 : 1,
      );
      expect(omsClient.cancelOrder).not.toHaveBeenCalled();
    },
  );

  it("does not call POS when cancellation occurs after OMS placement", async () => {
    const controller = new AbortController();
    const context = externalCallContext(controller.signal);
    const omsClient = oms();
    vi.mocked(omsClient.placeOrder).mockImplementation(async () => {
      controller.abort(
        new DOMException("cancelled after OMS placement", "AbortError"),
      );
      return {
        ok: true,
        value: order(),
        message: "order_created",
      };
    });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const input = {
      preview: order("preview-cancelled-after-oms"),
      userConfirmed: true,
    };

    const first = await placeOrder(coordinated, input, context);
    const replay = await placeOrder(coordinated, input, context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "commerce_placement_partial",
    });
    expect(replay).toEqual(first);
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(pos.submitOrder).not.toHaveBeenCalled();
  });

  it("does not compensate after a definitive POS rejection if the caller then cancels", async () => {
    const controller = new AbortController();
    const context = externalCallContext(controller.signal);
    const omsClient = oms();
    const submitOrder = vi.fn(async () => {
      controller.abort(
        new DOMException("cancelled after POS rejection", "AbortError"),
      );
      return {
        ok: false,
        errorCode: "pos_order_rejected",
        message: "POS rejected the order",
      };
    });
    const coordinated = createOmsWithPos({
      oms: omsClient,
      pos: stubPos({ submitOrder }),
    });
    const input = {
      preview: order("preview-cancelled-before-compensation"),
      userConfirmed: true,
    };

    const first = await placeOrder(coordinated, input, context);
    const replay = await placeOrder(coordinated, input, context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "commerce_placement_partial",
    });
    expect(replay).toEqual(first);
    expect(omsClient.placeOrder).toHaveBeenCalledOnce();
    expect(submitOrder).toHaveBeenCalledOnce();
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous OMS cancellation with the same derived identity", async () => {
    const context = externalCallContext();
    const omsClient = oms();
    vi.mocked(omsClient.cancelOrder)
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "commerce_gateway_mutation_ambiguous",
        message: "OMS cancellation outcome is ambiguous",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...order(), status: "cancelled" as const },
        message: "oms_cancellation_reconciled",
      });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const placed = await placeOrder(coordinated,
      {
        preview: order("preview-before-oms-cancel"),
        userConfirmed: true,
      },
      context,
    );
    expect(placed.ok).toBe(true);

    const first = await cancelOrder(coordinated, "OMS-1001", context);
    const replay = await cancelOrder(coordinated, "OMS-1001", context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(replay).toMatchObject({ ok: true });
    expect(omsClient.cancelOrder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(omsClient.cancelOrder).mock.calls[1]).toEqual(
      vi.mocked(omsClient.cancelOrder).mock.calls[0],
    );
    expect(pos.cancelTicket).toHaveBeenCalledOnce();
  });

  it.each([
    ["pos_mutation_ambiguous", "pos_mutation_ambiguous", true],
    [
      "pos_cancellation_rejected",
      "commerce_cancellation_partial",
      false,
    ],
  ] as const)(
    "handles POS cancellation outcome %s without reporting false success",
    async (errorCode, expectedErrorCode, shouldReconcile) => {
      const context = externalCallContext();
      const omsClient = oms();
      const cancelTicket = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          errorCode,
          message: `POS cancellation failed with ${errorCode}`,
        });
      if (shouldReconcile) {
        cancelTicket.mockResolvedValueOnce({
          ok: true,
          value: ticket("cancelled"),
          message: "pos_cancellation_reconciled",
        });
      }
      const pos = stubPos({ cancelTicket });
      const coordinated = createOmsWithPos({ oms: omsClient, pos });
      const placed = await placeOrder(coordinated,
        {
          preview: order(`preview-before-${errorCode}`),
          userConfirmed: true,
        },
        context,
      );
      expect(placed.ok).toBe(true);

      const first = await cancelOrder(coordinated, "OMS-1001", context);
      const replay = await cancelOrder(coordinated, "OMS-1001", context);

      expect(first).toMatchObject({
        ok: false,
        errorCode: expectedErrorCode,
      });
      if (shouldReconcile) {
        expect(replay).toMatchObject({ ok: true });
        expect(cancelTicket.mock.calls[1]).toEqual(
          cancelTicket.mock.calls[0],
        );
      } else {
        expect(replay).toEqual(first);
      }
      expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
      expect(cancelTicket).toHaveBeenCalledTimes(
        shouldReconcile ? 2 : 1,
      );
    },
  );

  it("does not call POS when cancellation occurs after OMS cancellation", async () => {
    const controller = new AbortController();
    const context = externalCallContext(controller.signal);
    const omsClient = oms();
    vi.mocked(omsClient.cancelOrder).mockImplementation(async () => {
      controller.abort(
        new DOMException("cancelled after OMS cancellation", "AbortError"),
      );
      return {
        ok: true,
        value: { ...order(), status: "cancelled" as const },
        message: "cancelled",
      };
    });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const placed = await placeOrder(coordinated,
      {
        preview: order("preview-before-cancel-boundary"),
        userConfirmed: true,
      },
      context,
    );
    expect(placed.ok).toBe(true);

    const first = await cancelOrder(coordinated, "OMS-1001", context);
    const replay = await cancelOrder(coordinated, "OMS-1001", context);

    expect(first).toMatchObject({
      ok: false,
      errorCode: "commerce_cancellation_partial",
    });
    expect(replay).toEqual(first);
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).not.toHaveBeenCalled();
  });

  it("shares one in-flight OMS and POS cancellation across concurrent callers", async () => {
    const context = externalCallContext();
    const secondContext = externalCallContext();
    const omsClient = oms();
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const placed = await placeOrder(coordinated,
      {
        preview: order("preview-before-concurrent-cancel"),
        userConfirmed: true,
      },
      context,
    );
    expect(placed.ok).toBe(true);

    const firstPromise = cancelOrder(coordinated, "OMS-1001", context);
    const secondPromise = cancelOrder(coordinated,
      "OMS-1001",
      secondContext,
    );
    expect(secondPromise).toBe(firstPromise);
    const [first, second] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(omsClient.cancelOrder).toHaveBeenCalledWith(
      "OMS-1001",
      context,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:oms-cancel-order:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(pos.cancelTicket).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).toHaveBeenCalledWith(
      "POS-1001",
      context,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:pos-cancel-ticket:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("clears a safe failed cancellation fence before the caller retries", async () => {
    const placementContext = externalCallContext();
    const firstCancelContext = externalCallContext();
    const retryContext = externalCallContext();
    const omsClient = oms();
    vi.mocked(omsClient.cancelOrder)
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "commerce_gateway_request_cancelled",
        message: "cancelled before OMS cancellation dispatch",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...order(), status: "cancelled" as const },
        message: "cancelled",
      });
    const pos = stubPos();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    await expect(
      placeOrder(coordinated,
        {
          preview: order("preview-before-safe-cancel-retry"),
          userConfirmed: true,
        },
        placementContext,
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      cancelOrder(coordinated, "OMS-1001", firstCancelContext),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_request_cancelled",
    });
    await expect(
      cancelOrder(coordinated, "OMS-1001", retryContext),
    ).resolves.toMatchObject({ ok: true });

    expect(omsClient.cancelOrder).toHaveBeenCalledTimes(2);
    expect(omsClient.cancelOrder).toHaveBeenLastCalledWith(
      "OMS-1001",
      retryContext,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:oms-cancel-order:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(pos.cancelTicket).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight placement before cancelling OMS and its correlated POS ticket", async () => {
    const placementContext = externalCallContext();
    const cancellationContext = externalCallContext();
    const omsClient = oms();
    const submission = deferred<Awaited<
      ReturnType<PosClient["submitOrder"]>
    >>();
    const submitOrder = vi.fn(() => submission.promise);
    const pos = stubPos({ submitOrder });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    const placement = placeOrder(coordinated,
      {
        preview: order("preview-cross-operation"),
        userConfirmed: true,
      },
      placementContext,
    );
    await vi.waitFor(() => {
      expect(submitOrder).toHaveBeenCalledOnce();
    });

    const cancellation = cancelOrder(coordinated,
      "OMS-1001",
      cancellationContext,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
    expect(pos.cancelTicket).not.toHaveBeenCalled();

    submission.resolve({
      ok: true,
      value: ticket(),
      message: "pos_ticket_created",
    });
    const [placed, cancelled] = await Promise.all([
      placement,
      cancellation,
    ]);

    expect(placed).toMatchObject({ ok: true });
    expect(cancelled).toMatchObject({
      ok: true,
      value: {
        status: "cancelled",
        posStatus: "cancelled",
      },
    });
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(omsClient.cancelOrder).toHaveBeenCalledWith(
      "OMS-1001",
      cancellationContext,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:oms-cancel-order:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(pos.cancelTicket).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).toHaveBeenCalledWith(
      "POS-1001",
      cancellationContext,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^kfc-provider:pos-cancel-ticket:/u,
        ),
        bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("fails closed when cancellation overlaps an ambiguous POS placement", async () => {
    const placementContext = externalCallContext();
    const cancellationContext = externalCallContext();
    const omsClient = oms();
    const submission = deferred<Awaited<
      ReturnType<PosClient["submitOrder"]>
    >>();
    const submitOrder = vi.fn(() => submission.promise);
    const pos = stubPos({ submitOrder });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    const placement = placeOrder(coordinated,
      {
        preview: order("preview-cross-operation-ambiguous"),
        userConfirmed: true,
      },
      placementContext,
    );
    await vi.waitFor(() => {
      expect(submitOrder).toHaveBeenCalledOnce();
    });
    const cancellation = cancelOrder(coordinated,
      "OMS-1001",
      cancellationContext,
    );

    submission.resolve({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
      message: "POS placement outcome is ambiguous",
    });
    const [placed, cancelled] = await Promise.all([
      placement,
      cancellation,
    ]);
    const replay = await cancelOrder(coordinated,
      "OMS-1001",
      externalCallContext(),
    );

    expect(placed).toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });
    expect(cancelled).toMatchObject({
      ok: false,
      errorCode: "commerce_cancellation_ambiguous",
    });
    expect(replay).toEqual(cancelled);
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
    expect(pos.cancelTicket).not.toHaveBeenCalled();
  });

  it("retains an unsafe POS placement outcome for a later first cancellation", async () => {
    const omsClient = oms();
    const pos = stubPos({
      submitOrder: vi.fn(async () => ({
        ok: false,
        errorCode: "pos_mutation_ambiguous",
        message: "POS placement outcome is ambiguous",
      })),
    });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    await expect(
      placeOrder(coordinated,
        {
          preview: order("preview-late-ambiguous-cancel"),
          userConfirmed: true,
        },
        externalCallContext(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "pos_mutation_ambiguous",
    });

    await expect(
      cancelOrder(coordinated, "OMS-1001", externalCallContext()),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_cancellation_ambiguous",
    });
    expect(omsClient.cancelOrder).not.toHaveBeenCalled();
    expect(pos.cancelTicket).not.toHaveBeenCalled();
  });

  it("waits for and retains an ambiguous OMS compensation outcome", async () => {
    const omsClient = oms();
    const compensation = deferred<Awaited<
      ReturnType<OmsClient["cancelOrder"]>
    >>();
    vi.mocked(omsClient.cancelOrder).mockImplementation(
      () => compensation.promise,
    );
    const pos = stubPos({
      submitOrder: vi.fn(async () => ({
        ok: false,
        errorCode: "pos_order_rejected",
        message: "POS definitively rejected the order",
      })),
    });
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    const placement = placeOrder(coordinated,
      {
        preview: order("preview-ambiguous-compensation"),
        userConfirmed: true,
      },
      externalCallContext(),
    );
    await vi.waitFor(() => {
      expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    });
    const cancellation = cancelOrder(coordinated,
      "OMS-1001",
      externalCallContext(),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).not.toHaveBeenCalled();

    compensation.resolve({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
      message: "OMS compensation outcome is ambiguous",
    });
    const [placed, cancelled] = await Promise.all([
      placement,
      cancellation,
    ]);
    const replay = await cancelOrder(coordinated,
      "OMS-1001",
      externalCallContext(),
    );

    expect(placed).toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(cancelled).toMatchObject({
      ok: false,
      errorCode: "commerce_cancellation_ambiguous",
    });
    expect(replay).toEqual(cancelled);
    expect(omsClient.cancelOrder).toHaveBeenCalledOnce();
    expect(pos.cancelTicket).not.toHaveBeenCalled();
  });
});
