import type {
  ExternalCallContext,
  MembershipClient,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import type { ProviderMutationReplayRegistry } from '../clients/providerMutationReplay.js';
import type { ToolResult } from '../domain/types.js';
import type { OrderingDataService } from '../ordering/orderingDataService.js';
import type { MembershipActionResult } from '../ordering/types.js';
import { mockFailure as fail, mockSuccess as ok } from './mockToolResults.js';

type MockMembershipActions = Pick<
  MembershipClient,
  'acquireVoucher' | 'redeemReward'
>;

export function createMockMembershipActions(
  data: OrderingDataService,
  mutationReplay: ProviderMutationReplayRegistry,
): MockMembershipActions {
  function acquireVoucher(
    input: { rewardId: string; confirmed: false },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MembershipActionResult>>;
  function acquireVoucher(
    input: { rewardId: string; confirmed: true },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>>;
  async function acquireVoucher(
    input: { rewardId: string; confirmed: boolean },
    _externalCallContext: ExternalCallContext,
    mutationIdentity?: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>> {
    if (!input.confirmed) {
      const preview = data.acquireMembershipVoucher(input);
      return preview
        ? fail('confirmation_required', preview.message)
        : fail(
            'membership_reward_not_found',
            `No membership reward found for ${input.rewardId}`,
          );
    }
    if (!mutationIdentity) {
      return fail(
        'provider_mutation_identity_required',
        'A canonical provider mutation identity is required',
      );
    }
    return mutationReplay.run(mutationIdentity, async () => {
      const result = data.acquireMembershipVoucher(input);
      return result
        ? ok(result, 'voucher_acquired')
        : fail(
            'membership_reward_not_found',
            `No membership reward found for ${input.rewardId}`,
          );
    });
  }

  function redeemReward(
    input: { voucherId: string; channel?: string; confirmed: false },
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<MembershipActionResult>>;
  function redeemReward(
    input: { voucherId: string; channel?: string; confirmed: true },
    externalCallContext: ExternalCallContext,
    mutationIdentity: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>>;
  async function redeemReward(
    input: { voucherId: string; channel?: string; confirmed: boolean },
    _externalCallContext: ExternalCallContext,
    mutationIdentity?: ProviderMutationIdentity,
  ): Promise<ToolResult<MembershipActionResult>> {
    if (!input.confirmed) {
      const preview = data.redeemMembershipReward(input);
      return preview
        ? fail('confirmation_required', preview.message)
        : fail(
            'membership_voucher_not_found',
            `No membership voucher found for ${input.voucherId}`,
          );
    }
    if (!mutationIdentity) {
      return fail(
        'provider_mutation_identity_required',
        'A canonical provider mutation identity is required',
      );
    }
    return mutationReplay.run(mutationIdentity, async () => {
      const result = data.redeemMembershipReward(input);
      return result
        ? ok(result, 'reward_redeemed')
        : fail(
            'membership_voucher_not_found',
            `No membership voucher found for ${input.voucherId}`,
          );
    });
  }

  return { acquireVoucher, redeemReward };
}
