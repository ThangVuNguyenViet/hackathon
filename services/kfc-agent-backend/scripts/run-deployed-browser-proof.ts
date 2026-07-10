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

interface ScenarioTurn {
  index: number;
  speaker: "User" | "Bot";
  text: string;
}

interface ScenarioScript {
  id: string;
  useCases: string[];
  turns: ScenarioTurn[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const scenariosRoot = join(root, "ai-talent-tracks/fnb/conversations");
const chatbotUrl = requiredEnv("KFC_CHATBOT_URL").replace(/\/$/, "");
const monitorUrl = requiredEnv("KFC_MONITOR_URL").replace(/\/$/, "");
const runId = requiredEnv("KFC_PROOF_RUN_ID");
const outputDir = resolve(requiredEnv("KFC_PROOF_OUTPUT_DIR"));
const chromePath =
  process.env.KFC_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const expectedRelease = JSON.parse(
  await readFile(requiredEnv("KFC_EXPECTED_RELEASE_FILE"), "utf8"),
) as { gitSha: string; releaseBuiltAt: string; dirty: boolean };

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

  for (const script of selectedScripts) {
    const customerId = `anon_customer_${safeId(runId)}_${safeId(script.id)}`;
    const sessionId = `kfc:${customerId}`;
    let context = await createScenarioContext(customerId);
    let page = await context.newPage();
    const turnResults: Array<Record<string, unknown>> = [];
    try {
      const userTurns = script.turns.filter((item) => item.speaker === "User");
      for (const [turnOffset, turn] of userTurns.entries()) {
        if (turnOffset > 0) {
          await context.close();
          context = await createScenarioContext(customerId);
          page = await context.newPage();
        }
        await page.goto(chatbotUrl, { waitUntil: "networkidle" });
        await enableFlutterSemantics(page);
        const input = page.locator('input[aria-label="Nhắn KFC..."]').last();
        await input.waitFor({ state: "attached", timeout: 30_000 });
        await waitForComposerReady(page);
        await typeComposerDraft(page, input, turn.text);
        const response = await submitComposerTurn(page, input);
        if (response.status() !== 200) {
          throw new Error(
            `${script.id} turn ${turn.index} failed: HTTP ${response.status()}`,
          );
        }
        await page.waitForTimeout(1_500);
        await waitForComposerReady(page);
        const screenshot = join(
          outputDir,
          `${safeId(script.id)}-turn-${turn.index}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        turnResults.push({
          index: turn.index,
          responseStatus: response.status(),
          responseUrl: response.url(),
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
        events?: Array<{ type?: string }>;
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
      await context.close();
    }
  }

  const monitorContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    deviceScaleFactor: 1,
  });
  try {
    const monitorPage = await monitorContext.newPage();
    await monitorPage.goto(monitorUrl, { waitUntil: "networkidle" });
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
  `${JSON.stringify({ runId, expectedRelease, scenarios: results }, null, 2)}\n`,
);

async function assertRelease(baseUrl: string): Promise<void> {
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
}

async function enableFlutterSemantics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const placeholder = document.querySelector("flt-semantics-placeholder");
    if (placeholder instanceof HTMLElement) placeholder.click();
  });
}

async function createScenarioContext(customerId: string): Promise<BrowserContext> {
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
  return context;
}

async function waitForComposerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Nhắn KFC..."]');
    return input instanceof HTMLInputElement && !input.disabled;
  }, undefined, { timeout: 30_000 });
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
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
}

async function submitComposerTurn(page: Page, input: Locator): Promise<Response> {
  const activators = [
    () => input.press("Enter"),
    async () => {
      const box = await input.boundingBox();
      if (!box) throw new Error("KFC composer has no visible bounding box");
      await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
    },
    () => page.locator('flt-semantics[role="button"]').last().click(),
  ];
  let lastError: unknown;
  for (const activate of activators) {
    try {
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.url().includes("/chat/kfc/message") &&
            candidate.request().method() === "POST",
          { timeout: 45_000 },
        ),
        activate(),
      ]);
      return response;
    } catch (error) {
      lastError = error;
    }
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
