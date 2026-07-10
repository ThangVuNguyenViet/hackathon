import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright-core";

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
const root = resolve(here, "../../../..");
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
if (scripts.length !== 9) {
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

  for (const script of scripts) {
    const customerId = `anon_customer_${safeId(runId)}_${safeId(script.id)}`;
    const sessionId = `kfc:${customerId}`;
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
    const page = await context.newPage();
    const turnResults: Array<Record<string, unknown>> = [];
    try {
      await page.goto(chatbotUrl, { waitUntil: "networkidle" });
      await enableFlutterSemantics(page);
      for (const turn of script.turns.filter((item) => item.speaker === "User")) {
        const responsePromise = page.waitForResponse(
          (response) =>
            response.url().includes("/chat/kfc/message") &&
            response.request().method() === "POST",
          { timeout: 120_000 },
        );
        const input = page.locator("textarea").last();
        await input.waitFor({ state: "attached", timeout: 30_000 });
        await input.fill(turn.text);
        await input.press("Enter");
        const response = await responsePromise;
        const body = (await response.json()) as Record<string, unknown>;
        if (response.status() !== 200 || body.sessionId !== sessionId) {
          throw new Error(
            `${script.id} turn ${turn.index} failed: HTTP ${response.status()} ${JSON.stringify(body)}`,
          );
        }
        const screenshot = join(
          outputDir,
          `${safeId(script.id)}-turn-${turn.index}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        turnResults.push({
          index: turn.index,
          responseStatus: response.status(),
          userTurnId: body.userTurnId,
          assistantTurnId: body.assistantTurnId,
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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
