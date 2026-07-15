import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/api/server.js";
import catalogPayload from "../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json" with { type: "json" };
import { loadBundledGeneratedFixtures } from "../../src/fixtures/bundledFixtures.js";
import { createMockClients } from "../../src/mock/createMockClients.js";

describe("health route", () => {
  it("returns service status without external dependencies", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "kfc-agent-backend",
    });
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("responds to dashboard CORS preflight requests", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "OPTIONS",
      url: "/dashboard/sessions",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("reports readiness when database, fixtures, and demo channel config are available", async () => {
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaAppSecret: "meta_app_secret_local",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
      zaloOaId: "oa_local",
      zaloAccessToken: "zalo_token_local",
      zaloInboxUrlTemplate:
        "https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}",
      readiness: {
        database: async () => ({ ok: true }),
        langsmith: {
          configured: true,
          project: 'kfc-agent-backend-local',
          endpoint: 'https://apac.api.smith.langchain.com',
          samplingRate: 1,
        },
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "kfc-agent-backend",
      checks: {
        database: { ok: true },
        fixtures: { ok: true },
        messenger: { ok: true },
        zalo: { ok: true, configured: true, required: true },
        openai: { ok: true, required: false },
        observability: {
          langsmith: {
            configured: true,
            project: 'kfc-agent-backend-local',
            endpoint: 'https://apac.api.smith.langchain.com',
            samplingRate: 1,
          },
        },
      },
    });
    expect(response.json().timestamp).toEqual(expect.any(String));
  });

  it("returns 503 readiness when a required dependency fails", async () => {
    const server = buildServer({
      readiness: {
        database: async () => ({ ok: false, message: "database unavailable" }),
        fixturesRoot: "/tmp/kfc-agent-backend-missing-fixtures",
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      checks: {
        database: { ok: false, message: "database unavailable" },
        fixtures: { ok: false },
        messenger: { ok: false },
      },
    });
  });

  it("reports missing inbox templates as explicit readiness failures", async () => {
    const server = buildServer({
      messengerVerifyToken: "verify",
      metaAppSecret: "meta_app_secret_local",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token",
      zaloOaId: "oa_local",
      zaloAccessToken: "zalo_token",
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks).toMatchObject({
      messenger: {
        ok: false,
        configured: false,
        required: true,
        message: "Missing META_INBOX_URL_TEMPLATE",
      },
      zalo: {
        ok: false,
        configured: false,
        required: true,
        message: "Missing ZALO_INBOX_URL_TEMPLATE",
      },
    });
  });

  it("fails Messenger readiness when webhook authenticity is not configured", async () => {
    const server = buildServer({
      messengerVerifyToken: "verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
      readiness: { zaloRequired: false },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.messenger).toMatchObject({
      ok: false,
      configured: false,
      required: true,
      message: "Missing META_APP_SECRET",
    });
  });

  it("reports Messenger and Zalo readiness independently", async () => {
    const server = buildServer({
      messengerVerifyToken: "verify",
      metaAppSecret: "meta_app_secret_local",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
      zaloOaId: "4225933857518051795",
      zaloAccessToken: "zalo_token",
      zaloInboxUrlTemplate:
        "https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}",
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json().checks).toMatchObject({
      messenger: { ok: true, configured: true, required: true },
      zalo: { ok: true, configured: true, required: true },
    });
  });

  it("keeps Messenger readiness visible when Zalo is missing", async () => {
    const server = buildServer({
      messengerVerifyToken: "verify",
      metaAppSecret: "meta_app_secret_local",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks).toMatchObject({
      messenger: { ok: true, configured: true, required: true },
      zalo: { ok: false, configured: false, required: true },
    });
  });

  it("reports fixture commerce mode as non-production", async () => {
    const server = buildServer({
      readiness: {
        commerce: { mode: "fixture" },
        zaloRequired: false,
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.json().checks.commerce).toEqual({
      ok: true,
      mode: "fixture",
      configured: true,
      production: false,
      message:
        "Fixture commerce is enabled for local development and proof only",
    });
  });

  it("fails readiness when gateway commerce credentials are incomplete", async () => {
    const server = buildServer({
      readiness: {
        commerce: {
          mode: "gateway",
          baseUrl: "https://commerce.internal.example",
        },
        zaloRequired: false,
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.commerce).toEqual({
      ok: false,
      mode: "gateway",
      configured: false,
      reachable: false,
      authenticated: false,
      dependencyClass: "unavailable",
      message: "Missing KFC_COMMERCE_GATEWAY_TOKEN",
    });
  });

  it("keeps lifecycle provider capability checks out of gateway readiness", async () => {
    const provider = createMockClients(loadBundledGeneratedFixtures());
    const gatewayReadiness = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      dependencyClass: "sandbox",
      capabilities: ["orders", "payment"],
    })));
    const server = buildServer({
      readiness: {
        commerce: {
          mode: "gateway",
          baseUrl: "http://127.0.0.1:4010",
          token: "gateway-token",
          fetchImpl: gatewayReadiness,
          requiredCapabilities: ["orders", "payment"],
        },
        zaloRequired: false,
      },
      catalog: {
        environment: "sandbox",
        sourceUrl: "https://catalog.example/menu",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(catalogPayload), {
            headers: { "cache-control": "max-age=300" },
          }),
        ),
      },
      kfcCommerceGateway: { oms: provider.oms, payment: provider.payment },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.commerce).toMatchObject({
      ok: true,
      mode: "gateway",
      configured: true,
      capabilities: ["orders", "payment"],
    });
    expect(gatewayReadiness).toHaveBeenCalledOnce();
  });

  it("verifies gateway reachability and simulated provenance", async () => {
    const provider = createMockClients(loadBundledGeneratedFixtures());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          service: "demo-commerce-gateway",
          dependencyClass: "simulated",
          capabilities: ["orders", "payment"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaAppSecret: "meta_app_secret_local",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
      readiness: {
        commerce: {
          mode: "gateway",
          baseUrl: "http://127.0.0.1:4010",
          token: "gateway-token",
          fetchImpl,
          requiredCapabilities: ["orders", "payment"],
        },
        zaloRequired: false,
      },
      catalog: {
        environment: "sandbox",
        sourceUrl: "https://catalog.example/menu",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(catalogPayload), {
            status: 200,
            headers: { "cache-control": "max-age=300" },
          }),
        ),
      },
      kfcCommerceGateway: { oms: provider.oms, payment: provider.payment },
      kfcCommerceProvider: {
        cart: provider.cart,
        inventory: provider.inventory,
        storeLocator: provider.storeLocator,
        fulfillment: provider.fulfillment,
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json().checks.commerce).toMatchObject({
      ok: true,
      mode: "gateway",
      configured: true,
      reachable: true,
      authenticated: true,
      dependencyClass: "simulated",
      latencyMs: expect.any(Number),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/ready",
      expect.objectContaining({
        headers: { authorization: "Bearer gateway-token" },
      }),
    );
  });

  it("fails readiness when HTTP POS mode has no endpoint", async () => {
    const server = buildServer({
      readiness: {
        pos: { mode: "http", token: "pos-token" },
        zaloRequired: false,
      },
    });

    const response = await server.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.pos).toEqual({
      ok: false,
      mode: "http",
      configured: false,
      simulated: false,
      message: "Missing KFC_POS_BASE_URL",
    });
  });
});
