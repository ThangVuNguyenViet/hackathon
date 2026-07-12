const textDecoder = new TextDecoder();

export interface ChatResponseBody {
  state?: Record<string, unknown> | undefined;
}

export interface CapturedChatResponse {
  url: string;
  status: number;
  requestUrl?: string | null | undefined;
  requestMethod?: string | null | undefined;
  requestClientMessageId?: string | null | undefined;
  bodyText: string | null;
  captureError?: string | null | undefined;
}

export interface CapturedChatResponseMatch {
  responseUrl: string;
  responseStatus: number;
  requestUrl: string;
  requestMethod: string;
  requestClientMessageId: string | null;
}

interface RequestLike {
  url(): string;
  method(): string;
  postDataJSON?(): unknown;
  postData?(): string | null;
}

interface ResponseLike {
  url(): string;
  status(): number;
  request(): RequestLike;
  json(): Promise<unknown>;
  body(): Promise<Buffer | Uint8Array | ArrayBuffer>;
}

export function buildCapturedChatResponseMatch(
  response: ResponseLike,
): CapturedChatResponseMatch {
  const request = response.request();
  return {
    responseUrl: response.url(),
    responseStatus: response.status(),
    requestUrl: request.url(),
    requestMethod: request.method(),
    requestClientMessageId: requestClientMessageId(request),
  };
}

export function findMatchingCapturedChatResponse(
  records: CapturedChatResponse[],
  match: CapturedChatResponseMatch,
): { index: number; match: CapturedChatResponse } | null {
  if (!isExactKfcMessageEndpoint(match.responseUrl)) return null;
  if (!isExactKfcMessageEndpoint(match.requestUrl)) return null;
  if (match.requestMethod.toUpperCase() !== "POST") return null;
  if (!match.requestClientMessageId) return null;

  for (const [index, record] of records.entries()) {
    if (!capturedChatResponseMatches(record, match)) continue;
    return { index, match: record };
  }
  return null;
}

export async function resolveChatResponseBody(input: {
  response: ResponseLike;
  captured: CapturedChatResponse | null;
  scenarioId: string;
  turnIndex: number;
}): Promise<ChatResponseBody> {
  const failures: string[] = [];
  const expectedCapture = buildCapturedChatResponseMatch(input.response);

  if (input.captured) {
    if (capturedChatResponseMatches(input.captured, expectedCapture)) {
      const capturedResult = parseChatResponseText(input.captured.bodyText);
      if (capturedResult.ok) return capturedResult.value;
      failures.push(`submit capture: ${capturedResult.reason}`);
      if (input.captured.captureError) {
        failures.push(`submit capture error: ${input.captured.captureError}`);
      }
    } else {
      failures.push("submit capture: metadata mismatch");
    }
  } else {
    failures.push("submit capture: unavailable");
  }

  try {
    return normalizeChatResponseBody(await input.response.json());
  } catch (error) {
    failures.push(`response.json(): ${errorMessage(error)}`);
  }

  try {
    const rawBody = await input.response.body();
    const bodyText = decodeBody(rawBody);
    const bodyResult = parseChatResponseText(bodyText);
    if (bodyResult.ok) return bodyResult.value;
    failures.push(`response.body(): ${bodyResult.reason}`);
  } catch (error) {
    failures.push(`response.body(): ${errorMessage(error)}`);
  }

  throw new Error(
    `${input.scenarioId} turn ${input.turnIndex} response body unavailable after submit capture and Playwright decode attempts (${failures.join("; ")})`,
  );
}

function parseChatResponseText(bodyText: string | null): { ok: true; value: ChatResponseBody } | { ok: false; reason: string } {
  if (typeof bodyText !== "string" || bodyText.length === 0) {
    return { ok: false, reason: "missing body text" };
  }
  try {
    return { ok: true, value: normalizeChatResponseBody(JSON.parse(bodyText)) };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

function capturedChatResponseMatches(
  captured: CapturedChatResponse,
  match: CapturedChatResponseMatch,
): boolean {
  return (
    isExactKfcMessageEndpoint(captured.url) &&
    isExactKfcMessageEndpoint(captured.requestUrl) &&
    captured.url === match.responseUrl &&
    captured.status === match.responseStatus &&
    captured.requestUrl === match.requestUrl &&
    captured.requestMethod?.toUpperCase() === match.requestMethod.toUpperCase() &&
    captured.requestClientMessageId === match.requestClientMessageId
  );
}

function normalizeChatResponseBody(value: unknown): ChatResponseBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("chat response body must be a JSON object");
  }
  return value;
}

function decodeBody(value: Buffer | Uint8Array | ArrayBuffer): string {
  if (value instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(value));
  }
  return textDecoder.decode(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestClientMessageId(request: RequestLike): string | null {
  const postDataJson = safePostDataJson(request);
  if (postDataJson && typeof postDataJson.clientMessageId === "string") {
    return postDataJson.clientMessageId;
  }

  const postData = typeof request.postData === "function" ? request.postData() : null;
  if (!postData) return null;

  try {
    const parsed = JSON.parse(postData) as { clientMessageId?: unknown | undefined };
    return typeof parsed.clientMessageId === "string" ? parsed.clientMessageId : null;
  } catch {
    return null;
  }
}

function safePostDataJson(request: RequestLike): { clientMessageId?: unknown | undefined } | null {
  if (typeof request.postDataJSON !== "function") return null;
  try {
    const value = request.postDataJSON();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function isExactKfcMessageEndpoint(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    return new URL(url).pathname === "/chat/kfc/message";
  } catch {
    return false;
  }
}
