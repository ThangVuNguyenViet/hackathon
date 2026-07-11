import { Buffer } from "node:buffer";
import type { CapturedChatResponse } from "./deployed-browser-proof-response.js";
import { resolveDeployedBrowserProofLiveTimeoutMs } from "./deployed-browser-proof-timeouts.js";

interface RequestLike {
  url(): string;
  method(): string;
  postDataJSON?(): unknown;
  postData?(): string | null;
}

interface ResponseLike {
  url(): string;
  request(): RequestLike;
}

interface ApiResponseLike {
  url(): string;
  status(): number;
  body(): Promise<Buffer | Uint8Array | ArrayBuffer>;
}

interface RouteLike {
  request(): RequestLike;
  fetch(options?: { timeout?: number }): Promise<ApiResponseLike>;
  fulfill(options?: any): Promise<void>;
  continue(): Promise<void>;
}

interface KfcMessageRouteCaptureOptions {
  routeFetchTimeoutMs?: number;
}

export interface KfcMessageRouteCapture {
  matches(request: RequestLike): boolean;
  intercept(route: RouteLike): Promise<void>;
  takeForResponse(response: ResponseLike): CapturedChatResponse | null;
  dispose(): void;
}

const textDecoder = new TextDecoder();

export function createKfcMessageRouteCapture(
  chatbotUrl: string,
  options: KfcMessageRouteCaptureOptions = {},
): KfcMessageRouteCapture {
  const expectedEndpoint = resolveKfcMessageEndpoint(chatbotUrl);
  const routeFetchTimeoutMs =
    options.routeFetchTimeoutMs ?? resolveDeployedBrowserProofLiveTimeoutMs();
  const records = new WeakMap<RequestLike, CapturedChatResponse>();
  let disposed = false;

  const matches = (request: RequestLike): boolean =>
    request.method().toUpperCase() === "POST" &&
    isExactKfcMessageEndpoint(request.url(), expectedEndpoint);

  return {
    matches,
    async intercept(route: RouteLike): Promise<void> {
      const request = route.request();
      if (!matches(request)) {
        await route.continue();
        return;
      }

      let response: ApiResponseLike;
      try {
        response = await route.fetch({ timeout: routeFetchTimeoutMs });
      } catch (error) {
        if (disposed && isTargetClosedError(error)) return;
        if (isTimeoutError(error)) {
          throw new Error(
            `route.fetch timed out after ${routeFetchTimeoutMs}ms for POST /chat/kfc/message while capturing the live backend response`,
            { cause: error },
          );
        }
        throw new Error(
          `route.fetch failed for POST /chat/kfc/message while capturing the live backend response: ${errorMessage(error)}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      let fulfillBody: Buffer | undefined;
      let bodyText: string | null = null;
      let captureError: string | null = null;
      try {
        fulfillBody = normalizeBody(await response.body());
        bodyText = textDecoder.decode(fulfillBody);
      } catch (error) {
        captureError = errorMessage(error);
      }

      records.set(request, {
        url: response.url(),
        status: response.status(),
        requestUrl: request.url(),
        requestMethod: request.method().toUpperCase(),
        requestClientMessageId: requestClientMessageId(request),
        bodyText,
        captureError,
      });

      await route.fulfill(
        fulfillBody
          ? { response, body: fulfillBody }
          : { response },
      );
    },
    takeForResponse(response: ResponseLike): CapturedChatResponse | null {
      if (!matches(response.request())) return null;
      if (!isExactKfcMessageEndpoint(response.url(), expectedEndpoint)) return null;
      const request = response.request();
      const record = records.get(request) ?? null;
      if (record) records.delete(request);
      return record;
    },
    dispose(): void {
      disposed = true;
    },
  };
}

export function isExactKfcMessageEndpoint(
  url: string | null | undefined,
  chatbotUrl: string | URL,
): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    const candidate = new URL(url);
    const expected = resolveKfcMessageEndpoint(chatbotUrl);
    return (
      candidate.origin === expected.origin &&
      candidate.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

function resolveKfcMessageEndpoint(chatbotUrl: string | URL): URL {
  const candidate =
    chatbotUrl instanceof URL ? chatbotUrl : new URL(chatbotUrl);
  return new URL("/chat/kfc/message", candidate);
}

function normalizeBody(value: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value);
}

function requestClientMessageId(request: RequestLike): string | null {
  const postDataJson = safePostDataJson(request);
  if (postDataJson && typeof postDataJson.clientMessageId === "string") {
    return postDataJson.clientMessageId;
  }

  const postData = typeof request.postData === "function" ? request.postData() : null;
  if (!postData) return null;

  try {
    const parsed = JSON.parse(postData) as { clientMessageId?: unknown };
    return typeof parsed.clientMessageId === "string" ? parsed.clientMessageId : null;
  } catch {
    return null;
  }
}

function safePostDataJson(request: RequestLike): { clientMessageId?: unknown } | null {
  if (typeof request.postDataJSON !== "function") return null;
  try {
    const value = request.postDataJSON();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as { clientMessageId?: unknown };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("timeout") && message.includes("exceeded");
}

function isTargetClosedError(error: unknown): boolean {
  return error instanceof Error && /target page, context or browser has been closed/i.test(error.message);
}
