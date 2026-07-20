import type {
  GeneratedMembershipRewardOffer,
  GeneratedMembershipToolDefinition,
  GeneratedMembershipWalletVoucher,
} from "../fixtures/schema.js";
import type { AgentGraphState } from "../graph/state.js";
import type {
  CommerceApprovalCapability,
  VerifiedCollectionSnapshot,
} from "./types.js";

type MembershipApprovalCapability = Extract<
  CommerceApprovalCapability,
  "acquireVoucher" | "redeemReward"
>;

export type MembershipApprovalEvidence =
  | {
      ok: true;
      targetSnapshot: VerifiedCollectionSnapshot<
        GeneratedMembershipRewardOffer | GeneratedMembershipWalletVoucher
      >;
      toolSnapshot:
        VerifiedCollectionSnapshot<GeneratedMembershipToolDefinition>;
    }
  | {
      ok: false;
      errorCode:
        | "unverified_membership_target"
        | "unverified_membership_channel";
      message: string;
    };

function activeSnapshot<Item>(
  state: AgentGraphState | undefined,
  toolName: "listMembershipRewards" | "listMembershipWallet" |
    "listMembershipTools",
): VerifiedCollectionSnapshot<Item> | undefined {
  const key = state?.activeCollectionKeys?.[toolName];
  if (!key) return undefined;
  const snapshots = state?.verifiedCollections?.[toolName] as
    Record<string, VerifiedCollectionSnapshot<Item>> | undefined;
  return snapshots?.[key];
}

export function currentMembershipApprovalEvidence(input: {
  state: AgentGraphState | undefined;
  capability: MembershipApprovalCapability;
  targetId: string;
  channel?: string;
}): MembershipApprovalEvidence {
  const toolSnapshot =
    activeSnapshot<GeneratedMembershipToolDefinition>(
      input.state,
      "listMembershipTools",
    );
  const expectedSideEffect = input.capability === "acquireVoucher"
    ? "voucher_acquisition"
    : "reward_redemption";
  const toolVerified = toolSnapshot?.result.items.some(
    (candidate) =>
      candidate.toolName === input.capability &&
      candidate.requiresUserConfirmation &&
      candidate.sideEffect === expectedSideEffect,
  );
  if (!toolSnapshot || !toolVerified) {
    return {
      ok: false,
      errorCode: "unverified_membership_target",
      message:
        "Membership capability must be present in current verified state",
    };
  }

  if (input.capability === "acquireVoucher") {
    const targetSnapshot = activeSnapshot<GeneratedMembershipRewardOffer>(
      input.state,
      "listMembershipRewards",
    );
    const targetVerified = targetSnapshot?.result.items.some(
      (candidate) => candidate.rewardId === input.targetId,
    );
    return targetSnapshot && targetVerified
      ? { ok: true, targetSnapshot, toolSnapshot }
      : {
          ok: false,
          errorCode: "unverified_membership_target",
          message:
            "Membership reward must be present in current verified state",
        };
  }

  const targetSnapshot = activeSnapshot<GeneratedMembershipWalletVoucher>(
    input.state,
    "listMembershipWallet",
  );
  const target = targetSnapshot?.result.items.find(
    (candidate) => candidate.voucherId === input.targetId,
  );
  if (!targetSnapshot || !target) {
    return {
      ok: false,
      errorCode: "unverified_membership_target",
      message:
        "Membership voucher must be present in current verified state",
    };
  }
  if (!input.channel || !target.channels.includes(input.channel)) {
    return {
      ok: false,
      errorCode: "unverified_membership_channel",
      message:
        "Reward redemption channel is not present in verified wallet evidence",
    };
  }
  return { ok: true, targetSnapshot, toolSnapshot };
}
