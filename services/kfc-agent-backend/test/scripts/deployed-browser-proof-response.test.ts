import { describe, expect, it } from "vitest";
import * as deployedBrowserProofResponse from "../../scripts/deployed-browser-proof-response.js";
import type { CapturedChatResponse } from "../../scripts/deployed-browser-proof-response.js";

const { resolveChatResponseBody } = deployedBrowserProofResponse;

function protocolBodyError(): Error {
  return new Error(
    "Protocol error (Network.getResponseBody): No data found for resource with given identifier",
  );
}

function captured(body: Record<string, unknown>): CapturedChatResponse {
  return {
    url: "https://chatbot.example/chat/kfc/message",
    status: 200,
    requestUrl: "https://chatbot.example/chat/kfc/message",
    requestMethod: "POST",
    requestClientMessageId: "customer_chat_msg_1",
    bodyText: JSON.stringify(body),
  };
}

function responseFor(input: {
  url?: string | undefined;
  status?: number | undefined;
  clientMessageId?: string | undefined;
  json?: (() => Promise<unknown>) | undefined;
  body?: (() => Promise<Buffer | Uint8Array | ArrayBuffer>) | undefined;
}) {
  return {
    url: () => input.url ?? "https://chatbot.example/chat/kfc/message",
    status: () => input.status ?? 200,
    request: () => ({
      url: () => input.url ?? "https://chatbot.example/chat/kfc/message",
      method: () => "POST",
      postDataJSON: () => ({
        clientMessageId: input.clientMessageId ?? "customer_chat_msg_1",
      }),
    }),
    json:
      input.json ??
      (async () => {
        throw protocolBodyError();
      }),
    body:
      input.body ??
      (async () => {
        throw protocolBodyError();
      }),
  };
}

describe("resolveChatResponseBody", () => {
  it("matches the exact /chat/kfc/message POST capture instead of taking the first FIFO record", async () => {
    const selector = (
      deployedBrowserProofResponse as Record<string, unknown>
    )["findMatchingCapturedChatResponse"];

    expect(typeof selector).toBe("function");
    if (typeof selector !== "function") return;

    const result = selector(
      [
        {
          ...captured({ state: { clientMessageId: "retry-1", total: 59000 } }),
          requestClientMessageId: "retry-1",
        },
        {
          ...captured({ state: { clientMessageId: "customer_chat_msg_2", total: 79000 } }),
          status: 202,
          requestClientMessageId: "customer_chat_msg_2",
        },
        {
          ...captured({ state: { clientMessageId: "customer_chat_msg_2", total: 99000 } }),
          url: "https://chatbot.example/chat/kfc/genui-action",
          requestUrl: "https://chatbot.example/chat/kfc/genui-action",
          requestClientMessageId: "customer_chat_msg_2",
        },
        {
          ...captured({ state: { clientMessageId: "customer_chat_msg_2", total: 129000 } }),
          requestClientMessageId: "customer_chat_msg_2",
        },
      ],
      {
        responseUrl: "https://chatbot.example/chat/kfc/message",
        responseStatus: 200,
        requestUrl: "https://chatbot.example/chat/kfc/message",
        requestMethod: "POST",
        requestClientMessageId: "customer_chat_msg_2",
      },
    );

    expect(result).toMatchObject({
      index: 3,
      match: {
        url: "https://chatbot.example/chat/kfc/message",
        status: 200,
        requestClientMessageId: "customer_chat_msg_2",
        bodyText: JSON.stringify({
          state: { clientMessageId: "customer_chat_msg_2", total: 129000 },
        }),
      },
    });
  });

  it("prefers the submit-time captured chat body when Playwright response decoding loses the body", async () => {
    const response = responseFor({});

    await expect(
      resolveChatResponseBody({
        response,
        captured: captured({
          state: {
            toolTrace: [{ toolName: "previewCart", status: "completed" }],
            draftOrder: { total: 129000 },
          },
        }),
        scenarioId: "01-dat-mon-ro-rang-giao-hang",
        turnIndex: 1,
      }),
    ).resolves.toMatchObject({
      state: {
        toolTrace: [{ toolName: "previewCart", status: "completed" }],
        draftOrder: { total: 129000 },
      },
    });
  });

  it("fails closed when the available submit-time capture belongs to another POST response", async () => {
    const response = responseFor({
      clientMessageId: "customer_chat_msg_2",
    });

    await expect(
      resolveChatResponseBody({
        response,
        captured: {
          ...captured({
            state: {
              toolTrace: [{ toolName: "previewCart", status: "completed" }],
              draftOrder: { total: 59000 },
            },
          }),
          requestClientMessageId: "customer_chat_msg_1",
        },
        scenarioId: "01-dat-mon-ro-rang-giao-hang",
        turnIndex: 2,
      }),
    ).rejects.toThrow(
      "01-dat-mon-ro-rang-giao-hang turn 2 response body unavailable after submit capture and Playwright decode attempts",
    );
  });

  it("fails closed when neither the submit-time capture nor Playwright can provide the chat body", async () => {
    const response = responseFor({});

    await expect(
      resolveChatResponseBody({
        response,
        captured: null,
        scenarioId: "02-tu-van-combo-va-upsell",
        turnIndex: 3,
      }),
    ).rejects.toThrow(
      "02-tu-van-combo-va-upsell turn 3 response body unavailable after submit capture and Playwright decode attempts",
    );
  });
});
