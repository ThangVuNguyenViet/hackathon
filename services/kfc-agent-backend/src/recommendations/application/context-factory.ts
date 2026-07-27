import { z } from 'zod';
import { KFC_VIETNAM_PACK_REF } from '../../businessPacks/kfcVietnam/kfcVietnamPack.js';
import { kfcVerifiedStateSnapshotSchema } from '../../businessPacks/kfcVietnam/kfcVerifiedStateSchema.js';
import { validatePackStateEnvelope } from '../../runtime/businessPack.js';
import type {
  RecommendationDecisionRequest,
  RecommendationState,
} from '../domain/contracts.js';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationState,
} from '../domain/schemas.js';
import type { RecommendationDecisionContext } from '../eligibility/types.js';
import {
  flowForDecision,
  initialRecommendationState,
} from '../state/state-machine.js';
import type {
  LoadedRecommendationPackState,
  RecommendationApplicationPersistence,
  RecommendationContextFactoryInput,
  RecommendationDecisionApplicationInput,
  RecommendationPackState,
  RecommendationPackStateDefinition,
  RecommendationServerContext,
  RecommendationServerContextSource,
  RecommendationTrustedContext,
} from './service-types.js';

const nonBlankStringSchema = z.string().trim().min(1);

const trustedContextSchema = z
  .object({
    parentCartLineId: nonBlankStringSchema.nullable().optional(),
    presentationCustomerId: nonBlankStringSchema.nullable().optional(),
    remainingBudgetVnd: z.number().int().nonnegative().nullable().optional(),
    verifiedCohorts: z
      .array(nonBlankStringSchema)
      .refine(
        (values) => new Set(values).size === values.length,
        'Verified cohorts must be unique',
      )
      .optional(),
    verifiedDietaryEvidence: z
      .object({
        evidenceId: nonBlankStringSchema,
        excludedSellableItemIds: z
          .array(nonBlankStringSchema)
          .refine(
            (values) => new Set(values).size === values.length,
            'Dietary exclusions must be unique',
          ),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const serverContextSchema = z
  .object({
    storeTimezone: nonBlankStringSchema.refine((value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, 'Server context must contain a supported IANA timezone'),
  })
  .strict();

export const kfcRecommendationPackStateDefinition: RecommendationPackStateDefinition =
  {
    packRef: KFC_VIETNAM_PACK_REF,
    schemaVersion: '1',
    parseState(value: unknown): RecommendationPackState {
      return kfcVerifiedStateSnapshotSchema.parse(
        value,
      ) as RecommendationPackState;
    },
  };

export function parseRecommendationDecisionApplicationInput(
  value: RecommendationDecisionApplicationInput,
): {
  request: RecommendationDecisionRequest;
  requestKind: 'proactive' | 'customer_requested';
  trusted: RecommendationTrustedContext;
} {
  const outer = z
    .object({
      request: z.unknown(),
      requestKind: z
        .enum(['proactive', 'customer_requested'])
        .optional()
        .default('proactive'),
      trusted: z.unknown().optional().default({}),
    })
    .strict()
    .parse(value);
  const trusted = trustedContextSchema.parse(outer.trusted);
  return {
    request: parseRecommendationDecisionRequest(outer.request),
    requestKind: outer.requestKind,
    trusted: {
      parentCartLineId: trusted.parentCartLineId ?? null,
      presentationCustomerId: trusted.presentationCustomerId ?? null,
      remainingBudgetVnd: trusted.remainingBudgetVnd ?? null,
      verifiedCohorts: [...(trusted.verifiedCohorts ?? [])].sort(),
      verifiedDietaryEvidence: trusted.verifiedDietaryEvidence
        ? {
            ...trusted.verifiedDietaryEvidence,
            excludedSellableItemIds: [
              ...trusted.verifiedDietaryEvidence.excludedSellableItemIds,
            ].sort(),
          }
        : null,
    },
  };
}

export async function loadRecommendationPackState(input: {
  persistence: RecommendationApplicationPersistence;
  packState: RecommendationPackStateDefinition;
  sessionId: string;
  orderFlowId: string;
}): Promise<LoadedRecommendationPackState> {
  const envelope = await input.persistence.getPackState(
    input.sessionId,
    input.packState.packRef,
  );
  if (!envelope) {
    return {
      envelope: undefined,
      packState: {},
      state: initialRecommendationState(input.orderFlowId),
      expectedDigest: null,
    };
  }
  const packState = await validatePackStateEnvelope(envelope, {
    packRef: input.packState.packRef,
    schemaVersion: input.packState.schemaVersion,
    parseState: input.packState.parseState,
  });
  const state = packState.recommendationState
    ? parseRecommendationState(packState.recommendationState)
    : initialRecommendationState(input.orderFlowId);
  if (state.orderFlowId !== input.orderFlowId) {
    throw new Error('recommendation_order_flow_mismatch');
  }
  return {
    envelope,
    packState,
    state,
    expectedDigest: envelope.integrity.digest,
  };
}

function inferredParentCartLineId(
  request: RecommendationDecisionRequest,
  starterDecision: RecommendationContextFactoryInput['starterDecision'],
): string | null {
  if (
    request.placement !== 'modifier_upsell' ||
    !starterDecision ||
    starterDecision.request.sessionId !== request.sessionId ||
    starterDecision.request.orderFlowId !== request.orderFlowId ||
    (starterDecision.request.placement !== 'local_favorite' &&
      starterDecision.request.placement !== 'for_you') ||
    starterDecision.response.status !== 'recommended'
  ) {
    return null;
  }
  const priorLineIds = new Set(
    starterDecision.request.cart.lines.map((line) => line.lineId),
  );
  const recommendedSellableItemIds = new Set(
    starterDecision.response.primaryOffer?.actions.flatMap((action) =>
      action.type === 'add_product' ? [action.sellableItemId] : [],
    ) ?? [],
  );
  const matchingNewLines = request.cart.lines.filter(
    (line) =>
      !priorLineIds.has(line.lineId) &&
      recommendedSellableItemIds.has(line.sellableItemId),
  );
  return matchingNewLines.length === 1 ? matchingNewLines[0]!.lineId : null;
}

function customerHistoryFor(
  request: RecommendationDecisionRequest,
  record: Awaited<
    ReturnType<
      import('../history/repository.js').CustomerHistoryRepository['load']
    >
  >,
): RecommendationDecisionContext['customerHistory'] {
  if (
    !record ||
    !request.verifiedCustomerRef ||
    record.verifiedCustomerRef !== request.verifiedCustomerRef
  ) {
    return null;
  }
  return {
    verifiedCustomerRef: record.verifiedCustomerRef,
    completedOrders: structuredClone(record.completedOrders),
  };
}

export async function createRecommendationDecisionContext(input: {
  parsed: RecommendationContextFactoryInput;
  historyRepository: import('../history/repository.js').CustomerHistoryRepository;
  contextSource: RecommendationServerContextSource;
}): Promise<RecommendationDecisionContext> {
  const { request, requestKind, trusted, state, starterDecision } =
    input.parsed;
  const [rawServerContext, history] = await Promise.all([
    input.contextSource.load(request),
    request.verifiedCustomerRef
      ? input.historyRepository.load(request.verifiedCustomerRef)
      : Promise.resolve(null),
  ]);
  const serverContext: RecommendationServerContext =
    serverContextSchema.parse(rawServerContext);
  const parentCartLineId =
    trusted.parentCartLineId ??
    inferredParentCartLineId(request, starterDecision);
  return {
    request,
    storeTimezone: serverContext.storeTimezone,
    verifiedCohorts: [...(trusted.verifiedCohorts ?? [])],
    flow: flowForDecision(state, request.placement, requestKind),
    parentCartLineId,
    remainingBudgetVnd: trusted.remainingBudgetVnd ?? null,
    verifiedDietaryEvidence:
      trusted.verifiedDietaryEvidence === undefined
        ? null
        : structuredClone(trusted.verifiedDietaryEvidence),
    customerHistory: customerHistoryFor(request, history),
  };
}
