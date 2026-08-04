import { createHash, timingSafeEqual } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CONTENT_DIGEST = /^[a-f0-9]{64}$/;

export const manifestDigestMatches = (content: Buffer, expected: string): boolean => {
  if (!DIGEST.test(expected) && !CONTENT_DIGEST.test(expected)) return false;
  const computed = createHash("sha256").update(content).digest("hex");
  const actual = expected.startsWith("sha256:") ? `sha256:${computed}` : computed;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

export interface CertificateDescription {
  readonly Status?: string;
  readonly DomainName?: string;
  readonly SubjectAlternativeNames?: readonly string[];
}

export const certificateIsIssuedFor = (
  certificate: CertificateDescription | undefined,
  serverName: string,
): boolean => {
  if (certificate?.Status !== "ISSUED") return false;
  const names = new Set([certificate.DomainName, ...(certificate.SubjectAlternativeNames ?? [])]);
  return names.has(serverName);
};

interface OciIndex {
  readonly schemaVersion?: number;
  readonly manifests?: ReadonlyArray<{
    readonly digest?: string;
    readonly platform?: { readonly os?: string; readonly architecture?: string };
  }>;
}

export const ociManifestSupports = (
  manifest: string | undefined,
  imageDigest: string,
  os: string,
  architecture: string,
): boolean => {
  if (manifest === undefined || !DIGEST.test(imageDigest)) return false;
  try {
    const index = JSON.parse(manifest) as OciIndex;
    return (
      index.schemaVersion === 2 &&
      manifestDigestMatches(Buffer.from(manifest), imageDigest) &&
      (index.manifests ?? []).some(
        (entry) =>
          entry.platform?.os === os &&
          entry.platform.architecture === architecture,
      )
    );
  } catch {
    return false;
  }
};

export interface PreviousReleaseRecord {
  readonly releaseDigest?: string;
  readonly state?: string;
  readonly contractDigest?: string;
}

export const previousReleaseIsCompletedAndCompatible = (
  record: PreviousReleaseRecord | undefined,
  expectedReleaseDigest: string,
  currentContractDigest: string,
): boolean =>
  record?.state === "completed" &&
  record.releaseDigest === expectedReleaseDigest &&
  record.contractDigest === currentContractDigest &&
  (DIGEST.test(expectedReleaseDigest) || CONTENT_DIGEST.test(expectedReleaseDigest)) &&
  (DIGEST.test(currentContractDigest) || CONTENT_DIGEST.test(currentContractDigest));

interface CloudFormationTemplate {
  readonly Resources?: Record<string, {
    readonly Type?: string;
    readonly Properties?: { readonly DeploymentConfiguration?: Record<string, unknown> };
  }>;
}

export const templateHasAlarmLinkedCanaryRollback = (
  template: CloudFormationTemplate,
): boolean =>
  Object.values(template.Resources ?? {}).some((resource) => {
    if (resource.Type !== "AWS::ECS::Service") return false;
    const configuration = resource.Properties?.DeploymentConfiguration as
      | {
          Strategy?: string;
          CanaryConfiguration?: { CanaryPercent?: number; CanaryBakeTimeInMinutes?: number };
          DeploymentCircuitBreaker?: { Enable?: boolean; Rollback?: boolean };
          Alarms?: { Enable?: boolean; Rollback?: boolean; AlarmNames?: unknown[] };
        }
      | undefined;
    return (
      configuration?.Strategy === "CANARY" &&
      (configuration.CanaryConfiguration?.CanaryPercent ?? 0) > 0 &&
      (configuration.CanaryConfiguration?.CanaryBakeTimeInMinutes ?? 0) > 0 &&
      configuration.DeploymentCircuitBreaker?.Enable === true &&
      configuration.DeploymentCircuitBreaker.Rollback === true &&
      configuration.Alarms?.Enable === true &&
      configuration.Alarms.Rollback === true &&
      (configuration.Alarms.AlarmNames?.length ?? 0) > 0
    );
  });

export interface ActivationBindings {
  readonly releaseDigest: string;
  readonly bundleDigest: string;
  readonly contractDigest: string;
  readonly featureDigest: string;
  readonly composerDigest: string;
}

export const activationProofMatches = (
  value: unknown,
  bindings: ActivationBindings,
): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    proof.schemaVersion === "kfc-recommendation-activation-proof-v1" &&
    proof.releaseDigest === bindings.releaseDigest &&
    proof.bundleDigest === bindings.bundleDigest &&
    proof.contractDigest === bindings.contractDigest &&
    proof.featureDigest === bindings.featureDigest &&
    proof.composerDigest === bindings.composerDigest &&
    proof.mainPort === 8080 &&
    proof.scorerPort === 8081 &&
    proof.trustedPortsAvailable === true &&
    proof.bundleMounted === true &&
    proof.crossRuntimeWarmupPassed === true &&
    proof.telemetryContractVerified === true &&
    proof.structuredLogsVerified === true &&
    proof.adotHealthy === true
  );
};

export interface VpcEndpointState {
  readonly VpcEndpointId?: string;
  readonly State?: string;
}

export const endpointsAreAvailable = (
  endpoints: readonly VpcEndpointState[],
  expectedIds: readonly string[],
): boolean => {
  if (expectedIds.length !== 8 || new Set(expectedIds).size !== 8) return false;
  const states = new Map(endpoints.map((endpoint) => [endpoint.VpcEndpointId, endpoint.State]));
  return expectedIds.every((id) => states.get(id) === "available");
};

export const qualifiedBundleManifestMatches = (
  value: unknown,
  bindings: Omit<ActivationBindings, "releaseDigest">,
): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  const champions = manifest.champions;
  const payloads = manifest.payloadDigests;
  return (
    manifest.schemaVersion === "kfc-qualified-model-bundle-v1" &&
    manifest.bundleDigest === bindings.bundleDigest &&
    manifest.contractDigest === bindings.contractDigest &&
    manifest.featureContractDigest === bindings.featureDigest &&
    manifest.composerContractDigest === bindings.composerDigest &&
    typeof champions === "object" &&
    champions !== null &&
    Object.keys(champions).sort().join(",") ===
      "for_you,local_favorite,modifier_upsell,smart_cross_sell" &&
    typeof payloads === "object" &&
    payloads !== null &&
    Object.keys(payloads).length > 0
  );
};
