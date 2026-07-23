import { describe, expect, it, vi } from "vitest";
import type { ExternalCallContext } from "../../src/clients/interfaces.js";
import { ensureCartForTool } from "../../src/graph/commerceExecution.js";
import type { AgentGraphState } from "../../src/graph/state.js";
import { createMockClients } from "../../src/mock/createMockClients.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";

function state(): AgentGraphState {
  return {
    sessionId: "session_1",
    customerId: "customer_1",
    channel: "kfc",
    latestUserMessage: "",
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

describe("commerce execution", () => {
  it("passes the exact external-call context to cart initialization", async () => {
    const clients = createMockClients(createTestFixtures());
    const createCart = vi.spyOn(clients.cart, "createCart");
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const currentState = state();

    await expect(
      ensureCartForTool(
        { clients, sessionId: "session_1" },
        currentState,
        {
          toolName: "updateCart",
          arguments: {
            changes: [{ itemCode: "20751", quantity: 1 }],
          },
        },
        externalCallContext,
      ),
    ).resolves.toEqual({ ok: true });

    expect(createCart).toHaveBeenCalledWith("session_1", externalCallContext);
    expect(currentState.cart?.id).toBe("cart_session_1");
  });

  it("does not initialize or mutate a cart for an aborted context", async () => {
    const clients = createMockClients(createTestFixtures());
    const createCart = vi.spyOn(clients.cart, "createCart");
    const controller = new AbortController();
    controller.abort();
    const currentState = state();

    await expect(
      ensureCartForTool(
        { clients, sessionId: "session_1" },
        currentState,
        {
          toolName: "updateCart",
          arguments: {
            changes: [{ itemCode: "20751", quantity: 1 }],
          },
        },
        {
          signal: controller.signal,
          deadlineAt: Date.now() + 10_000,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });

    expect(createCart).not.toHaveBeenCalled();
    expect(currentState.cart).toBeUndefined();
    expect(currentState.escalationReasons).toEqual([]);
  });

  it("does not initialize a cart after the absolute deadline", async () => {
    const clients = createMockClients(createTestFixtures());
    const createCart = vi.spyOn(clients.cart, "createCart");
    const currentState = state();

    await expect(
      ensureCartForTool(
        { clients, sessionId: "session_1" },
        currentState,
        {
          toolName: "updateCart",
          arguments: {
            changes: [{ itemCode: "20751", quantity: 1 }],
          },
        },
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() - 1,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });

    expect(createCart).not.toHaveBeenCalled();
    expect(currentState.cart).toBeUndefined();
  });

  it("does not apply a cart returned after the invocation was aborted", async () => {
    const clients = createMockClients(createTestFixtures());
    const originalCreateCart = clients.cart.createCart.bind(clients.cart);
    const controller = new AbortController();
    clients.cart.createCart = vi.fn(async (sessionId, context) => {
      const result = await originalCreateCart(sessionId, context);
      controller.abort(new DOMException("turn cancelled", "AbortError"));
      return result;
    });
    const currentState = state();
    const externalCallContext: ExternalCallContext = {
      signal: controller.signal,
      deadlineAt: Date.now() + 10_000,
    };

    await expect(
      ensureCartForTool(
        { clients, sessionId: "session_1" },
        currentState,
        {
          toolName: "updateCart",
          arguments: {
            changes: [{ itemCode: "20751", quantity: 1 }],
          },
        },
        externalCallContext,
      ),
    ).resolves.toEqual({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });

    expect(currentState.cart).toBeUndefined();
    expect(currentState.escalationReasons).toEqual([]);
  });

  it("returns one typed cart failure without mutating state", async () => {
    const clients = createMockClients(createTestFixtures());
    const createCart = vi.fn(async () => ({
      ok: false as const,
      errorCode: "upstream_unavailable",
      message: "unavailable",
    }));
    clients.cart.createCart = createCart;
    const currentState = state();
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const initialize = () =>
      ensureCartForTool(
        { clients, sessionId: "session_1" },
        currentState,
        {
          toolName: "updateCart",
          arguments: {
            changes: [{ itemCode: "20751", quantity: 1 }],
          },
        },
        externalCallContext,
      );

    await expect(initialize()).resolves.toEqual({
      ok: false,
      errorCode: "cart_initialization_failed",
    });
    await expect(initialize()).resolves.toEqual({
      ok: false,
      errorCode: "cart_initialization_failed",
    });

    expect(createCart).toHaveBeenCalledTimes(2);
    expect(currentState.cart).toBeUndefined();
    expect(currentState.escalationReasons).toEqual([
      "cart_initialization_failed",
    ]);
  });
});
