import { loadBundledPvcfcPublicDataProvider } from './bundledPvcfcPublicDataProvider.js';
import type { PvcfcPublicDataProvider } from './pvcfcPublicDataProvider.js';

export type PvcfcPublicDataMode = 'fixture' | 'api';

/** Trusted startup composition for the PVCFC pack's provider dependency. */
export function createConfiguredPvcfcPublicDataProvider(input: {
  enabled: boolean;
  mode: PvcfcPublicDataMode | undefined;
}): PvcfcPublicDataProvider | undefined {
  if (!input.enabled) return undefined;
  if (!input.mode) {
    throw new Error(
      'PVCFC_PUBLIC_DATA_MODE is required when PVCFC_ASTRAFLOW_API_KEY is configured',
    );
  }
  if (input.mode === 'api') {
    throw new Error('PVCFC public data API provider is not configured');
  }
  return loadBundledPvcfcPublicDataProvider();
}
