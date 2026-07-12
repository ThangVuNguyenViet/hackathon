import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const backendUrl = requiredEnv("KFC_AGENT_BACKEND_URL").replace(/\/$/, "");
const monitorUrl = requiredEnv("KFC_MONITOR_URL").replace(/\/$/, "");
const psid = requiredEnv("KFC_MESSENGER_PSID");
const sessionId = `messenger:${psid}`;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = resolve(
  process.env["KFC_PROOF_OUTPUT_DIR"] ??
    `../../artifacts/warning-escalation-proof/${runId}`,
);
const videoDir = resolve(outputDir, "video");
const pageId = process.env["KFC_META_PAGE_ID"] ?? "118976205445198";
const messages = [
  "Mình nhận thiếu 1 phần khoai.",
  "Với lại mình đặt gà cay mà giao gà thường.",
  "Đơn gì mà lâu quá vậy, bực mình thật.",
  "Cho mình gặp nhân viên.",
];

await mkdir(videoDir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env["KFC_CHROME_PATH"] ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
  recordVideo: { dir: videoDir, size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const video = page.video();
const checkpoints: Array<Record<string, unknown>> = [];

try {
  await page.goto(monitorUrl, { waitUntil: "networkidle" });
  await enableFlutterSemantics();
  await page.waitForTimeout(3_000);
  await checkpoint("initial");

  for (const [index, text] of messages.entries()) {
    const messageId = `proof_${runId}_${index + 1}`;
    await postMessenger(messageId, text);
    await waitForMessageProcessed(messageId);
    await page.waitForTimeout(1_500);
  }
  await waitForEvent("handoff_required");
  await page.waitForTimeout(2_500);
  await checkpoint("warning_escalation");

  await postJson(`/dashboard/sessions/${encodeURIComponent(sessionId)}/human-join`, {
    agentId: "agent_video_proof",
  });
  await waitForAgentMode("human_paused");
  await page.waitForTimeout(2_500);
  await checkpoint("human_joined");

  const pausedMessageId = `proof_${runId}_paused`;
  await postMessenger(pausedMessageId, "Có ai xử lý chưa?");
  await waitForSkippedMessage(pausedMessageId);
  await postJson(`/dashboard/sessions/${encodeURIComponent(sessionId)}/human-message`, {
    agentId: "agent_video_proof",
    text: "Em là nhân viên KFC, em đang kiểm tra đơn cho anh/chị.",
  });
  await waitForSessionUpdate("human_message_sent");
  await page.waitForTimeout(2_500);
  await checkpoint("human_reply");

  await postJson(`/dashboard/sessions/${encodeURIComponent(sessionId)}/resume-ai`, {
    agentId: "agent_video_proof",
  });
  await waitForAgentMode("ai_active");
  await page.waitForTimeout(2_500);
  await checkpoint("ai_resumed");

  const afterResumeMessageId = `proof_${runId}_after_resume`;
  await postMessenger(afterResumeMessageId, "Ok, tiếp tục giúp tôi.");
  await waitForMessageProcessed(afterResumeMessageId);
  await page.waitForTimeout(3_000);
  await checkpoint("post_resume_ai_reply");
} finally {
  await context.close();
  await browser.close();
}

const videoPath = await video?.path();
const sessions = await getJson("/dashboard/sessions") as {
  sessions?: Array<Record<string, unknown>> | undefined;
};
const session = sessions.sessions?.find((candidate) => candidate["sessionId"] === sessionId);
const events = await getJson(`/dashboard/events/${encodeURIComponent(sessionId)}`) as {
  events?: Array<Record<string, unknown>> | undefined;
};
const manifest = {
  runId,
  sessionId,
  backendUrl,
  monitorUrl,
  videoPath,
  checkpoints,
  finalSession: session ?? null,
  eventTypes: events.events?.map((event) => event["type"]) ?? [],
};
await writeFile(
  resolve(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));

async function enableFlutterSemantics(): Promise<void> {
  await page.evaluate(() => {
    const placeholder = document.querySelector("flt-semantics-placeholder");
    if (placeholder instanceof HTMLElement) placeholder.click();
  });
}

async function checkpoint(step: string): Promise<void> {
  const screenshot = resolve(outputDir, `${step}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  const session = await currentSession();
  checkpoints.push({
    step,
    screenshot,
    agentMode: session?.["agentMode"] ?? null,
    intelligence: session?.["sessionIntelligence"] ?? null,
  });
}

async function postMessenger(messageId: string, text: string): Promise<void> {
  await postJson("/webhooks/messenger", {
    object: "page",
    entry: [{
      id: pageId,
      messaging: [{
        sender: { id: psid },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message: { mid: messageId, text },
      }],
    }],
  });
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${backendUrl}${path}`, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function currentSession(): Promise<Record<string, unknown> | undefined> {
  const body = await getJson("/dashboard/sessions") as {
    sessions?: Array<Record<string, unknown>> | undefined;
  };
  return body.sessions?.find((candidate) => candidate["sessionId"] === sessionId);
}

async function waitForEvent(type: string): Promise<void> {
  await waitUntil(async () => {
    const body = await getJson(`/dashboard/events/${encodeURIComponent(sessionId)}`) as {
      events?: Array<{ type?: string | undefined }> | undefined;
    };
    return body.events?.some((event) => event.type === type) ?? false;
  }, `event ${type}`);
}

async function waitForSessionUpdate(updateType: string): Promise<void> {
  await waitUntil(async () => {
    const body = await getJson(`/dashboard/events/${encodeURIComponent(sessionId)}`) as {
      events?: Array<{ type?: string | undefined; payload?: Record<string, unknown> | undefined }> | undefined;
    };
    return body.events?.some(
      (event) => event.type === "session_updated" && event.payload?.["updateType"] === updateType,
    ) ?? false;
  }, `session update ${updateType}`);
}

async function waitForMessageProcessed(messageId: string): Promise<void> {
  await waitUntil(async () => {
    const body = await getJson(`/dashboard/events/${encodeURIComponent(sessionId)}`) as {
      events?: Array<{ type?: string | undefined; payload?: Record<string, unknown> | undefined }> | undefined;
    };
    const events = body.events ?? [];
    const customerIndex = events.findIndex(
      (event) =>
        event.type === "customer_message_received" &&
        event.payload?.["externalMessageId"] === messageId,
    );
    return (
      customerIndex >= 0 &&
      events.slice(customerIndex + 1).some((event) => event.type === "assistant_reply_sent")
    );
  }, `processed message ${messageId}`);
}

async function waitForSkippedMessage(messageId: string): Promise<void> {
  await waitUntil(async () => {
    const body = await getJson(`/dashboard/events/${encodeURIComponent(sessionId)}`) as {
      events?: Array<{ type?: string | undefined; payload?: Record<string, unknown> | undefined }> | undefined;
    };
    return body.events?.some(
      (event) =>
        event.type === "assistant_reply_skipped" &&
        event.payload?.["externalMessageId"] === messageId,
    ) ?? false;
  }, `skipped paused message ${messageId}`);
}

async function waitForAgentMode(mode: string): Promise<void> {
  await waitUntil(async () => (await currentSession())?.["agentMode"] === mode, `agent mode ${mode}`);
}

async function waitUntil(
  condition: () => Promise<boolean>,
  label: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
