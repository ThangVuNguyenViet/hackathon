import { Buffer } from "node:buffer";
import type { CapturedChatResponse } from "./deployed-browser-proof-response.js";

interface RequestLike {
  url(): string;
  method(): string;
  postDataJSON?(): unknown;
  postData?(): string | null;
}

interface ResponseLike {
  request(): RequestLike;
}

interface ApiResponseLike {
  url(): string;
  status(): number;
  body(): Promise<Buffer | Uint8Array | ArrayBuffer>;
}

interface RouteLike {
  request(): RequestLike;
  fetch(): Promise<ApiResponseLike>;
  fulfill(options?: any): Promise<void>;
  continue(): Promise<void>;
}

export interface KfcMessageRouteCapture {
  matches(request: RequestLike): boolean;
  intercept(route: RouteLike): Promise<void>;
  takeForResponse(response: ResponseLike): CapturedChatResponse | null;
}

const textDecoder = new TextDecoder();

export function createKfcMessageRouteCapture(): KfcMessageRouteCapture {
  const records = new WeakMap<RequestLike, CapturedChatResponse>();

  const matches = (request: RequestLike): boolean =>
    request.method().toUpperCase() === "POST" && isExactKfcMessageEndpoint(request.url());

  return {
    matches,
    async intercept(route: RouteLike): Promise<void> {
      const request = route.request();
      if (!matches(request)) {
        await route.continue();
        return;
      }

      const response = await route.fetch();
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
      const request = response.request();
      const record = records.get(request) ?? null;
      if (record) records.delete(request);
      return record;
    },
  };
}

export function isExactKfcMessageEndpoint(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    return new URL(url).pathname === "/chat/kfc/message";
  } catch {
    return false;
  }
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
