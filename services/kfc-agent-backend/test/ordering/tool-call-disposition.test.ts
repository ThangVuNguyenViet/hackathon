import { describe, expect, it } from "vitest";
import {
  agentToolCallDisposition,
} from "../../src/ordering/toolCallDisposition.js";

describe("canonical agent tool-call disposition", () => {
  it("treats membership actions as irreversible without a model consent flag", () => {
    expect(agentToolCallDisposition("acquireVoucher", {
      rewardId: "reward-discount-10k",
    })).toEqual({
      success: true,
      data: {
        toolName: "acquireVoucher",
        arguments: {
          rewardId: "reward-discount-10k",
        },
        effect: "irreversible_mutation",
      },
    });
    expect(agentToolCallDisposition("redeemReward", {
      voucherId: "wallet-new-member-25k",
      channel: "zalo_miniapp",
    })).toEqual({
      success: true,
      data: {
        toolName: "redeemReward",
        arguments: {
          voucherId: "wallet-new-member-25k",
          channel: "zalo_miniapp",
        },
        effect: "irreversible_mutation",
      },
    });
  });

  it.each([
    ["acquireVoucher", {
      rewardId: "reward-discount-10k",
      confirmed: false,
    }],
    [
      "redeemReward",
      {
        voucherId: "wallet-new-member-25k",
        channel: "zalo_miniapp",
        confirmed: true,
      },
    ],
  ] as const)("rejects model-supplied confirmation authority for %s", (toolName, args) => {
    expect(agentToolCallDisposition(toolName, args).success).toBe(false);
  });

  it("keeps reversible mutation and provider read distinct", () => {
    expect(agentToolCallDisposition("updateCart", {
      changes: [{
        itemCode: "20751",
        quantity: 1,
        modifiers: [],
      }],
    })).toMatchObject({
      success: true,
      data: { effect: "reversible_mutation" },
    });
    expect(agentToolCallDisposition("listMembershipTools", {
      sideEffect: null,
    })).toMatchObject({
      success: true,
      data: { effect: "provider_read" },
    });
  });
});
