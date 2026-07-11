export const DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS = 120_000;
export const DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV =
  "KFC_DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS";

export function resolveDeployedBrowserProofLiveTimeoutMs(
  configuredValue: string | undefined = process.env[DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV],
): number {
  if (!configuredValue || configuredValue.trim().length === 0) {
    return DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(configuredValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV} must be a positive integer number of milliseconds`,
    );
  }
  if (parsed < DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS) {
    throw new Error(
      `${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_ENV} must be at least ${DEPLOYED_BROWSER_PROOF_LIVE_TIMEOUT_MS}ms`,
    );
  }
  return parsed;
}
