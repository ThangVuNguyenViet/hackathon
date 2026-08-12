import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';

export const PVCFC_WEB_ALLOWED_HOSTNAMES = Object.freeze([
  'pvcfc.com.vn',
  'www.pvcfc.com.vn',
  'shop.pvcfc.com.vn',
  'thamquannhamay.pvcfc.com.vn',
  'muavangthanglon.pvcfc.com.vn',
] as const);

export const PVCFC_WEB_OPERATION_TIMEOUT_MS = 10_000;
export const PVCFC_WEB_FETCH_TIMEOUT_MS = 9_000;
export const PVCFC_WEB_TURN_BUDGET_MS = 20_000;
export const PVCFC_WEB_MAX_SEARCH_CALLS = 1;
export const PVCFC_WEB_MAX_FETCH_CALLS = 1;

/** Applies the PVCFC-owned first-party policy to provider-supplied source data. */
export function admittedPvcfcWebInventoryUrls(
  sourceUrls: readonly string[],
): readonly string[] {
  const admitted = new Set<string>();
  for (const sourceUrl of sourceUrls) {
    try {
      admitted.add(
        validateBusinessWebUrl(sourceUrl, PVCFC_WEB_ALLOWED_HOSTNAMES),
      );
    } catch {
      // External, app-store, and malformed provenance is not web evidence.
    }
  }
  return Object.freeze([...admitted].sort());
}
