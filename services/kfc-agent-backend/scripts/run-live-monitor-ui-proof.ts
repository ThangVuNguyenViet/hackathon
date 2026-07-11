import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "../src/api/server.js";
import { buildServerOptionsFromEnv } from "../src/api/serverOptions.js";
import { loadEnv } from "../src/config/env.js";
import { DashboardEventBus } from "../src/dashboard/eventBus.js";
import { MemoryStore } from "../src/persistence/memoryStore.js";

const repoRoot = resolve(process.cwd(), "../..");
loadWorkspaceEnv(resolve(repoRoot, "../../.env"));
const env = loadEnv(process.env);
const device = process.env.KFC_MONITOR_FLUTTER_DEVICE?.trim() || "macos";
const screenshotDir =
  process.env.KFC_MONITOR_SCREENSHOT_DIR?.trim() ||
  resolve(repoRoot, "artifacts/live-monitor-proof", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(screenshotDir, { recursive: true });
for (const suite of [
  "live_monitor_primary_screen",
  "live_monitor_history_polling",
  "live_monitor_channel_parity",
  "live_monitor_angry_handoff",
]) {
  mkdirSync(resolve(screenshotDir, suite), { recursive: true });
}

if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) {
  throw new Error("META_PAGE_ID and META_PAGE_ACCESS_TOKEN are required in the workspace .env");
}

const baseOptions = buildServerOptionsFromEnv(env);
const server = buildServer({
  ...baseOptions,
  store: new MemoryStore(),
  dashboard: new DashboardEventBus(),
  messengerFetchImpl: createMessengerProofFetch(),
  zaloFetchImpl: createZaloProofFetch(),
  readiness: {
    ...baseOptions.readiness,
    database: async () => ({ ok: true }),
    zaloRequired: false,
  },
});

let flutterExitCode = 1;
try {
  const serverUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  console.log(`KFC_MONITOR_BACKEND_URL=${serverUrl}`);
  console.log(`KFC_MONITOR_DEVICE=${device}`);
  console.log(`KFC_MONITOR_SCREENSHOTS=${screenshotDir}`);
  flutterExitCode = await runFlutterIntegration(serverUrl, device, screenshotDir);
} finally {
  await server.close();
}

process.exitCode = flutterExitCode;

function createMessengerProofFetch(): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      const recipientId = (body.recipient as { id?: string } | undefined)?.id ?? "proof-user";
      return new Response(
        JSON.stringify(body.sender_action ? { recipient_id: recipientId } : { message_id: `proof-message-${Date.now()}` }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const recipientId = url.split("/").at(-1)?.split("?")[0] ?? "proof-user";
    return new Response(
      JSON.stringify({ id: recipientId, first_name: "Nguyen", last_name: "An", profile_pic: null }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function createZaloProofFetch(): typeof fetch {
  return async (_input, init) =>
    new Response(JSON.stringify(init?.method === "POST" ? { message_id: `proof-zalo-${Date.now()}` } : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

async function runFlutterIntegration(backendUrl: string, targetDevice: string, outputDir: string): Promise<number> {
  const child = spawn(
    "flutter",
    [
      "test",
      "--no-pub",
      "integration_test/live_monitor_conversation_test.dart",
      "-d",
      targetDevice,
      `--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`,
      `--dart-define=KFC_GENUI_SCREENSHOT_DIR=${outputDir}`,
    ],
    { cwd: resolve(repoRoot, "apps/kfc_live_monitor_flutter"), stdio: "inherit", env: process.env },
  );
  return new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

function loadWorkspaceEnv(path: string): void {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const raw = match[2].trim();
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}
