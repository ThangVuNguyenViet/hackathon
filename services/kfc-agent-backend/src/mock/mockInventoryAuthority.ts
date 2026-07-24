import type { ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { digestCommerceAction } from '../ordering/commerceDigest.js';
import { OrderingDataService } from '../ordering/orderingDataService.js';
import type { Disposition } from '../ordering/types.js';
import { mockProviderProvenance } from './mockToolResults.js';
import type { MockedUpstreamApiProfile } from './mockedUpstreamProfile.js';

const availabilityLifetimeMs = 5 * 60_000;

interface MockInventoryInput {
  data: OrderingDataService;
  fixtures: GeneratedFixtures;
  profile: MockedUpstreamApiProfile | undefined;
  storeId: string;
  itemCodes: string[];
  disposition: Disposition | undefined;
}

interface MockInventoryAuthorityResult {
  availability: Record<string, boolean>;
  providerRevision: string;
  observedAt: string;
  expiresAt: string;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function inventoryAuthorityInputs(
  fixtures: GeneratedFixtures,
  profile: MockedUpstreamApiProfile | undefined,
): unknown {
  return {
    schemaVersion: 'mock-inventory-authority-v1',
    storeAvailability: fixtures.storeAvailability
      .map((store) => ({
        storeId: store.storeId,
        pickup: {
          excludedItemIds: sorted(store.pickup.excludedItemIds),
          blockedTimeslotItemIds: sorted(
            store.pickup.timeslotExclusions.map(({ itemId }) => itemId),
          ),
        },
        delivery: {
          excludedItemIds: sorted(store.delivery.excludedItemIds),
          blockedTimeslotItemIds: sorted(
            store.delivery.timeslotExclusions.map(({ itemId }) => itemId),
          ),
        },
      }))
      .sort((left, right) => left.storeId.localeCompare(right.storeId)),
    unavailableItemCodes: sorted(profile?.unavailableItemCodes ?? []),
  };
}

export async function mockInventoryProviderRevision(input: {
  fixtures: GeneratedFixtures;
  profile: MockedUpstreamApiProfile | undefined;
}): Promise<string> {
  return `inventory:${await digestCommerceAction(
    inventoryAuthorityInputs(input.fixtures, input.profile),
  )}`;
}

export function checkMockInventory(
  input: Omit<MockInventoryInput, 'fixtures'>,
): ToolResult<Record<string, boolean>> {
  const unavailableItemCodes = new Set(
    input.profile?.unavailableItemCodes ?? [],
  );
  return {
    ok: true,
    value: Object.fromEntries(
      input.itemCodes.map((code) => [code, !unavailableItemCodes.has(code)]),
    ),
    message: 'ok',
    provenance: [...mockProviderProvenance],
  };
}

export async function checkMockInventoryWithAuthority(
  input: MockInventoryInput & { disposition: Disposition },
): Promise<ToolResult<MockInventoryAuthorityResult>> {
  const observedAtMs = Date.now();
  const availability = checkMockInventory(input);
  if (!availability.ok || !availability.value) {
    return {
      ok: false,
      errorCode: availability.errorCode,
      message: availability.message,
      provenance: availability.provenance,
    };
  }
  return {
    ok: true,
    value: {
      availability: availability.value,
      providerRevision: await mockInventoryProviderRevision(input),
      observedAt: new Date(observedAtMs).toISOString(),
      expiresAt: new Date(observedAtMs + availabilityLifetimeMs).toISOString(),
    },
    message: 'ok',
    provenance: availability.provenance,
  };
}
