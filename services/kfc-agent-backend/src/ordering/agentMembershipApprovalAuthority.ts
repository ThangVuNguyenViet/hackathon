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

type MembershipEligibilityState = Pick<
  AgentGraphState,
  "activeCollectionKeys" | "verifiedCollections"
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

function activeSnapshot(
  state: MembershipEligibilityState | undefined,
  toolName: "listMembershipRewards",
): VerifiedCollectionSnapshot<GeneratedMembershipRewardOffer> | undefined;
function activeSnapshot(
  state: MembershipEligibilityState | undefined,
  toolName: "listMembershipWallet",
): VerifiedCollectionSnapshot<GeneratedMembershipWalletVoucher> | undefined;
function activeSnapshot(
  state: MembershipEligibilityState | undefined,
  toolName: "listMembershipTools",
): VerifiedCollectionSnapshot<GeneratedMembershipToolDefinition> | undefined;
function activeSnapshot(
  state: MembershipEligibilityState | undefined,
  toolName: "listMembershipRewards" | "listMembershipWallet" |
    "listMembershipTools",
): VerifiedCollectionSnapshot<
  GeneratedMembershipRewardOffer |
  GeneratedMembershipWalletVoucher |
  GeneratedMembershipToolDefinition
> | undefined {
  const key = state?.activeCollectionKeys?.[toolName];
  if (!key) return undefined;
  const snapshots = state?.verifiedCollections?.[toolName];
  const snapshot = snapshots?.[key];
  if (
    !snapshot ||
    snapshot.key !== key ||
    typeof snapshot.revision !== "string" ||
    !snapshot.revision.trim() ||
    typeof snapshot.providerRevision !== "string" ||
    !snapshot.providerRevision.trim() ||
    !snapshot.result ||
    !Array.isArray(snapshot.result.items) ||
    typeof snapshot.result.returned !== "number" ||
    typeof snapshot.result.total !== "number" ||
    typeof snapshot.result.complete !== "boolean" ||
    snapshot.result.returned !== snapshot.result.items.length ||
    snapshot.result.total < snapshot.result.returned
  ) {
    return undefined;
  }
  return snapshot;
}

function membershipCapabilityEligibilityEvidence(input: {
  state: MembershipEligibilityState | undefined;
  capability: MembershipApprovalCapability;
}): Extract<MembershipApprovalEvidence, { ok: true }> | undefined {
  const toolSnapshot = activeSnapshot(
    input.state,
    "listMembershipTools",
  );
  const expectedSideEffect = input.capability === "acquireVoucher"
    ? "voucher_acquisition"
    : "reward_redemption";
  const toolVerified = toolSnapshot?.result.items.some(
    (candidate) =>
      candidate.toolName === input.capability &&
      candidate.requiresUserConfirmation === true &&
      candidate.sideEffect === expectedSideEffect,
  );
  const targetSnapshot = input.capability === "acquireVoucher"
    ? activeSnapshot(
      input.state,
      "listMembershipRewards",
    )
    : activeSnapshot(
      input.state,
      "listMembershipWallet",
    );
  if (!toolSnapshot || !toolVerified || !targetSnapshot?.result.items.length) {
    return undefined;
  }
  return { ok: true, targetSnapshot, toolSnapshot };
}

export function hasCurrentMembershipCapabilityEligibility(input: {
  state: MembershipEligibilityState | undefined;
  capability: MembershipApprovalCapability;
}): boolean {
  return Boolean(membershipCapabilityEligibilityEvidence(input));
}

export function currentMembershipApprovalEvidence(input: {
  state: AgentGraphState | undefined;
  capability: MembershipApprovalCapability;
  targetId: string;
  channel?: string;
}): MembershipApprovalEvidence {
  const eligibility = membershipCapabilityEligibilityEvidence(input);
  if (!eligibility) {
    return {
      ok: false,
      errorCode: "unverified_membership_target",
      message:
        "Membership capability must be present in current verified state",
    };
  }

  const { targetSnapshot, toolSnapshot } = eligibility;
  if (input.capability === "acquireVoucher") {
    const targetVerified = targetSnapshot.result.items.some(
      (candidate) => "rewardId" in candidate &&
        candidate.rewardId === input.targetId,
    );
    return targetVerified
      ? { ok: true, targetSnapshot, toolSnapshot }
      : {
          ok: false,
          errorCode: "unverified_membership_target",
          message:
            "Membership reward must be present in current verified state",
        };
  }

  const target = targetSnapshot.result.items.find(
    (candidate) => "voucherId" in candidate &&
      candidate.voucherId === input.targetId,
  );
  if (!target) {
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
