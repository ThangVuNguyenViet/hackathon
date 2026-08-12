import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';

export const PVCFC_WEB_ALLOWED_HOSTNAMES = Object.freeze([
  'pvcfc.com.vn',
  'www.pvcfc.com.vn',
  'shop.pvcfc.com.vn',
  'thamquannhamay.pvcfc.com.vn',
  'muavangthanglon.pvcfc.com.vn',
] as const);

// Official PVCFC pages can take several seconds to render through TinyFish.
// Use the adapter's maximum provider timeout while leaving a small margin for
// the outer 30-second agent-turn deadline. The LangChain run/tool limits still
// bound the overall agent loop; these values only govern live-web time.
export const PVCFC_WEB_OPERATION_TIMEOUT_MS = 15_000;
export const PVCFC_WEB_FETCH_TIMEOUT_MS = 14_000;
export const PVCFC_WEB_TURN_BUDGET_MS = 28_000;

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
