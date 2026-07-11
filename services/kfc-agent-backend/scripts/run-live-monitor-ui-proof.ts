import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildServer } from "../src/api/server.js";
import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from "../src/llm/toolPlanner.js";
import { DashboardEventBus } from "../src/dashboard/eventBus.js";
import { MemoryStore } from "../src/persistence/memoryStore.js";

const repoRoot = resolve(process.cwd(), "../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = resolve(repoRoot, "artifacts/monitor-live-proof", runId);
const screenshotRoot = resolve(artifactRoot, "screenshots");

class LiveMonitorProofPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const text = input.state.latestUserMessage.toLowerCase();
    if (text.includes("nhân viên") || text.includes("khiếu nại") || text.includes("thiếu món")) {
      return {
        intent: "handoff",
        entities: {},
        toolCalls: [{ toolName: "handoff", arguments: { reasons: ["angry_customer", "human_requested"] } }],
        responseClaims: [],
        directResponse: "Mình sẽ chuyển bạn đến nhân viên hỗ trợ ngay.",
      };
    }
    return { intent: "unclear", entities: {}, toolCalls: [], responseClaims: [], directResponse: "Mình đã ghi nhận thông tin của bạn." };
  }
}

function messengerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  if (url.includes("/profile")) {
    return Promise.resolve(new Response(JSON.stringify({ first_name: "Nguyen", last_name: "An" }), { status: 200 }));
  }
  if (typeof body.sender_action === "string") {
    return Promise.resolve(new Response(JSON.stringify({ recipient_id: "local-proof-user" }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ message_id: `local_messenger_${Date.now()}` }), { status: 200 }));
}

function zaloFetch(_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ error: 0, message_id: `local_zalo_${Date.now()}` }), { status: 200 }));
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

await mkdir(screenshotRoot, { recursive: true });
const server = buildServer({
  metaPageId: "118976205445198",
  messengerVerifyToken: "local_verify",
  messengerPageAccessToken: "local_page_token",
  metaInboxUrlTemplate:
    "https://business.facebook.local/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
  messengerGraphApiBaseUrl: "https://graph.local",
  messengerFetchImpl: messengerFetch,
  zaloOaId: "oa_local",
  zaloAccessToken: "local_zalo_token",
  zaloInboxUrlTemplate:
    "https://oa.zalo.local/chatv2?oaid={pageId}&uid={externalUserId}",
  zaloApiBaseUrl: "https://zalo.local",
  zaloFetchImpl: zaloFetch,
  toolPlanner: new LiveMonitorProofPlanner(),
  store: new MemoryStore(),
  dashboard: new DashboardEventBus(),
  readiness: {
    database: async () => ({ ok: true }),
    openAiConfigured: false,
    openAiRequired: false,
  },
});

if (process.argv.includes("--serve-only")) {
  await server.listen({ host: "127.0.0.1", port: 18090 });
  console.log(JSON.stringify({ mode: "serve-only", backendUrl: "http://127.0.0.1:18090" }));
  await new Promise<void>((resolveServer) => {
    const shutdown = async () => {
      await server.close();
      resolveServer();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  process.exit(0);
}

let backendUrl = "";
let status = 1;
try {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve local backend address");
  backendUrl = `http://127.0.0.1:${address.port}`;
  status = await run(
    "flutter",
    [
      "test",
      "--no-pub",
      "integration_test/live_monitor_conversation_test.dart",
      "-d",
      "macos",
      `--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`,
      `--dart-define=KFC_GENUI_SCREENSHOT_DIR=${screenshotRoot}`,
    ],
    resolve(repoRoot, "apps/kfc_live_monitor_flutter"),
  );
} finally {
  await server.close();
}

const manifest = {
  runId,
  mode: "local_live_backend_with_channel_transport_stubs",
  backendUrl,
  screenshotRoot,
  status,
  scope: ["Messenger monitor UI", "Zalo display parity", "warning -> human joined -> AI handling"],
};
await writeFile(resolve(artifactRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
if (status !== 0) process.exitCode = status;
