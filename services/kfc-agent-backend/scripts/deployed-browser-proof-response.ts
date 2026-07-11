const textDecoder = new TextDecoder();

export interface ChatResponseBody {
  state?: Record<string, unknown>;
}

export interface CapturedChatResponse {
  url: string;
  status: number;
  bodyText: string | null;
  captureError?: string | null;
}

interface ResponseLike {
  url(): string;
  status(): number;
  json(): Promise<unknown>;
  body(): Promise<Buffer | Uint8Array | ArrayBuffer>;
}

export async function resolveChatResponseBody(input: {
  response: ResponseLike;
  captured: CapturedChatResponse | null;
  scenarioId: string;
  turnIndex: number;
}): Promise<ChatResponseBody> {
  const failures: string[] = [];

  if (input.captured) {
    const capturedResult = parseChatResponseText(input.captured.bodyText);
    if (capturedResult.ok) return capturedResult.value;
    failures.push(`submit capture: ${capturedResult.reason}`);
    if (input.captured.captureError) {
      failures.push(`submit capture error: ${input.captured.captureError}`);
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

function normalizeChatResponseBody(value: unknown): ChatResponseBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("chat response body must be a JSON object");
  }
  return value as ChatResponseBody;
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
