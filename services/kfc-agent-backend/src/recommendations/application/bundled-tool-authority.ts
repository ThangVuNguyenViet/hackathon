import promotionSnapshotJson from '../../../fixtures/recommendations/promotion-snapshot-v1.json' with { type: 'json' };
import type { AgentTurnInput } from '../../agent/agentTurn.js';
import type { AgentState } from '../../agent/agentState.js';
import { loadBundledGeneratedFixtures } from '../../fixtures/bundledFixtures.js';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { authorizeCustomerAccess } from '../../security/customerAccessContext.js';
import type { CommerceSnapshotBindings } from '../domain/contracts.js';
import { promotionFactsSnapshotSchema } from '../snapshots/schemas.js';
import type { RecommendationApplicationService } from './service-types.js';
import type { RecommendationToolExecutionAuthority } from './tool-execution.js';

const promotionSnapshot = promotionFactsSnapshotSchema.parse(
  promotionSnapshotJson,
);

let bundledBindingsPromise: Promise<CommerceSnapshotBindings> | undefined;

function bundledBindings(): Promise<CommerceSnapshotBindings> {
  bundledBindingsPromise ??= (async () => {
    const fixtures = loadBundledGeneratedFixtures();
    const values = {
      catalog: fixtures.menuItems,
      modifierGraph: fixtures.menuModifiers,
      store: fixtures.stores,
      availability: fixtures.storeAvailability,
      promotion: promotionSnapshot,
    };
    const digests = Object.fromEntries(
      await Promise.all(
        Object.entries(values).map(async ([name, value]) => [
          name,
          await digestCommerceAction(value),
        ]),
      ),
    ) as Record<keyof typeof values, string>;
    const binding = (name: keyof typeof values, sourceRevision: string) => ({
      snapshotId: `bundled-${name}:${digests[name].slice(0, 24)}`,
      digest: digests[name],
      sourceRevision,
      observedAt: promotionSnapshot.observedAt,
      effectiveAt: promotionSnapshot.effectiveAt,
      expiresAt: promotionSnapshot.expiresAt,
      complete: true,
      commerceEnvironment: promotionSnapshot.commerceEnvironment,
      provenance: {
        source: 'server-owned-bundled-commerce',
        reference: sourceRevision,
      },
    });
    return {
      catalog: binding('catalog', 'generated-menu-items'),
      modifierGraph: binding('modifierGraph', 'generated-menu-modifiers'),
      store: binding('store', 'generated-stores'),
      availability: binding('availability', 'generated-store-availability'),
      promotion: binding('promotion', promotionSnapshot.sourceRevision),
    };
  })();
  return bundledBindingsPromise;
}

function decisionTimeFor(
  bindings: CommerceSnapshotBindings,
  durableDecisionTime: string | undefined,
): string {
  if (!durableDecisionTime) return new Date().toISOString();
  return new Date(
    Math.max(
      Date.parse(durableDecisionTime),
      ...Object.values(bindings).flatMap((binding) => [
        Date.parse(binding.observedAt),
        Date.parse(binding.effectiveAt),
      ]),
    ),
  ).toISOString();
}

async function verifiedCustomer(input: {
  turnInput: AgentTurnInput;
  application: RecommendationApplicationService;
}): Promise<RecommendationToolExecutionAuthority['verifiedCustomer']> {
  const access = authorizeCustomerAccess(input.turnInput.accessContext, {
    channel: input.turnInput.channel,
    sessionId: input.turnInput.sessionId,
    customerId: input.turnInput.customerId,
    scope: 'customer:read',
  });
  if (!access.allowed) return null;
  const ref = input.turnInput.accessContext!.kfcSubjectRef;
  if (ref === 'none' || ref === 'unknown') return null;
  return {
    ref,
    hasPriorCompletedHistory:
      await input.application.hasPriorCompletedHistory(ref),
  };
}

export async function createBundledRecommendationToolAuthority(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  application: RecommendationApplicationService;
  durableDecisionTime?: string;
}): Promise<RecommendationToolExecutionAuthority> {
  const fixtures = loadBundledGeneratedFixtures();
  const commerceSnapshotBindings = await bundledBindings();
  const storeId =
    input.state.fulfillment?.storeId ?? fixtures.stores[0]?.storeId;
  if (!storeId) throw new Error('recommendation_store_context_unavailable');
  return {
    application: input.application,
    verifiedCustomer: await verifiedCustomer(input),
    storeId,
    fulfilmentMode:
      input.state.fulfillment?.disposition ??
      input.state.fulfillment?.method ??
      'pickup',
    decisionTime: decisionTimeFor(
      commerceSnapshotBindings,
      input.durableDecisionTime,
    ),
    commerceSnapshotBindings,
    experimentProfile: {
      profileId: 'kfc-recommendation-baseline-v1',
      outputMode: 'baseline',
    },
  };
}
