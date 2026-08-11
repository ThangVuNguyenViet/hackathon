import { describe, expect, it } from "vitest";

import {
  assertDeployableRelease,
  type ReleaseInputs,
} from "../lib/release-contract.js";

const sha256 = (character: string): string => `sha256:${character.repeat(64)}`;
const contentDigest = (character: string): string => character.repeat(64);

const validRelease = (): ReleaseInputs => ({
  region: "ap-southeast-1",
  mainImageDigest: sha256("a"),
  scorerImageDigest: sha256("b"),
  adotImageDigest: sha256("c"),
  qualifiedBundleDigest: contentDigest("d"),
  trustedCatalogDigest: contentDigest("1"),
  releaseDigest: contentDigest("e"),
  previousReleaseDigest: contentDigest("f"),
});

describe("release deployment contract", () => {
  it("accepts only an immutable Singapore release with a rollback target", () => {
    expect(assertDeployableRelease(validRelease())).toEqual(validRelease());
  });

  it.each([
    ["region", { region: "us-west-2" }],
    ["main image", { mainImageDigest: "latest" }],
    ["scorer image", { scorerImageDigest: "scorer:v1" }],
    ["ADOT image", { adotImageDigest: "sha256:short" }],
    ["bundle", { qualifiedBundleDigest: "" }],
    ["trusted catalog", { trustedCatalogDigest: "" }],
    ["release", { releaseDigest: contentDigest("A") }],
  ])("rejects a non-deployable %s binding", (_label, override) => {
    expect(() => assertDeployableRelease({ ...validRelease(), ...override })).toThrow();
  });

  it("allows the first release only in explicitly paused rollback mode", () => {
    const firstRelease = { ...validRelease(), previousReleaseDigest: undefined };
    expect(() => assertDeployableRelease(firstRelease)).toThrow(
      "previous compatible release digest",
    );
    expect(
      assertDeployableRelease({ ...firstRelease, allowRollbackToPaused: true }),
    ).toEqual({ ...firstRelease, allowRollbackToPaused: true });
  });
});
