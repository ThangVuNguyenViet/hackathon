import { describe, expect, it } from "vitest";
import {
  resolveChatResponseBody,
  type CapturedChatResponse,
} from "../../scripts/deployed-browser-proof-response.js";

function protocolBodyError(): Error {
  return new Error(
    "Protocol error (Network.getResponseBody): No data found for resource with given identifier",
  );
}

function captured(body: Record<string, unknown>): CapturedChatResponse {
  return {
    url: "https://chatbot.example/chat/kfc/message",
    status: 200,
    bodyText: JSON.stringify(body),
  };
}

describe("resolveChatResponseBody", () => {
  it("prefers the submit-time captured chat body when Playwright response decoding loses the body", async () => {
    const response = {
      url: () => "https://chatbot.example/chat/kfc/message",
      status: () => 200,
      async json() {
        throw protocolBodyError();
      },
      async body() {
        throw protocolBodyError();
      },
    };

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

  it("fails closed when neither the submit-time capture nor Playwright can provide the chat body", async () => {
    const response = {
      url: () => "https://chatbot.example/chat/kfc/message",
      status: () => 200,
      async json() {
        throw protocolBodyError();
      },
      async body() {
        throw protocolBodyError();
      },
    };

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
