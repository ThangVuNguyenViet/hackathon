import { describe, expect, it } from "vitest";

import { canonicalScopeAliases, cognitoScopeFor } from "../lib/scope-aliases.js";

describe("provider-neutral scope aliases", () => {
  it("maps every canonical OpenAPI scope to exactly one Cognito scope", () => {
    expect(canonicalScopeAliases).toEqual({
      "recommendations.decision:write": "recommendations/decision.write",
      "recommendations.event:write": "recommendations/event.write",
      "recommendations.inspection:read": "recommendations/inspection.read",
    });
    expect(cognitoScopeFor("recommendations.decision:write")).toBe(
      "recommendations/decision.write",
    );
  });

  it("rejects unknown or misspelled canonical authority", () => {
    expect(() => cognitoScopeFor("recommendations.decision:read")).toThrow(
      "unknown canonical recommendation scope",
    );
  });
});
