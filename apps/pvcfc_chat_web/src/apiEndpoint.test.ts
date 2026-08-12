import { describe, expect, it } from "vitest";
import { resolvePvcfcMessageEndpoint } from "./apiEndpoint.js";

describe("PVCFC packaged API endpoint", () => {
  it("uses the packaged deployment's same origin by default", () => {
    expect(resolvePvcfcMessageEndpoint(undefined)).toBe(
      "/chat/pvcfc/message",
    );
    expect(resolvePvcfcMessageEndpoint("  ")).toBe("/chat/pvcfc/message");
  });

  it("uses only an explicit Vite base URL override for separate local development", () => {
    expect(resolvePvcfcMessageEndpoint("http://localhost:18090")).toBe(
      "http://localhost:18090/chat/pvcfc/message",
    );
    expect(resolvePvcfcMessageEndpoint("http://127.0.0.1:18090/")).toBe(
      "http://127.0.0.1:18090/chat/pvcfc/message",
    );
  });

  it("rejects path-bearing or non-http overrides instead of constructing an ambiguous endpoint", () => {
    expect(() =>
      resolvePvcfcMessageEndpoint("http://165.154.229.65"),
    ).toThrow("pvcfc_api_base_url_invalid");
    expect(() =>
      resolvePvcfcMessageEndpoint("https://example.com/api"),
    ).toThrow("pvcfc_api_base_url_invalid");
    expect(() => resolvePvcfcMessageEndpoint("ftp://example.com")).toThrow(
      "pvcfc_api_base_url_invalid",
    );
  });
});
