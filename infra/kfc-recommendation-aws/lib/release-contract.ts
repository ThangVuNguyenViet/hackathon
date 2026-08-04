const IMMUTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/;

export interface ReleaseInputs {
  readonly region: string;
  readonly mainImageDigest: string;
  readonly scorerImageDigest: string;
  readonly adotImageDigest: string;
  readonly qualifiedBundleDigest: string;
  readonly releaseDigest: string;
  readonly previousReleaseDigest?: string;
  readonly allowRollbackToPaused?: boolean;
}

const requireDigest = (name: string, value: string | undefined): void => {
  if (value === undefined || !IMMUTABLE_DIGEST.test(value)) {
    throw new Error(`${name} must be an immutable lowercase sha256 digest`);
  }
};

export const assertDeployableRelease = <T extends ReleaseInputs>(release: T): T => {
  if (release.region !== "ap-southeast-1") {
    throw new Error("recommendation sandbox releases are restricted to ap-southeast-1");
  }
  requireDigest("Main image", release.mainImageDigest);
  requireDigest("scorer image", release.scorerImageDigest);
  requireDigest("ADOT image", release.adotImageDigest);
  requireDigest("Qualified Model Bundle", release.qualifiedBundleDigest);
  requireDigest("release", release.releaseDigest);
  if (release.previousReleaseDigest === undefined) {
    if (!release.allowRollbackToPaused) {
      throw new Error(
        "a previous compatible release digest is required unless rollback-to-paused is explicit",
      );
    }
  } else {
    requireDigest("previous compatible release", release.previousReleaseDigest);
  }
  return release;
};

export const immutableDigestPattern = "^sha256:[a-f0-9]{64}$";
