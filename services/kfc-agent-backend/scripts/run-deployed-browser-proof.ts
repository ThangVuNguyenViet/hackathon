import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "playwright-core";
import {
  resolveChatResponseBody,
  type CapturedChatResponse,
} from "./deployed-browser-proof-response.js";
import {
  createKfcMessageRouteCapture,
  isExactKfcMessageEndpoint,
  type KfcMessageRouteCapture,
} from "./deployed-browser-proof-route-capture.js";
import { resolveDeployedBrowserProofLiveTimeoutMs } from "./deployed-browser-proof-timeouts.js";

const sensitiveKeyPattern = /(?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|(?:customer|user|order|session|conversation|message|external|item)[ _-]?(?:id|identifier)|^id$)/i;

interface ScenarioTurn {
  index: number;
  speaker: "User" | "Bot";
  text: string;
}

interface ScenarioScript {
  id: string;
  title: string;
  goal: string;
  channel: string;
  useCases: string[];
  finalState: string;
  expectations: string[];
  turns: ScenarioTurn[];
}

interface ScenarioBrowserContext {
  context: BrowserContext;
  capture: KfcMessageRouteCapture;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const scenariosRoot = join(root, "ai-talent-tracks/fnb/conversations");
const chatbotUrl = requiredEnv("KFC_CHATBOT_URL").replace(/\/$/, "");
const chatbotMessageEndpoint = new URL("/chat/kfc/message", chatbotUrl);
const monitorUrl = requiredEnv("KFC_MONITOR_URL").replace(/\/$/, "");
const runId = requiredEnv("KFC_PROOF_RUN_ID");
const outputDir = resolve(requiredEnv("KFC_PROOF_OUTPUT_DIR"));
const liveTurnTimeoutMs = resolveDeployedBrowserProofLiveTimeoutMs();
const chromePath =
  process.env.KFC_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const expectedRelease = JSON.parse(
  await readFile(requiredEnv("KFC_EXPECTED_RELEASE_FILE"), "utf8"),
) as { gitSha: string; releaseBuiltAt: string; dirty: boolean };
const demoAdminToken = requiredEnv("KFC_DEMO_ADMIN_TOKEN");

await mkdir(outputDir, { recursive: true });
const scenarioFiles = await readdir(scenariosRoot);
const scripts = await Promise.all(
  scenarioFiles
    .filter((name) => /^\d{2}-.*\.json$/.test(name))
    .sort()
    .map(async (name) =>
      JSON.parse(await readFile(join(scenariosRoot, name), "utf8")) as ScenarioScript,
    ),
);
const scenarioIdFilter = process.env.KFC_PROOF_SCENARIO_ID;
const selectedScripts = scenarioIdFilter
  ? scripts.filter((script) => script.id === scenarioIdFilter)
  : scripts;
if ((!scenarioIdFilter && scripts.length !== 9) || selectedScripts.length === 0) {
  throw new Error(`Expected 9 JSON scenarios, found ${scripts.length}`);
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const results: Array<Record<string, unknown>> = [];
try {
  await assertRelease(chatbotUrl);
  await assertRelease(monitorUrl);

  await mapWithConcurrency(selectedScripts, 3, async (script) => {
    const customerId = `anon_customer_${safeId(runId)}_${safeId(script.id)}`;
    const sessionId = `kfc:${customerId}`;
    const userTurns = script.turns.filter((item) => item.speaker === "User");
    let scenarioContext = await createScenarioContext(customerId, mockedUpstreamApiForTurn(script.id, userTurns[0]?.index ?? 1));
    let context = scenarioContext.context;
    let capture = scenarioContext.capture;
    let page = await context.newPage();
    const turnResults: Array<Record<string, unknown>> = [];
    let lastState: Record<string, unknown> = {};
    try {
      for (const [turnOffset, turn] of userTurns.entries()) {
        if (turnOffset > 0) {
          capture.dispose();
          await context.close();
          scenarioContext = await createScenarioContext(customerId, mockedUpstreamApiForTurn(script.id, turn.index));
          context = scenarioContext.context;
          capture = scenarioContext.capture;
          page = await context.newPage();
        }
        await page.goto(chatbotUrl, { waitUntil: "domcontentloaded", timeout: liveTurnTimeoutMs });
        await enableFlutterSemantics(page);
        const input = page.locator('input[aria-label="Nhắn KFC..."]').last();
        await input.waitFor({ state: "attached", timeout: liveTurnTimeoutMs });
        await waitForComposerReady(page);
        await typeComposerDraft(page, input, turn.text);
        const submission = await submitComposerTurn(page, input, capture, {
          submitResponseTimeoutMs: liveTurnTimeoutMs,
        });
        if (submission.response.status() !== 200) {
          throw new Error(
            `${script.id} turn ${turn.index} failed: HTTP ${submission.response.status()}`,
          );
        }
        const responseBody = await resolveChatResponseBody({
          response: submission.response,
          captured: submission.captured,
          scenarioId: script.id,
          turnIndex: turn.index,
        });
        lastState = responseBody.state ?? {};
        await page.waitForTimeout(1_500);
        await waitForComposerReady(page);
        const screenshot = join(
          outputDir,
          `${safeId(script.id)}-turn-${turn.index}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        turnResults.push({
          index: turn.index,
          responseStatus: submission.response.status(),
          responseUrl: submission.response.url(),
          screenshot,
        });
      }

      const encodedSession = encodeURIComponent(sessionId);
      const turnsResponse = await context.request.get(
        `${monitorUrl}/dashboard/sessions/${encodedSession}/turns`,
      );
      const eventsResponse = await context.request.get(
        `${monitorUrl}/dashboard/events/${encodedSession}`,
      );
      const sessionsResponse = await context.request.get(
        `${monitorUrl}/dashboard/sessions`,
      );
      if (!turnsResponse.ok() || !eventsResponse.ok() || !sessionsResponse.ok()) {
        throw new Error(`${script.id} durable evidence endpoint failed`);
      }
      const turnsBody = (await turnsResponse.json()) as { turns?: unknown[] };
      const eventsBody = (await eventsResponse.json()) as {
        events?: Array<{ type?: string; payload?: unknown }>;
      };
      const sessionsBody = (await sessionsResponse.json()) as {
        sessions?: Array<{ sessionId?: string }>;
      };
      if (!sessionsBody.sessions?.some((item) => item.sessionId === sessionId)) {
        throw new Error(`${script.id} missing from deployed monitor sessions`);
      }
      if (!eventsBody.events?.some((event) => event.type === "assistant_reply_sent")) {
        throw new Error(`${script.id} missing assistant_reply_sent evidence`);
      }
      if (
        !eventsBody.events?.some(
          (event) => event.type === "session_intelligence_updated",
        )
      ) {
        throw new Error(`${script.id} missing session_intelligence_updated evidence`);
      }
      results.push({
        scenarioId: script.id,
        sessionId,
        useCases: script.useCases,
        turns: turnResults,
        durableTurnCount: turnsBody.turns?.length ?? 0,
        durableEventCount: eventsBody.events?.length ?? 0,
        evidence: buildOutcomeEvidence({
          script,
          turns: turnsBody.turns ?? [],
          events: eventsBody.events ?? [],
          state: lastState,
        }),
      });
    } catch (error) {
      const failureScreenshot = join(outputDir, `${safeId(script.id)}-failure.png`);
      await page.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
      await writeFile(
        join(outputDir, `${safeId(script.id)}-failure.json`),
        `${JSON.stringify({
          scenarioId: script.id,
          sessionId,
          url: page.url(),
          error: error instanceof Error ? error.stack ?? error.message : String(error),
          screenshot: failureScreenshot,
        }, null, 2)}\n`,
      );
      throw error;
    } finally {
      capture.dispose();
      await context.close();
    }
  });

  const monitorContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    deviceScaleFactor: 1,
  });
  try {
    const monitorPage = await monitorContext.newPage();
    await monitorPage.goto(monitorUrl, { waitUntil: "domcontentloaded", timeout: liveTurnTimeoutMs });
    await monitorPage.screenshot({
      path: join(outputDir, "monitor-all-scenarios.png"),
      fullPage: true,
    });
  } finally {
    await monitorContext.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  join(outputDir, "browser-proof.json"),
  `${JSON.stringify({
    runId,
    expectedRelease,
    scenarios: results.sort((left, right) =>
      String(left.scenarioId).localeCompare(String(right.scenarioId)),
    ),
  }, null, 2)}\n`,
);

await writeFile(
  join(outputDir, "outcome-evidence.json"),
  `${JSON.stringify({
    runId,
    expectedRelease,
    scenarios: results
      .map((result) => result.evidence)
      .sort((left, right) => String((left as { scenarioId: string }).scenarioId).localeCompare(String((right as { scenarioId: string }).scenarioId))),
  }, null, 2)}\n`,
);

function buildOutcomeEvidence(input: {
  script: ScenarioScript;
  turns: unknown[];
  events: Array<{ type?: string; payload?: unknown }>;
  state: Record<string, unknown>;
}): Record<string, unknown> {
  const durableTurns = input.turns
    .filter((turn): turn is Record<string, unknown> => Boolean(turn) && typeof turn === "object")
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({
      role: turn.role,
      text: redactText(typeof turn.text === "string" ? turn.text : "[missing turn text]"),
    }));
  const genUiAttachments = input.turns
    .map((turn) => (turn && typeof turn === "object" ? (turn as Record<string, unknown>).metadata : undefined))
    .filter((metadata): metadata is Record<string, unknown> => Boolean(metadata) && typeof metadata === "object")
    .map((metadata) => metadata.genUi)
    .filter((genUi): genUi is Record<string, unknown> => Boolean(genUi) && typeof genUi === "object")
    .map((genUi) => ({
      widgetKind: typeof genUi.widgetKind === "string" ? genUi.widgetKind : "unknown",
      actionIds: Array.isArray(genUi.actions)
        ? genUi.actions
            .filter((action): action is Record<string, unknown> => Boolean(action) && typeof action === "object")
            .map((action) => action.id)
            .filter((id): id is string => typeof id === "string")
        : [],
      values: redactValue(genUi.data ?? {}),
    }));
  const toolTrace = Array.isArray(input.state.toolTrace)
    ? input.state.toolTrace
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          toolName: typeof entry.toolName === "string" ? entry.toolName : "unknown",
          status: typeof entry.status === "string" ? entry.status : "observed",
          resultSummary: summarize(entry),
        }))
    : [];

  return {
    scenarioId: input.script.id,
    finalState: input.script.finalState,
    useCases: input.script.useCases,
    expectations: input.script.expectations,
    turns: durableTurns,
    toolTrace,
    genUiAttachments,
    monitorEvents: input.events
      .filter((event) => typeof event.type === "string")
      .map((event) => ({
        type: event.type,
        payloadSummary: summarize(event.payload ?? {}),
      })),
  };
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }
  return value;
}

function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b((?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|(?:customer|user|order|session|conversation|message|external|item)[ _-]?(?:id|identifier)))(\s*(?::|=)\s*|\s+is\s+)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)/gi, "$1$2[REDACTED]");
}

function summarize(value: unknown): string {
  return redactText(JSON.stringify(redactValue(value)) ?? "{}");
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await run(item);
      }
    }),
  );
}

async function assertRelease(baseUrl: string): Promise<void> {
  const releaseProbeAttempts = 6;
  let lastError: unknown;
  for (let attempt = 1; attempt <= releaseProbeAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/release.json`, {
        headers: { "cache-control": "no-cache" },
      });
      if (!response.ok) throw new Error(`${baseUrl}/release.json returned ${response.status}`);
      const actual = (await response.json()) as typeof expectedRelease;
      if (JSON.stringify(actual) !== JSON.stringify(expectedRelease)) {
        throw new Error(
          `Release mismatch for ${baseUrl}: ${JSON.stringify(actual)} != ${JSON.stringify(expectedRelease)}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < releaseProbeAttempts) await delay(5_000);
    }
  }
  throw lastError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function enableFlutterSemantics(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector('input[aria-label="Nhắn KFC..."]') ??
      document.querySelector("flt-semantics-placeholder"),
    ), undefined, { timeout: liveTurnTimeoutMs });
  await page.evaluate(() => {
    if (document.querySelector('input[aria-label="Nhắn KFC..."]')) return;
    const placeholder = document.querySelector("flt-semantics-placeholder");
    if (placeholder) (placeholder as HTMLElement).click();
  });
}

async function createScenarioContext(
  customerId: string,
  mockedUpstreamApi?: Record<string, unknown>,
): Promise<ScenarioBrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: "kfc_customer_chat_anonymous_id", value: customerId },
  );
  const capture = createKfcMessageRouteCapture(chatbotUrl, { routeFetchTimeoutMs: liveTurnTimeoutMs, adminToken: demoAdminToken, mockedUpstreamApi });
  await context.route(
    (url) =>
      url.origin === chatbotMessageEndpoint.origin &&
      url.pathname === chatbotMessageEndpoint.pathname,
    (route) => capture.intercept(route),
  );
  return { context, capture };
}

function mockedUpstreamApiForTurn(scenarioId: string, turnIndex: number): Record<string, unknown> | undefined {
  if (scenarioId !== "03-ton-kho-dia-chi-va-cua-hang") return undefined;
  if (turnIndex === 1) return { unavailableItemCodes: ["41140", "20700", "20751", "40969"] };
  if (turnIndex === 5) return { deliveryEtaMinutes: 45 };
  if (turnIndex === 7) return { unavailableItemCodes: ["41141"] };
  return undefined;
}

async function waitForComposerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Nhắn KFC..."]');
    return input instanceof HTMLInputElement && !input.disabled;
  }, undefined, { timeout: liveTurnTimeoutMs });
}

async function typeComposerDraft(
  page: Page,
  input: Locator,
  text: string,
): Promise<void> {
  await input.click();
  await page.keyboard.insertText(text);
  await page.waitForFunction(
    (expected) => {
      const candidate = document.querySelector('input[aria-label="Nhắn KFC..."]');
      return candidate instanceof HTMLInputElement && candidate.value === expected;
    },
    text,
    { timeout: liveTurnTimeoutMs },
  );
  await page.waitForTimeout(500);
}

async function submitComposerTurn(
  page: Page,
  input: Locator,
  capture: KfcMessageRouteCapture,
  options: { submitResponseTimeoutMs: number },
): Promise<{ response: Response; captured: CapturedChatResponse | null }> {
  const activators = [
    async () => {
      const box = await input.boundingBox();
      if (!box) throw new Error("KFC composer has no visible bounding box");
      await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
    },
    () => input.press("Enter"),
    () => page.locator('flt-semantics[role="button"]').last().click(),
  ];
  const submitResponseTimeoutMs = options.submitResponseTimeoutMs;
  let lastError: unknown;
  for (const activate of activators) {
    try {
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "POST" &&
            isExactKfcMessageEndpoint(candidate.url(), chatbotUrl) &&
            isExactKfcMessageEndpoint(candidate.request().url(), chatbotUrl),
          { timeout: submitResponseTimeoutMs },
        ),
        activate(),
      ]);
      const captured = capture.takeForResponse(response);
      return { response, captured };
    } catch (error) {
      lastError = error;
    }
  }
  if (isTimeoutError(lastError)) {
    throw new Error(
      `Timed out after ${submitResponseTimeoutMs}ms waiting for POST /chat/kfc/message after submit activation attempts`,
      { cause: lastError },
    );
  }
  throw lastError;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("timeout") && message.includes("exceeded");
}
