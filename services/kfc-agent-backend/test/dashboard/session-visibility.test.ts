import { describe, expect, it } from "vitest";
import { dashboardSessionTarget } from "../../src/dashboard/sessionVisibility.js";

describe("dashboard session visibility", () => {
  it("keeps real operator channels visible", () => {
    expect(dashboardSessionTarget("messenger:28063993789864606")).toEqual({
      channel: "messenger",
      externalUserId: "28063993789864606",
    });
    expect(dashboardSessionTarget("zalo:zalo_user_1")).toEqual({
      channel: "zalo",
      externalUserId: "zalo_user_1",
    });
    expect(dashboardSessionTarget("kfc:anon_customer_1")).toEqual({
      channel: "kfc",
      externalUserId: "anon_customer_1",
    });
  });

  it("hides non-operator session shapes from the operator dashboard", () => {
    expect(dashboardSessionTarget("web_mock:local_customer_1")).toBeUndefined();
    expect(dashboardSessionTarget("web:kfc-customer")).toBeUndefined();
    expect(dashboardSessionTarget("plain_session")).toBeUndefined();
    expect(dashboardSessionTarget("messenger:")).toBeUndefined();
  });
});
