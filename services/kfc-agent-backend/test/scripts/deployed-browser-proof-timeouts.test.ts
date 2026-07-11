import { describe, expect, it } from "vitest";
import {
  DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV,
  DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS,
  resolveDeployedBrowserProofLiveTimeoutMs,
} from "../../scripts/deployed-browser-proof-timeouts.js";

describe("resolveDeployedBrowserProofLiveTimeoutMs", () => {
  it("returns the default timeout when the env is unset or blank", () => {
    expect(resolveDeployedBrowserProofLiveTimeoutMs(undefined)).toBe(DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS);
    expect(resolveDeployedBrowserProofLiveTimeoutMs("")).toBe(DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS);
    expect(resolveDeployedBrowserProofLiveTimeoutMs("   ")).toBe(DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS);
  });

  it("accepts integer digit strings at or above the live-safe floor", () => {
    expect(resolveDeployedBrowserProofLiveTimeoutMs("120000")).toBe(120_000);
    expect(resolveDeployedBrowserProofLiveTimeoutMs("00120000")).toBe(120_000);
    expect(resolveDeployedBrowserProofLiveTimeoutMs("240000")).toBe(240_000);
  });

  it.each(["120000ms", "120000.5", "00120000foo"])(
    "rejects non-integer timeout strings like %s",
    (configuredValue) => {
      expect(() => resolveDeployedBrowserProofLiveTimeoutMs(configuredValue)).toThrow(
        `${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV} must be a positive integer number of milliseconds`,
      );
    },
  );

  it("rejects values below the live-safe floor", () => {
    expect(() => resolveDeployedBrowserProofLiveTimeoutMs("119999")).toThrow(
      `${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV} must be at least ${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS}ms`,
    );
  });
});
