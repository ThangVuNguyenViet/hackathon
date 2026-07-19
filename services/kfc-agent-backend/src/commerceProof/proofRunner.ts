import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Client, RunTree } from "langsmith";
import type { Run } from "langsmith/schemas";
import catalogPayload from "../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json" with { type: "json" };
import { buildServer } from "../api/server.js";
import { createKfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import { loadBundledGeneratedFixtures } from "../fixtures/bundledFixtures.js";
import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from "../llm/toolPlanner.js";
import type { ResponseComposer } from "../llm/responseComposer.js";
import { createMockClients } from "../mock/createMockClients.js";
import type { ToolTraceEntry } from "../ordering/types.js";
import { commerceContractVersion, sandboxCommerceProofProviderProvenance, type CommerceCommand, type CommerceResult } from "./contracts.js";
import { evaluateCommerceProofScenario } from "./evaluators.js";
import { buildCommerceProofGatewayServer } from "./gatewayServer.js";
import { buildCommerceProofMockOmsServer } from "./mockOmsServer.js";
import { buildCommerceProofMockPosServer } from "./mockPosServer.js";
import { commerceProofScenarioIds } from "./scenarios.js";
import { buildCommerceProofTraceCollector } from "./traceCollector.js";
import type { SafeTraceEvent } from "./traceEvents.js";

export interface MockCommerceProofOptions {
  artifactRoot: string;
  requireLangSmith: boolean;
  timeoutMs?: number;
  timeoutScenarioDelayMs?: number;
  responseComposer?: ResponseComposer;
}

export interface MockCommerceProofManifest {
  runId: string;
  generatedAt: string;
  passed: boolean;
  scenarioCount: number;
  commerceEnvironment: "sandbox";
  providerProvenance: CommerceResult["providerProvenance"];
  readiness: Record<"agent" | "gateway" | "oms" | "pos", "ready" | "unavailable">;
  scenarios: Array<{
    scenarioId: string;
    passed: boolean;
    outcome: CommerceResult["outcome"];
    entryPath: "kfc-agent-backend" | "gateway-api";
    limitation?: string;
    traceId: string;
    langsmithUrl?: string;
  }>;
  langsmith: {
    required: boolean;
    status: "not_required" | "exported";
    project?: string;
  };
  shutdown: { complete: boolean; openServices: string[] };
}

export async function runMockCommerceProof(
  options: MockCommerceProofOptions,
): Promise<MockCommerceProofManifest> {
  const langsmithApiKey = process.env.LANGSMITH_API_KEY?.trim();
  if (options.requireLangSmith && !langsmithApiKey) {
    throw new Error("LANGSMITH_API_KEY is required for the commerce proof presentation gate");
  }
  const langsmithProject = process.env.LANGSMITH_PROJECT?.trim() || "kfc-commerce-proof";
  const langsmithClient = options.requireLangSmith ? new Client({ apiKey: langsmithApiKey }) : undefined;

  const runId = `mock-commerce-${Date.now()}`;
  const tokens = {
    gateway: crypto.randomUUID(),
    oms: crypto.randomUUID(),
    omsAdmin: crypto.randomUUID(),
    pos: crypto.randomUUID(),
    posAdmin: crypto.randomUUID(),
    collector: crypto.randomUUID(),
  };
  const servers: Array<{ name: string; server: FastifyInstance }> = [];
  const resultByScenario = new Map<string, CommerceResult>();
  const agentEvidenceByScenario = new Map<string, AgentEvidence>();
  const collector = buildCommerceProofTraceCollector({ token: tokens.collector, runId });
  let manifest: MockCommerceProofManifest | undefined;

  try {
    const oms = buildCommerceProofMockOmsServer({ token: tokens.oms, adminToken: tokens.omsAdmin });
    const pos = buildCommerceProofMockPosServer({ token: tokens.pos, adminToken: tokens.posAdmin });
    const omsBaseUrl = await listen(servers, "oms", oms);
    const posBaseUrl = await listen(servers, "pos", pos);
    const gateway = buildCommerceProofGatewayServer({
      token: tokens.gateway,
      oms: { baseUrl: omsBaseUrl, token: tokens.oms },
      pos: { baseUrl: posBaseUrl, token: tokens.pos },
      timeoutMs: options.timeoutMs ?? 3000,
      readinessTimeoutMs: 3000,
      onResult: (result) => {
        if (
          result.outcome === "deduplicated" &&
          result.scenarioId !== "duplicate-command" &&
          resultByScenario.has(result.scenarioId)
        ) {
          return;
        }
        resultByScenario.set(result.scenarioId, result);
      },
    });
    const gatewayBaseUrl = await listen(servers, "gateway", gateway);
    const proofProvider = createMockClients(loadBundledGeneratedFixtures(), {
      fulfillmentQuoteProvider: async () => ({
        ok: true,
        value: { feeVnd: 18000, etaMinutes: 25 },
        message: "proof_fulfillment_quote",
      }),
    });
    const agent = buildServer({
      messengerVerifyToken: "proof-messenger-verify",
      metaAppSecret: "proof-meta-app-secret",
      metaPageId: "proof-page",
      messengerPageAccessToken: "proof-page-token",
      metaInboxUrlTemplate: "https://example.invalid/{externalUserId}",
      toolPlanner: new CommerceProofPlanner(),
      responseComposer: options.responseComposer,
      kfcCommerceGateway: createKfcCommerceGatewayClients({
        baseUrl: gatewayBaseUrl,
        token: tokens.gateway,
      }),
      catalog: {
        environment: "sandbox",
        sourceUrl: "https://catalog.proof.invalid/menu",
        fallbackTtlSeconds: 300,
        fetchImpl: async () => new Response(JSON.stringify(catalogPayload), {
          headers: { "cache-control": "max-age=300" },
        }),
      },
      kfcCommerceProvider: {
        cart: proofProvider.cart,
        inventory: proofProvider.inventory,
        storeLocator: proofProvider.storeLocator,
        fulfillment: proofProvider.fulfillment,
      },
      readiness: {
        // This pre-existing component proof deliberately exercises the legacy
        // static test planner until #48 deletes that harness. Label it
        // as configured only inside this local harness instead of requiring a
        // live provider credential. It intentionally publishes no agent model
        // identity.
        agentConfigured: true,
        commerce: {
          mode: "gateway",
          baseUrl: gatewayBaseUrl,
          token: tokens.gateway,
        },
        zaloRequired: false,
      },
    });
    const agentBaseUrl = await listen(servers, "agent", agent);

    const readiness = await readReadiness({ agentBaseUrl, gatewayBaseUrl, omsBaseUrl, posBaseUrl, tokens });
    if (Object.values(readiness).some((status) => status !== "ready")) {
      throw new Error(`Commerce proof services were not ready: ${JSON.stringify(readiness)}`);
    }

    await runPlacementScenario(agentBaseUrl, "successful-placement", agentEvidenceByScenario);

    await runPlacementScenario(agentBaseUrl, "duplicate-command", agentEvidenceByScenario);
    const originalDuplicate = requiredResult(resultByScenario, "duplicate-command");
    await postJson(
      `${gatewayBaseUrl}/v1/orders`,
      duplicateCommand(originalDuplicate),
      tokens.gateway,
    );

    await configure(posBaseUrl, tokens.posAdmin, "rejection-compensation-succeeds", {
      operation: "submit_pos_ticket",
      behavior: "reject",
    });
    await runPlacementScenario(agentBaseUrl, "rejection-compensation-succeeds", agentEvidenceByScenario);

    await configure(posBaseUrl, tokens.posAdmin, "rejection-compensation-fails", {
      operation: "submit_pos_ticket",
      behavior: "reject",
    });
    await configure(omsBaseUrl, tokens.omsAdmin, "rejection-compensation-fails", {
      operation: "cancel_order",
      behavior: "fail",
    });
    await runPlacementScenario(agentBaseUrl, "rejection-compensation-fails", agentEvidenceByScenario);

    await configure(posBaseUrl, tokens.posAdmin, "pos-timeout", {
      operation: "submit_pos_ticket",
      behavior: "delay",
      delayMs: options.timeoutScenarioDelayMs ?? 5000,
    });
    await runPlacementScenario(agentBaseUrl, "pos-timeout", agentEvidenceByScenario);

    await runPlacementScenario(agentBaseUrl, "successful-cancellation", agentEvidenceByScenario);
    const successfulCancellation = requiredResult(resultByScenario, "successful-cancellation");
    await postJson(
      `${gatewayBaseUrl}/v1/orders/${successfulCancellation.commerceOrderId}/cancel`,
      { traceId: "trace-successful-cancellation", scenarioId: "successful-cancellation" },
      tokens.gateway,
    );

    await runPlacementScenario(agentBaseUrl, "partial-cancellation-failure", agentEvidenceByScenario);
    await configure(posBaseUrl, tokens.posAdmin, "partial-cancellation-failure", {
      operation: "cancel_pos_ticket",
      behavior: "fail",
    });
    const partialCancellation = requiredResult(resultByScenario, "partial-cancellation-failure");
    await postJson(
      `${gatewayBaseUrl}/v1/orders/${partialCancellation.commerceOrderId}/cancel`,
      { traceId: "trace-partial-cancellation", scenarioId: "partial-cancellation-failure" },
      tokens.gateway,
    );

    await configure(posBaseUrl, tokens.posAdmin, "conflicting-status", {
      operation: "get_pos_ticket",
      behavior: "conflict",
    });
    await runPlacementScenario(agentBaseUrl, "conflicting-status", agentEvidenceByScenario);
    const conflicting = requiredResult(resultByScenario, "conflicting-status");
    await fetch(
      `${gatewayBaseUrl}/v1/orders/${conflicting.commerceOrderId}?traceId=trace-conflicting-status`,
      { headers: { authorization: `Bearer ${tokens.gateway}` } },
    );

    const scenarioSummaries: MockCommerceProofManifest["scenarios"] = [];
    for (const scenarioId of commerceProofScenarioIds) {
      const result = requiredResult(resultByScenario, scenarioId);
      const entryPath =
        scenarioId === "successful-cancellation" ||
        scenarioId === "partial-cancellation-failure" ||
        scenarioId === "conflicting-status" ||
        scenarioId === "duplicate-command"
          ? "gateway-api"
          : "kfc-agent-backend";
      const agentEvidence = agentEvidenceByScenario.get(scenarioId);
      const events = await collectScenarioEvents(
        collector,
        tokens.collector,
        runId,
        scenarioId,
        result,
        entryPath,
      );
      const observedToolName = entryPath === "kfc-agent-backend" ? agentEvidence?.toolName ?? "missing" : "gateway-api";
      const genUiKind = entryPath === "kfc-agent-backend" ? agentEvidence?.genUiKind ?? "chatTranscript" : "not_applicable";
      const evaluation = evaluateCommerceProofScenario({
        scenarioId,
        expectedOutcome: expectedOutcome(scenarioId),
        expectedGenUiKind: genUiKind,
        expectedToolName: entryPath === "kfc-agent-backend" ? "placeOrder" : "gateway-api",
        observedToolName,
        toolArgumentsMatch: entryPath === "gateway-api" || agentEvidence?.toolArgumentsMatch === true,
        responseGrounded: entryPath === "gateway-api" || Boolean(agentEvidence?.responseText),
        observedGenUiKind: genUiKind,
        humanControlsEnabled: false,
        events,
        result,
      });
      const scenarioRoot = join(options.artifactRoot, "scenarios", scenarioId);
      await mkdir(scenarioRoot, { recursive: true });
      const langsmithEvidence = langsmithClient
        ? await emitLangSmithScenario({
            client: langsmithClient,
            project: langsmithProject,
            runId,
            scenarioId,
            entryPath,
            result,
            events,
            evaluation,
          })
        : { status: "not_required" as const };
      await writeJson(join(scenarioRoot, "local-trace.json"), events);
      await writeJson(join(scenarioRoot, "evaluator-results.json"), evaluation);
      await writeJson(join(scenarioRoot, "api-summary.json"), result);
      await writeJson(join(scenarioRoot, "assistant-genui.json"), agentEvidence ?? { status: "not_applicable" });
      await writeJson(join(scenarioRoot, "langsmith.json"), langsmithEvidence);
      scenarioSummaries.push({
        scenarioId,
        passed: evaluation.passed,
        outcome: result.outcome,
        entryPath,
        ...(entryPath === "gateway-api"
          ? { limitation: "This scenario enters through the gateway API because the required direct command is not currently exposed in the agent tool catalog" }
          : {}),
        traceId: result.traceId,
        ...(langsmithEvidence.status === "exported"
          ? { langsmithUrl: langsmithEvidence.url }
          : {}),
      });
    }

    manifest = {
      runId,
      generatedAt: new Date().toISOString(),
      passed: scenarioSummaries.every((scenario) => scenario.passed),
      scenarioCount: scenarioSummaries.length,
      commerceEnvironment: "sandbox",
      providerProvenance: sandboxCommerceProofProviderProvenance,
      readiness,
      scenarios: scenarioSummaries,
      langsmith: options.requireLangSmith
        ? { required: true, status: "exported", project: langsmithProject }
        : { required: false, status: "not_required" },
      shutdown: { complete: false, openServices: servers.map((entry) => entry.name) },
    };
  } finally {
    const openServices: string[] = [];
    for (const entry of [...servers].reverse()) {
      try {
        await entry.server.close();
      } catch {
        openServices.push(entry.name);
      }
    }
    await collector.close();
    if (manifest) {
      manifest.shutdown = { complete: openServices.length === 0, openServices };
      await mkdir(options.artifactRoot, { recursive: true });
      await writeJson(join(options.artifactRoot, "service-readiness.json"), manifest.readiness);
      await writeJson(join(options.artifactRoot, "manifest.json"), manifest);
    }
  }

  if (!manifest) throw new Error("Mock commerce proof did not produce a manifest");
  return manifest;
}

interface AgentEvidence {
  toolName: string;
  toolArgumentsMatch: boolean;
  responseText: string;
  genUiKind: string;
}

class CommerceProofPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    if (!input.state.cart) {
      if (input.contextInventory?.cart.available) {
        return {
          intent: "ordering",
          contextPolicy: { cart: "active", fulfillment: "active" },
          entities: {
            fulfillmentMethod: "delivery",
            addressDraft: {
              line1: "Big C Đồng Nai",
              district: "Biên Hòa",
              city: "Đồng Nai",
            },
          },
          toolCalls: [
            {
              toolName: "quoteFulfillment",
              arguments: {
                method: "delivery",
                itemCodes: ["41175"],
                address: {
                  label: "Proof address",
                  line1: "Big C Đồng Nai",
                  district: "Biên Hòa",
                  city: "Đồng Nai",
                },
              },
            },
          ],
          responseClaims: [],
        };
      }
      return {
        intent: "ordering",
        entities: { itemText: "Xô Zui Zẻ 159K", cartMutationConfirmed: true },
        toolCalls: [
          { toolName: "searchMenu", arguments: { query: "Xô Zui Zẻ 159K" } },
          { toolName: "updateCart", arguments: { itemCode: "41175", quantity: 1 } },
        ],
        responseClaims: [],
      };
    }
    if (!input.state.fulfillment) {
      return {
        intent: "ordering",
        contextPolicy: { cart: "active", fulfillment: "active" },
        entities: {
          fulfillmentMethod: "delivery",
          addressDraft: {
            line1: "Big C Đồng Nai",
            district: "Biên Hòa",
            city: "Đồng Nai",
          },
        },
        toolCalls: [
          {
            toolName: "quoteFulfillment",
            arguments: {
              method: "delivery",
              itemCodes: ["41175"],
              address: {
                label: "Proof address",
                line1: "Big C Đồng Nai",
                district: "Biên Hòa",
                city: "Đồng Nai",
              },
            },
          },
        ],
        responseClaims: [],
      };
    }
    return {
      intent: "ordering",
      entities: { orderConfirmed: true },
      toolCalls: [
        { toolName: "previewOrder", arguments: {} },
        { toolName: "placeOrder", arguments: {} },
      ],
      responseClaims: [],
    };
  }
}

async function runPlacementScenario(
  agentBaseUrl: string,
  scenarioId: string,
  evidence: Map<string, AgentEvidence>,
): Promise<void> {
  const sessionId = `kfc:customer-${scenarioId}`;
  let response = await agentTurn(
    agentBaseUrl,
    sessionId,
    scenarioId,
    `cart-${scenarioId}`,
    "Cho mình một Xô Zui Zẻ 159K",
  );
  let trace = response.state?.toolTrace ?? [];
  if (!response.state?.fulfillment) {
    response = await agentTurn(
      agentBaseUrl,
      sessionId,
      scenarioId,
      `address-${scenarioId}`,
      "Giao đến Big C Đồng Nai, Biên Hòa, Đồng Nai",
    );
    trace = response.state?.toolTrace ?? [];
  }
  if (!trace.some((entry) => entry.toolName === "placeOrder")) {
    response = await agentTurn(
      agentBaseUrl,
      sessionId,
      scenarioId,
      `place-${scenarioId}`,
      "Xác nhận đơn",
      true,
    );
    trace = response.state?.toolTrace ?? [];
  }
  if (response.pause) {
    response = await resumeAgentConfirmation(agentBaseUrl, response.pause.requestId);
    trace = response.state?.toolTrace ?? [];
  }
  const placeOrder = [...trace].reverse().find((entry) => entry.toolName === "placeOrder");
  evidence.set(scenarioId, {
    toolName: placeOrder?.toolName ?? "missing",
    toolArgumentsMatch: placeOrder !== undefined,
    responseText: response.responseText ?? "",
    genUiKind: response.genUi?.widgetKind ?? "chatTranscript",
  });
}

async function agentTurn(
  baseUrl: string,
  sessionId: string,
  scenarioId: string,
  clientMessageId: string,
  text: string,
  confirmsOrder = false,
): Promise<{
  responseText?: string;
  genUi?: { widgetKind?: string };
  pause?: { requestId: string };
  state?: { fulfillment?: unknown; toolTrace?: ToolTraceEntry[] };
}> {
  const response = await fetch(`${baseUrl}/chat/kfc/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      customerId: `customer-${scenarioId}`,
      clientMessageId,
      text,
      metadata: {
        scenarioId,
        ...(confirmsOrder ? { customerCommand: { kind: "confirm_order" } } : {}),
      },
    }),
  });
  if (!response.ok) throw new Error(`KFC agent turn failed with HTTP ${response.status}`);
  return response.json() as Promise<{
    responseText?: string;
    genUi?: { widgetKind?: string };
    pause?: { requestId: string };
    state?: { fulfillment?: unknown; toolTrace?: ToolTraceEntry[] };
  }>;
}

async function resumeAgentConfirmation(
  baseUrl: string,
  requestId: string,
): Promise<{
  responseText?: string;
  genUi?: { widgetKind?: string };
  state?: { fulfillment?: unknown; toolTrace?: ToolTraceEntry[] };
}> {
  const response = await fetch(`${baseUrl}/chat/kfc/confirmations/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, decision: "approve" }),
  });
  if (!response.ok) throw new Error(`KFC agent confirmation resume failed with HTTP ${response.status}`);
  return response.json() as Promise<{
    responseText?: string;
    genUi?: { widgetKind?: string };
    state?: { fulfillment?: unknown; toolTrace?: ToolTraceEntry[] };
  }>;
}

async function collectScenarioEvents(
  collector: FastifyInstance,
  collectorToken: string,
  runId: string,
  scenarioId: string,
  result: CommerceResult,
  entryPath: "kfc-agent-backend" | "gateway-api",
): Promise<SafeTraceEvent[]> {
  const eventTypes =
    scenarioId === "duplicate-command"
      ? ["user_message", "planner_decision", "tool_call", "tool_result", "assistant_response", "genui_rendered"]
      : [
          "user_message",
          "planner_decision",
          "tool_call",
          "gateway_request",
          "mock_oms_request",
          "mock_oms_response",
          "mock_pos_request",
          "mock_pos_response",
          "tool_result",
          "assistant_response",
          "genui_rendered",
        ];
  for (const eventType of eventTypes) {
    await collector.inject({
      method: "POST",
      url: "/__proof/events",
      headers: { authorization: `Bearer ${collectorToken}` },
      payload: {
        timestamp: new Date().toISOString(),
        runId,
        scenarioId,
        traceId: result.traceId,
        service: serviceForEvent(eventType, entryPath),
        eventType,
        status: result.customerStatus === "failed" && eventType.endsWith("response") ? "failed" : "ok",
        durationMs: 0,
        commerceEnvironment: "sandbox",
        providerImplementation: implementationForEvent(eventType),
        identifiers: identifiers(result),
        statuses: statuses(result),
        inputSummary: {},
        outputSummary: {},
      },
    });
  }
  const response = await collector.inject({
    method: "GET",
    url: `/__proof/traces/${encodeURIComponent(result.traceId)}`,
    headers: { authorization: `Bearer ${collectorToken}` },
  });
  return response.json().events as SafeTraceEvent[];
}

async function readReadiness(input: {
  agentBaseUrl: string;
  gatewayBaseUrl: string;
  omsBaseUrl: string;
  posBaseUrl: string;
  tokens: { gateway: string; oms: string; pos: string };
}): Promise<MockCommerceProofManifest["readiness"]> {
  const [agent, gateway, oms, pos] = await Promise.all([
    fetch(`${input.agentBaseUrl}/ready`),
    fetch(`${input.gatewayBaseUrl}/ready`, { headers: { authorization: `Bearer ${input.tokens.gateway}` } }),
    fetch(`${input.omsBaseUrl}/ready`, { headers: { authorization: `Bearer ${input.tokens.oms}` } }),
    fetch(`${input.posBaseUrl}/ready`, { headers: { authorization: `Bearer ${input.tokens.pos}` } }),
  ]);
  return {
    agent: agent.ok ? "ready" : "unavailable",
    gateway: gateway.ok ? "ready" : "unavailable",
    oms: oms.ok ? "ready" : "unavailable",
    pos: pos.ok ? "ready" : "unavailable",
  };
}

async function listen(
  servers: Array<{ name: string; server: FastifyInstance }>,
  name: string,
  server: FastifyInstance,
): Promise<string> {
  const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  servers.push({ name, server });
  return baseUrl;
}

async function configure(
  baseUrl: string,
  token: string,
  scenarioId: string,
  behavior: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${baseUrl}/__admin/scenarios/${scenarioId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(behavior),
  });
  if (response.status !== 204) throw new Error(`Scenario configuration failed with HTTP ${response.status}`);
}

async function postJson(url: string, payload: unknown, token: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function duplicateCommand(result: CommerceResult): CommerceCommand {
  const scenarioId = "duplicate-command";
  return {
    contractVersion: commerceContractVersion,
    traceId: "trace-duplicate-command",
    scenarioId,
    sessionId: `kfc:customer-${scenarioId}`,
    clientMessageId: `place-${scenarioId}`,
    idempotencyKey: `kfc:customer-${scenarioId}:place-${scenarioId}:placeOrder`,
    toolName: "placeOrder",
    order: {
      previewId: result.commerceOrderId ?? "PREVIEW-DUPLICATE",
      storeId: "KFCVN0002",
      items: [{ itemCode: "41175", quantity: 1 }],
      totalVnd: 177000,
      paymentMethod: "cash",
      userConfirmed: true,
    },
  };
}

function requiredResult(results: Map<string, CommerceResult>, scenarioId: string): CommerceResult {
  const result = results.get(scenarioId);
  if (!result) throw new Error(`Scenario ${scenarioId} did not produce a gateway result`);
  return result;
}

function expectedOutcome(scenarioId: string): CommerceResult["outcome"] {
  if (scenarioId === "duplicate-command") return "deduplicated";
  if (scenarioId === "rejection-compensation-succeeds" || scenarioId === "rejection-compensation-fails") {
    return "pos_rejected";
  }
  if (scenarioId === "pos-timeout") return "ambiguous_pos_submission";
  if (scenarioId === "successful-cancellation") return "cancelled";
  if (scenarioId === "partial-cancellation-failure") return "partial_cancellation";
  if (scenarioId === "conflicting-status") return "status_conflict";
  return "accepted";
}

function identifiers(result: CommerceResult): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      commerceOrderId: result.commerceOrderId,
      omsOrderId: result.omsOrderId,
      posTicketId: result.posTicketId,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function statuses(result: CommerceResult): Record<string, string> {
  const projected: Record<string, string> = {
    customerStatus: result.customerStatus,
  };
  if (result.omsStatus) projected.omsStatus = result.omsStatus;
  if (result.posStatus) projected.posStatus = result.posStatus;
  return projected;
}

function serviceForEvent(eventType: string, entryPath: string): string {
  if (eventType.startsWith("mock_oms")) return "mock-oms";
  if (eventType.startsWith("mock_pos")) return "mock-pos";
  if (eventType === "gateway_request") return "demo-commerce-gateway";
  return entryPath === "kfc-agent-backend" ? "kfc-agent-backend" : "proof-runner";
}

function implementationForEvent(eventType: string): "http-adapter" | "in-process-runtime" {
  return eventType === "gateway_request" || eventType.startsWith("mock_oms") || eventType.startsWith("mock_pos")
    ? "http-adapter"
    : "in-process-runtime";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function emitLangSmithScenario(input: {
  client: Client;
  project: string;
  runId: string;
  scenarioId: string;
  entryPath: "kfc-agent-backend" | "gateway-api";
  result: CommerceResult;
  events: SafeTraceEvent[];
  evaluation: ReturnType<typeof evaluateCommerceProofScenario>;
}): Promise<{ status: "exported"; runId: string; url: string }> {
  const root = new RunTree({
    name: `kfc-commerce-proof:${input.scenarioId}`,
    run_type: "chain",
    project_name: input.project,
    client: input.client,
    inputs: {
      proofRunId: input.runId,
      scenarioId: input.scenarioId,
      entryPath: input.entryPath,
    },
    outputs: {
      outcome: input.result.outcome,
      customerStatus: input.result.customerStatus,
      passed: input.evaluation.passed,
      scores: input.evaluation.scores,
    },
    metadata: {
      contractVersion: commerceContractVersion,
      domainTraceId: input.result.traceId,
      commerceEnvironment: input.result.commerceEnvironment,
      providerProvenance: input.result.providerProvenance,
      commerceOrderId: input.result.commerceOrderId,
      omsOrderId: input.result.omsOrderId,
      posTicketId: input.result.posTicketId,
      omsStatus: input.result.omsStatus,
      posStatus: input.result.posStatus,
      customerStatus: input.result.customerStatus,
    },
    tags: [
      "kfc-commerce-proof",
      "environment:sandbox",
      "provider:http-adapter",
      `scenario:${input.scenarioId}`,
      `entry:${input.entryPath}`,
    ],
  });
  await root.postRun();

  for (const event of input.events) {
    const child = root.createChild({
      name: event.eventType,
      run_type: event.eventType === "planner_decision" ? "llm" : "tool",
      inputs: event.inputSummary,
      outputs: {
        status: event.status,
        identifiers: event.identifiers,
        statuses: event.statuses,
        summary: event.outputSummary,
      },
      metadata: {
        sequence: event.sequence,
        service: event.service,
        commerceEnvironment: event.commerceEnvironment,
        providerImplementation: event.providerImplementation,
        domainTraceId: event.traceId,
      },
      tags: [`service:${event.service}`, `event:${event.eventType}`],
    });
    await child.postRun();
    await child.end(child.outputs);
    await child.patchRun();
  }

  const evaluator = root.createChild({
    name: "deterministic-commerce-evaluators",
    run_type: "chain",
    inputs: { scenarioId: input.scenarioId },
    outputs: {
      passed: input.evaluation.passed,
      scores: input.evaluation.scores,
      failures: input.evaluation.failures,
    },
    metadata: { evaluatorType: "deterministic" },
    tags: ["deterministic-evaluator"],
  });
  await evaluator.postRun();
  await evaluator.end(evaluator.outputs);
  await evaluator.patchRun();
  await root.end(root.outputs);
  await root.patchRun();
  await input.client.awaitPendingTraceBatches();
  const url = await input.client.getRunUrl({
    run: { id: root.id } as Run,
    projectOpts: { projectName: input.project },
  });
  if (!url) throw new Error(`LangSmith did not return a URL for ${input.scenarioId}`);
  return { status: "exported", runId: root.id, url };
}
