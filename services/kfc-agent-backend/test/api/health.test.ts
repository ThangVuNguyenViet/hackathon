import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";

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

  it("reports Messenger and Zalo readiness independently", async () => {
    const server = buildServer({
      messengerVerifyToken: "verify",
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
      production: true,
      message: "Missing KFC_COMMERCE_GATEWAY_TOKEN",
    });
  });
});
