import { z } from 'zod';
import { plannerOutputSchema } from './toolPlannerNormalization.js';
import type { PendingDecision } from './toolPlannerNormalization.js';
import type { ToolPlannerInput } from './toolPlanner.js';

export function normalizeBoundedHandoffPlan(
  input: ToolPlannerInput,
  parsed: z.infer<typeof plannerOutputSchema>,
): z.infer<typeof plannerOutputSchema> {
  if (
    parsed.intent !== 'handoff' ||
    !parsed.toolCalls.some((call) => call.toolName === 'handoff')
  ) return parsed;
  const allowedTools = input.state.order
    ? new Set(['getOrderStatus', 'checkPaymentStatus', 'handoff'])
    : new Set(['handoff']);
  return {
    ...parsed,
    entities: {
      ...parsed.entities,
      cartMutationRequested: false,
      cartMutationConfirmed: false,
    },
    catalogSelections: [],
    toolCalls: parsed.toolCalls.filter((call) => allowedTools.has(call.toolName)),
  };
}

export function recoverVerifiedFavoriteSuggestion(
  input: ToolPlannerInput,
  parsed: z.infer<typeof plannerOutputSchema>,
  pendingDecision?: PendingDecision,
): z.infer<typeof plannerOutputSchema> {
  if (parsed.catalogSuggestion || pendingDecision?.selectionSource !== 'favorite') return parsed;
  const favorites = (input.menuCatalogContext?.candidates ?? []).filter(
    (candidate) =>
      candidate.available &&
      candidate.verifiedForMutation &&
      candidate.customerEvidenceSources?.includes('favorite'),
  );
  return favorites.length === 1
    ? {
        ...parsed,
        catalogSuggestion: {
          itemCode: favorites[0]!.code,
          source: 'favorite',
          decision: 'suggest',
        },
      }
    : parsed;
}

const membershipReadTools = new Set([
  'getMembershipProfile',
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
]);

export function withoutStaleMembershipReads<T extends { toolName: string }>(toolCalls: T[]): T[] {
  return toolCalls.filter((call) => !membershipReadTools.has(call.toolName));
}
