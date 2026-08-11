import { describe, expect, it } from 'vitest';
import { createConfiguredPvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/configuredPvcfcPublicDataProvider.js';

describe('configured PVCFC public-data provider', () => {
  it('rejects an unknown runtime mode instead of selecting fixture data', () => {
    expect(() =>
      createConfiguredPvcfcPublicDataProvider({
        enabled: true,
        mode: 'fixtuer',
      }),
    ).toThrow('PVCFC_PUBLIC_DATA_MODE must be fixture or api');
  });
});
