import menuItems from '../../fixtures/generated/menu-items.json' with { type: 'json' };
import menuModifiers from '../../fixtures/generated/menu-modifiers.json' with { type: 'json' };
import stores from '../../fixtures/generated/stores.json' with { type: 'json' };
import storeAvailability from '../../fixtures/generated/store-availability.json' with { type: 'json' };
import promotions from '../../fixtures/generated/promotions.json' with { type: 'json' };
import promotionVoucherOffers from '../../fixtures/generated/promotion-voucher-offers.json' with { type: 'json' };
import paymentMethods from '../../fixtures/generated/payment-methods.json' with { type: 'json' };
import contentPages from '../../fixtures/generated/content-pages.json' with { type: 'json' };
import membershipPages from '../../fixtures/generated/membership-pages.json' with { type: 'json' };
import membershipRewardOffers from '../../fixtures/generated/membership-reward-offers.json' with { type: 'json' };
import membershipWalletVouchers from '../../fixtures/generated/membership-wallet-vouchers.json' with { type: 'json' };
import membershipProfileSnapshots from '../../fixtures/generated/membership-profile-snapshots.json' with { type: 'json' };
import membershipPointHistorySnapshots from '../../fixtures/generated/membership-point-history-snapshots.json' with { type: 'json' };
import membershipToolDefinitions from '../../fixtures/generated/membership-tool-definitions.json' with { type: 'json' };
import { generatedFixturesSchema, type GeneratedFixtures } from './schema.js';

export function loadBundledGeneratedFixtures(): GeneratedFixtures {
  return generatedFixturesSchema.parse({
    menuItems,
    menuModifiers,
    stores,
    storeAvailability,
    promotions,
    promotionVoucherOffers,
    paymentMethods,
    contentPages,
    membershipPages,
    membershipRewardOffers,
    membershipWalletVouchers,
    membershipProfileSnapshots,
    membershipPointHistorySnapshots,
    membershipToolDefinitions,
  });
}
