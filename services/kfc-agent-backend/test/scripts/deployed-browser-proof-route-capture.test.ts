import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  createKfcMessageRouteCapture,
  isExactKfcMessageEndpoint,
} from "../../scripts/deployed-browser-proof-route-capture.js";

function requestFor(input: {
  url?: string;
  method?: string;
  clientMessageId?: string | null;
  postData?: string | null;
}) {
  const url = input.url ?? "https://chatbot.example/chat/kfc/message";
  const method = input.method ?? "POST";
  const clientMessageId = input.clientMessageId ?? "customer_chat_msg_1";
  const postData =
    input.postData ??
    JSON.stringify({ clientMessageId: clientMessageId ?? undefined });

  return {
    url: () => url,
    method: () => method,
    postDataJSON: () =>
      clientMessageId === null ? { retry: true } : { clientMessageId },
    postData: () => postData,
  };
}

function apiResponseFor(input: {
  url?: string;
  status?: number;
  body?: Buffer | Uint8Array | ArrayBuffer;
  bodyError?: Error;
}) {
  const url = input.url ?? "https://chatbot.example/chat/kfc/message";
  const status = input.status ?? 200;
  const body = input.body ?? Buffer.from('{"state":{"draftOrder":{"total":129000}}}');

  return {
    url: () => url,
    status: () => status,
    body: vi.fn(async () => {
      if (input.bodyError) throw input.bodyError;
      return body;
    }),
  };
}

function routeFor(input: {
  request: ReturnType<typeof requestFor>;
  response: ReturnType<typeof apiResponseFor>;
  fetchError?: Error;
}) {
  return {
    request: () => input.request,
    fetch: vi.fn(async () => {
      if (input.fetchError) throw input.fetchError;
      return input.response;
    }),
    fulfill: vi.fn(async () => {}),
    continue: vi.fn(async () => {}),
  };
}

function submitResponseFor(input: {
  request: ReturnType<typeof requestFor>;
  url?: string;
  status?: number;
}) {
  return {
    url: () => input.url ?? "https://chatbot.example/chat/kfc/message",
    status: () => input.status ?? 200,
    request: () => input.request,
  };
}

describe("createKfcMessageRouteCapture", () => {
  it("only captures the exact /chat/kfc/message POST boundary and passes through other requests", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const getRequest = requestFor({ method: "GET" });
    const getRoute = routeFor({
      request: getRequest,
      response: apiResponseFor({}),
    });

    expect(
      isExactKfcMessageEndpoint(
        "https://chatbot.example/chat/kfc/message",
        "https://chatbot.example",
      ),
    ).toBe(true);
    expect(
      isExactKfcMessageEndpoint(
        "https://chatbot.example/chat/kfc/message/duplicate",
        "https://chatbot.example",
      ),
    ).toBe(false);
    expect(
      isExactKfcMessageEndpoint(
        "https://chatbot.example/chat/kfc/genui-action",
        "https://chatbot.example",
      ),
    ).toBe(false);
    expect(
      isExactKfcMessageEndpoint(
        "https://mirror.example/chat/kfc/message",
        "https://chatbot.example",
      ),
    ).toBe(false);
    expect(capture.matches(requestFor({}))).toBe(true);
    expect(capture.matches(getRequest)).toBe(false);
    expect(
      capture.matches(
        requestFor({ url: "https://chatbot.example/chat/kfc/genui-action" }),
      ),
    ).toBe(false);

    await capture.intercept(getRoute);

    expect(getRoute.continue).toHaveBeenCalledTimes(1);
    expect(getRoute.fetch).not.toHaveBeenCalled();
    expect(getRoute.fulfill).not.toHaveBeenCalled();
  });

  it("continues same-path POSTs on a different origin and does not capture them", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const mirroredRequest = requestFor({
      url: "https://mirror.example/chat/kfc/message",
      clientMessageId: "customer_chat_msg_cross_origin",
    });
    const mirroredRoute = routeFor({
      request: mirroredRequest,
      response: apiResponseFor({
        url: "https://mirror.example/chat/kfc/message",
        body: Buffer.from('{"state":{"draftOrder":{"total":59000}}}'),
      }),
    });

    expect(capture.matches(mirroredRequest)).toBe(false);

    await capture.intercept(mirroredRoute);

    expect(mirroredRoute.continue).toHaveBeenCalledTimes(1);
    expect(mirroredRoute.fetch).not.toHaveBeenCalled();
    expect(mirroredRoute.fulfill).not.toHaveBeenCalled();
    expect(
      capture.takeForResponse(
        submitResponseFor({
          request: mirroredRequest,
          url: "https://mirror.example/chat/kfc/message",
        }),
      ),
    ).toBeNull();
  });

  it("route.fetches the real backend response once, captures its body immediately, and fulfills unchanged bytes", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const request = requestFor({ clientMessageId: "customer_chat_msg_2" });
    const upstreamBody = Buffer.from(
      '{"state":{"clientMessageId":"customer_chat_msg_2","draftOrder":{"total":129000}}}',
    );
    const upstreamResponse = apiResponseFor({
      body: upstreamBody,
      status: 200,
      url: "https://chatbot.example/chat/kfc/message",
    });
    const route = routeFor({ request, response: upstreamResponse });

    await capture.intercept(route);

    expect(route.fetch).toHaveBeenCalledTimes(1);
    expect(upstreamResponse.body).toHaveBeenCalledTimes(1);
    expect(route.fulfill).toHaveBeenCalledWith({
      response: upstreamResponse,
      body: upstreamBody,
    });

    expect(
      capture.takeForResponse(
        submitResponseFor({
          request,
          url: "https://chatbot.example/chat/kfc/message",
          status: 200,
        }),
      ),
    ).toMatchObject({
      url: "https://chatbot.example/chat/kfc/message",
      status: 200,
      requestUrl: "https://chatbot.example/chat/kfc/message",
      requestMethod: "POST",
      requestClientMessageId: "customer_chat_msg_2",
      bodyText: upstreamBody.toString("utf8"),
      captureError: null,
    });
  });

  it("correlates captured bodies to the submit response request identity instead of metadata-only duplicates", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const firstRequest = requestFor({ clientMessageId: "customer_chat_msg_3" });
    const secondRequest = requestFor({ clientMessageId: "customer_chat_msg_3" });
    const firstRoute = routeFor({
      request: firstRequest,
      response: apiResponseFor({
        body: Buffer.from('{"state":{"draftOrder":{"total":59000}}}'),
      }),
    });
    const secondRoute = routeFor({
      request: secondRequest,
      response: apiResponseFor({
        body: Buffer.from('{"state":{"draftOrder":{"total":129000}}}'),
      }),
    });

    await capture.intercept(firstRoute);
    await capture.intercept(secondRoute);

    expect(
      capture.takeForResponse(
        submitResponseFor({ request: secondRequest }),
      )?.bodyText,
    ).toBe('{"state":{"draftOrder":{"total":129000}}}');
    expect(
      capture.takeForResponse(
        submitResponseFor({ request: firstRequest }),
      )?.bodyText,
    ).toBe('{"state":{"draftOrder":{"total":59000}}}');
  });

  it("records body-read failures without inventing data and still fulfills the real upstream response", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const request = requestFor({ clientMessageId: "customer_chat_msg_4" });
    const upstreamResponse = apiResponseFor({
      bodyError: new Error("body unavailable"),
      status: 202,
    });
    const route = routeFor({ request, response: upstreamResponse });

    await capture.intercept(route);

    expect(route.fetch).toHaveBeenCalledTimes(1);
    expect(route.fulfill).toHaveBeenCalledWith({
      response: upstreamResponse,
    });
    expect(
      capture.takeForResponse(
        submitResponseFor({ request, status: 202 }),
      ),
    ).toMatchObject({
      status: 202,
      requestClientMessageId: "customer_chat_msg_4",
      bodyText: null,
      captureError: "body unavailable",
    });
  });

  it("uses an explicit live-safe route.fetch timeout and surfaces a clear timeout error", async () => {
    const capture = createKfcMessageRouteCapture("https://chatbot.example");
    const request = requestFor({ clientMessageId: "customer_chat_msg_timeout" });
    const route = routeFor({
      request,
      response: apiResponseFor({}),
      fetchError: new Error("route.fetch: Timeout 30000ms exceeded"),
    });

    await expect(capture.intercept(route)).rejects.toThrow(
      /route\.fetch.*120000ms.*POST \/chat\/kfc\/message/i,
    );
    expect(route.fetch).toHaveBeenCalledWith({ timeout: 120_000 });
    expect(route.fulfill).not.toHaveBeenCalled();
  });
});
