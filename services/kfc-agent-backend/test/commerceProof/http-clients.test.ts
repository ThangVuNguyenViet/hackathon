import { describe, expect, it, vi } from "vitest";
import type { ProviderMutationIdentity } from "../../src/clients/interfaces.js";
import {
  createCommerceProofOmsClient,
  createCommerceProofPosClient,
} from "../../src/commerceProof/httpClients.js";
import { commerceContractVersion } from "../../src/commerceProof/contracts.js";

const omsInput = {
  contractVersion: commerceContractVersion,
  traceId: "trace-child-http",
  scenarioId: "child-http",
  commerceOrderId: "COM-0001",
  storeId: "KFCVN0001",
  items: [{ itemCode: "20751", quantity: 1 }],
  totalVnd: 117000,
};

const posInput = {
  ...omsInput,
  omsOrderId: "OMS-0001",
};

const omsResponse = {
  contractVersion: commerceContractVersion,
  traceId: omsInput.traceId,
  scenarioId: omsInput.scenarioId,
  commerceOrderId: omsInput.commerceOrderId,
  omsOrderId: "OMS-0001",
  omsStatus: "created",
  commerceEnvironment: "sandbox",
  providerImplementation: "http-adapter",
};

const posResponse = {
  contractVersion: commerceContractVersion,
  traceId: posInput.traceId,
  scenarioId: posInput.scenarioId,
  commerceOrderId: posInput.commerceOrderId,
  omsOrderId: posInput.omsOrderId,
  posTicketId: "POS-0001",
  posStatus: "accepted",
  commerceEnvironment: "sandbox",
  providerImplementation: "http-adapter",
};

function identity(marker: string): ProviderMutationIdentity {
  return {
    idempotencyKey: `child-http:${marker}`,
    bindingFingerprint: marker.repeat(64),
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestInit(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
  callIndex = 0,
): RequestInit {
  const init = fetchImpl.mock.calls[callIndex]?.[1];
  if (!init) throw new Error("expected child provider request");
  return init;
}

describe("commerce proof child HTTP clients", () => {
  it("forwards each exact child identity and bound cancellation context", async () => {
    const omsFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(omsResponse, 201))
      .mockResolvedValueOnce(jsonResponse({
        ...omsResponse,
        omsStatus: "cancelled",
      }));
    const posFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(posResponse, 201))
      .mockResolvedValueOnce(jsonResponse({
        ...posResponse,
        posStatus: "cancelled",
      }));
    const oms = createCommerceProofOmsClient({
      baseUrl: "https://oms.invalid",
      token: "oms-token",
      timeoutMs: 1_000,
      fetchImpl: omsFetch,
    });
    const pos = createCommerceProofPosClient({
      baseUrl: "https://pos.invalid",
      token: "pos-token",
      timeoutMs: 1_000,
      fetchImpl: posFetch,
    });
    const omsCreateIdentity = identity("a");
    const posSubmitIdentity = identity("b");
    const omsCancelIdentity = identity("c");
    const posCancelIdentity = identity("d");

    await expect(oms.createOrder(
      omsInput,
      omsCreateIdentity,
    )).resolves.toMatchObject({ ok: true });
    await expect(pos.submitTicket(
      posInput,
      posSubmitIdentity,
    )).resolves.toMatchObject({ ok: true });
    await expect(oms.cancelOrder(
      omsResponse.omsOrderId,
      {
        traceId: omsInput.traceId,
        scenarioId: omsInput.scenarioId,
        commerceOrderId: omsInput.commerceOrderId,
      },
      omsCancelIdentity,
    )).resolves.toMatchObject({ ok: true });
    await expect(pos.cancelTicket(
      posResponse.posTicketId,
      {
        traceId: posInput.traceId,
        scenarioId: posInput.scenarioId,
        commerceOrderId: posInput.commerceOrderId,
        omsOrderId: posInput.omsOrderId,
      },
      posCancelIdentity,
    )).resolves.toMatchObject({ ok: true });

    expect(omsFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://oms.invalid/v1/orders",
      "https://oms.invalid/v1/orders/OMS-0001/cancel",
    ]);
    expect(posFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://pos.invalid/v1/tickets",
      "https://pos.invalid/v1/tickets/POS-0001/cancel",
    ]);
    for (const [fetchImpl, callIndex, expectedIdentity] of [
      [omsFetch, 0, omsCreateIdentity],
      [posFetch, 0, posSubmitIdentity],
      [omsFetch, 1, omsCancelIdentity],
      [posFetch, 1, posCancelIdentity],
    ] as const) {
      expect(requestInit(fetchImpl, callIndex)).toMatchObject({
        method: "POST",
        headers: expect.objectContaining({
          "idempotency-key": expectedIdentity.idempotencyKey,
          "x-provider-binding-fingerprint":
            expectedIdentity.bindingFingerprint,
        }),
      });
    }
    expect(JSON.parse(String(requestInit(omsFetch, 1).body))).toEqual({
      traceId: omsInput.traceId,
      scenarioId: omsInput.scenarioId,
      commerceOrderId: omsInput.commerceOrderId,
    });
    expect(JSON.parse(String(requestInit(posFetch, 1).body))).toEqual({
      traceId: posInput.traceId,
      scenarioId: posInput.scenarioId,
      commerceOrderId: posInput.commerceOrderId,
      omsOrderId: posInput.omsOrderId,
    });
  });

  it.each([
    {
      name: "OMS create",
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofOmsClient({
          baseUrl: "https://oms.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).createOrder(omsInput, identity("a")),
      response: { ...omsResponse, commerceOrderId: "COM-WRONG" },
    },
    {
      name: "POS submit",
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofPosClient({
          baseUrl: "https://pos.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).submitTicket(posInput, identity("b")),
      response: { ...posResponse, omsOrderId: "OMS-WRONG" },
    },
    {
      name: "OMS cancel",
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofOmsClient({
          baseUrl: "https://oms.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).cancelOrder(
          "OMS-0001",
          {
            traceId: omsInput.traceId,
            scenarioId: omsInput.scenarioId,
            commerceOrderId: omsInput.commerceOrderId,
          },
          identity("c"),
        ),
      response: {
        ...omsResponse,
        omsOrderId: "OMS-WRONG",
        omsStatus: "cancelled",
      },
    },
    {
      name: "POS cancel",
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofPosClient({
          baseUrl: "https://pos.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).cancelTicket(
          "POS-0001",
          {
            traceId: posInput.traceId,
            scenarioId: posInput.scenarioId,
            commerceOrderId: posInput.commerceOrderId,
            omsOrderId: posInput.omsOrderId,
          },
          identity("d"),
        ),
      response: {
        ...posResponse,
        posTicketId: "POS-WRONG",
        posStatus: "cancelled",
      },
    },
  ])("rejects a structurally valid uncorrelated $name response", async ({
    run,
    response,
  }) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(response));

    await expect(run(fetchImpl)).resolves.toMatchObject({
      ok: false,
      status: 502,
      errorCode: "downstream_response_binding_mismatch",
      timedOut: false,
    });
  });

  it("rejects an uncorrelated semantic failure instead of triggering a next phase", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      errorCode: "pos_order_rejected",
      message: "rejected",
      posStatus: "rejected",
      traceId: posInput.traceId,
      scenarioId: posInput.scenarioId,
      commerceOrderId: "COM-WRONG",
      omsOrderId: posInput.omsOrderId,
    }, 409));
    const pos = createCommerceProofPosClient({
      baseUrl: "https://pos.invalid",
      token: "token",
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(pos.submitTicket(posInput, identity("b"))).resolves.toMatchObject({
      ok: false,
      status: 502,
      errorCode: "downstream_response_binding_mismatch",
    });
  });

  it.each([
    {
      name: "POS rejection without rejected status",
      response: {
        errorCode: "pos_order_rejected",
        message: "rejected",
        traceId: posInput.traceId,
        scenarioId: posInput.scenarioId,
        commerceOrderId: posInput.commerceOrderId,
        omsOrderId: posInput.omsOrderId,
      },
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofPosClient({
          baseUrl: "https://pos.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).submitTicket(posInput, identity("a")),
    },
    {
      name: "OMS cancellation failure claiming cancelled",
      response: {
        errorCode: "oms_cancellation_failed",
        message: "failed",
        traceId: omsInput.traceId,
        scenarioId: omsInput.scenarioId,
        commerceOrderId: omsInput.commerceOrderId,
        omsOrderId: "OMS-0001",
        omsStatus: "cancelled",
      },
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofOmsClient({
          baseUrl: "https://oms.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).cancelOrder(
          "OMS-0001",
          {
            traceId: omsInput.traceId,
            scenarioId: omsInput.scenarioId,
            commerceOrderId: omsInput.commerceOrderId,
          },
          identity("b"),
        ),
    },
    {
      name: "POS cancellation failure claiming cancelled",
      response: {
        errorCode: "pos_cancellation_failed",
        message: "failed",
        traceId: posInput.traceId,
        scenarioId: posInput.scenarioId,
        commerceOrderId: posInput.commerceOrderId,
        omsOrderId: posInput.omsOrderId,
        posTicketId: "POS-0001",
        posStatus: "cancelled",
      },
      run: (fetchImpl: typeof fetch) =>
        createCommerceProofPosClient({
          baseUrl: "https://pos.invalid",
          token: "token",
          timeoutMs: 1_000,
          fetchImpl,
        }).cancelTicket(
          "POS-0001",
          {
            traceId: posInput.traceId,
            scenarioId: posInput.scenarioId,
            commerceOrderId: posInput.commerceOrderId,
            omsOrderId: posInput.omsOrderId,
          },
          identity("c"),
        ),
    },
  ])("rejects inconsistent semantic status: $name", async ({
    response,
    run,
  }) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(response, 409));

    await expect(run(fetchImpl)).resolves.toMatchObject({
      ok: false,
      status: 502,
      errorCode: "downstream_response_binding_mismatch",
    });
  });

  it.each([
    {
      name: "edge whitespace",
      identity: {
        idempotencyKey: " child-http",
        bindingFingerprint: "a".repeat(64),
      },
    },
    {
      name: "oversized key",
      identity: {
        idempotencyKey: "a".repeat(513),
        bindingFingerprint: "a".repeat(64),
      },
    },
    {
      name: "invalid binding",
      identity: {
        idempotencyKey: "child-http",
        bindingFingerprint: "A".repeat(64),
      },
    },
  ])("rejects $name before fetch", async ({ identity: invalidIdentity }) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const oms = createCommerceProofOmsClient({
      baseUrl: "https://oms.invalid",
      token: "token",
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(oms.createOrder(
      omsInput,
      invalidIdentity,
    )).resolves.toMatchObject({
      ok: false,
      status: 400,
      errorCode: "provider_mutation_identity_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates a missing runtime identity before building request headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const oms = createCommerceProofOmsClient({
      baseUrl: "https://oms.invalid",
      token: "token",
      timeoutMs: 1_000,
      fetchImpl,
    });

    const result = await Reflect.apply(oms.createOrder, oms, [
      omsInput,
      undefined,
    ]);

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      errorCode: "provider_mutation_identity_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves definitive identity conflicts and ambiguous transport outcomes", async () => {
    const conflictFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      errorCode: "provider_idempotency_conflict",
      message: "conflict",
    }, 409));
    const unavailableFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      errorCode: "provider_unavailable",
      message: "unknown",
    }, 503));
    const requestTimeoutFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        errorCode: "provider_request_timeout",
        message: "timed out",
      }, 408),
    );
    const timeoutFetch = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );

    for (const [fetchImpl, expected] of [
      [
        conflictFetch,
        {
          status: 409,
          errorCode: "provider_idempotency_conflict",
          timedOut: false,
        },
      ],
      [
        unavailableFetch,
        {
          status: 503,
          errorCode: "provider_unavailable",
          timedOut: false,
        },
      ],
      [
        requestTimeoutFetch,
        {
          status: 504,
          errorCode: "downstream_timeout",
          timedOut: true,
        },
      ],
      [
        timeoutFetch,
        {
          status: 504,
          errorCode: "downstream_timeout",
          timedOut: true,
        },
      ],
    ] as const) {
      const oms = createCommerceProofOmsClient({
        baseUrl: "https://oms.invalid",
        token: "token",
        timeoutMs: 1_000,
        fetchImpl,
      });
      await expect(oms.createOrder(omsInput, identity("a")))
        .resolves.toMatchObject({ ok: false, ...expected });
    }
  });
});
