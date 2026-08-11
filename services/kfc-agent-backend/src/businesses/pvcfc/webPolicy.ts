import bundledPublicData from '../../../fixtures/generated/pvcfc-public-data.json' with { type: 'json' };
import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';
import { parsePvcfcPublicDataBundle } from './public-data/pvcfcPublicDataBundle.js';

export const PVCFC_WEB_ALLOWED_HOSTNAMES = Object.freeze([
  'pvcfc.com.vn',
  'www.pvcfc.com.vn',
  'shop.pvcfc.com.vn',
  'thamquannhamay.pvcfc.com.vn',
  'muavangthanglon.pvcfc.com.vn',
] as const);

export const PVCFC_WEB_OPERATION_TIMEOUT_MS = 4_000;
export const PVCFC_WEB_FETCH_TIMEOUT_MS = 3_000;
export const PVCFC_WEB_TURN_BUDGET_MS = 12_000;

function recordSourceUrls(record: Record<string, unknown>): string[] {
  const urls: string[] = [];
  if (typeof record['sourceUrl'] === 'string') urls.push(record['sourceUrl']);
  const provenance = record['provenance'];
  if (
    typeof provenance === 'object' &&
    provenance !== null &&
    !Array.isArray(provenance)
  ) {
    const sourceUrl = Reflect.get(provenance, 'sourceUrl');
    if (typeof sourceUrl === 'string') urls.push(sourceUrl);
  }
  return urls;
}

let bundledInventory: readonly string[] | undefined;

/** URLs already represented by canonical fixture records and their provenance. */
export function bundledPvcfcWebInventoryUrls(): readonly string[] {
  if (bundledInventory) return bundledInventory;
  const bundle = parsePvcfcPublicDataBundle(bundledPublicData);
  const normalized = new Set<string>();
  for (const collection of bundle.collections) {
    for (const record of collection.records) {
      for (const sourceUrl of recordSourceUrls(record)) {
        try {
          normalized.add(
            validateBusinessWebUrl(sourceUrl, PVCFC_WEB_ALLOWED_HOSTNAMES),
          );
        } catch {
          // External/social/app-store provenance is intentionally not admitted.
        }
      }
    }
  }
  bundledInventory = Object.freeze([...normalized].sort());
  return bundledInventory;
}
