import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  certificateIsIssuedFor,
  activationProofMatches,
  endpointsAreAvailable,
  qualifiedBundleManifestMatches,
  manifestDigestMatches,
  ociManifestSupports,
  previousReleaseIsCompletedAndCompatible,
  templateHasAlarmLinkedCanaryRollback,
} from "../lib/artifact-verification.js";

const digest = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("immutable deployment artifact verification", () => {
  it("matches complete file content to a sha256 digest", () => {
    expect(manifestDigestMatches(Buffer.from("release"), digest("release"))).toBe(true);
    expect(manifestDigestMatches(Buffer.from("release"), digest("release").slice(7))).toBe(true);
    expect(manifestDigestMatches(Buffer.from("tampered"), digest("release"))).toBe(false);
  });

  it("requires an ISSUED certificate covering the exact private server name", () => {
    const certificate = {
      Status: "ISSUED",
      DomainName: "recommendations.internal.example.com",
      SubjectAlternativeNames: ["recommendations.internal.example.com"],
    };
    expect(certificateIsIssuedFor(certificate, "recommendations.internal.example.com")).toBe(true);
    expect(certificateIsIssuedFor({ ...certificate, Status: "PENDING_VALIDATION" }, "recommendations.internal.example.com")).toBe(false);
    expect(certificateIsIssuedFor(certificate, "other.internal.example.com")).toBe(false);
  });

  it("requires an OCI index containing the exact linux/arm64 digest", () => {
    const index = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        { digest: `sha256:${"a".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
      ],
    });
    const imageDigest = digest(index);
    expect(ociManifestSupports(index, imageDigest, "linux", "arm64")).toBe(true);
    expect(ociManifestSupports(index, imageDigest, "linux", "amd64")).toBe(false);
  });

  it("requires the rollback release to be completed and contract-compatible", () => {
    const previous = {
      releaseDigest: `sha256:${"b".repeat(64)}`,
      state: "completed",
      contractDigest: `sha256:${"c".repeat(64)}`,
    };
    expect(
      previousReleaseIsCompletedAndCompatible(
        previous,
        previous.releaseDigest,
        previous.contractDigest,
      ),
    ).toBe(true);
    expect(
      previousReleaseIsCompletedAndCompatible(
        { ...previous, state: "failed" },
        previous.releaseDigest,
        previous.contractDigest,
      ),
    ).toBe(false);
  });

  it("requires canary traffic, alarms, and both automatic rollback mechanisms", () => {
    const valid = {
      Resources: {
        Service: {
          Type: "AWS::ECS::Service",
          Properties: {
            DeploymentConfiguration: {
              Strategy: "CANARY",
              CanaryConfiguration: { CanaryPercent: 10, CanaryBakeTimeInMinutes: 5 },
              DeploymentCircuitBreaker: { Enable: true, Rollback: true },
              Alarms: { Enable: true, Rollback: true, AlarmNames: [{ Ref: "SafetyAlarm" }] },
            },
          },
        },
      },
    };
    expect(templateHasAlarmLinkedCanaryRollback(valid)).toBe(true);
    expect(
      templateHasAlarmLinkedCanaryRollback({
        Resources: {
          Service: {
            ...valid.Resources.Service,
            Properties: { DeploymentConfiguration: { Strategy: "ROLLING" } },
          },
        },
      }),
    ).toBe(false);
  });

  it("requires trusted ports, mounted QMB, telemetry, and cross-runtime warmup before activation", () => {
    const bindings = {
      releaseDigest: "a".repeat(64),
      bundleDigest: "b".repeat(64),
      contractDigest: "c".repeat(64),
      featureDigest: "d".repeat(64),
      composerDigest: "e".repeat(64),
    };
    const proof = {
      schemaVersion: "kfc-recommendation-activation-proof-v1",
      ...bindings,
      mainPort: 8080,
      scorerPort: 8081,
      trustedPortsAvailable: true,
      bundleMounted: true,
      crossRuntimeWarmupPassed: true,
      telemetryContractVerified: true,
      structuredLogsVerified: true,
      adotHealthy: true,
    };
    expect(activationProofMatches(proof, bindings)).toBe(true);
    expect(activationProofMatches({ ...proof, bundleMounted: false }, bindings)).toBe(false);
  });

  it("requires all eight deployed endpoint IDs to be available", () => {
    const endpoints = Array.from({ length: 8 }, (_, index) => ({
      VpcEndpointId: `vpce-${index}`,
      State: "available",
    }));
    expect(endpointsAreAvailable(endpoints, endpoints.map(({ VpcEndpointId }) => VpcEndpointId))).toBe(true);
    expect(endpointsAreAvailable([{ ...endpoints[0], State: "pending" }, ...endpoints.slice(1)], endpoints.map(({ VpcEndpointId }) => VpcEndpointId))).toBe(false);
  });

  it("requires an atomic four-ranker bundle bound to every runtime contract digest", () => {
    const bindings = {
      bundleDigest: "b".repeat(64),
      contractDigest: "c".repeat(64),
      featureDigest: "d".repeat(64),
      composerDigest: "e".repeat(64),
    };
    const manifest = {
      schemaVersion: "kfc-qualified-model-bundle-v1",
      ...bindings,
      featureContractDigest: bindings.featureDigest,
      composerContractDigest: bindings.composerDigest,
      champions: {
        local_favorite: "lightgbm",
        for_you: "xgboost",
        modifier_upsell: "logistic",
        smart_cross_sell: "lightgbm",
      },
      payloadDigests: { "models/example": "f".repeat(64) },
    };
    expect(qualifiedBundleManifestMatches(manifest, bindings)).toBe(true);
    expect(qualifiedBundleManifestMatches({ ...manifest, champions: {} }, bindings)).toBe(false);
  });
});
