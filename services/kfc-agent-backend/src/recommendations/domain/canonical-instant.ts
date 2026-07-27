const canonicalUtcInstantPartsPattern =
  /^(?<whole>(?<year>[0-9]{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])T(?<hour>[01][0-9]|2[0-3]):(?<minute>[0-5][0-9]):(?<second>[0-5][0-9]))(?:\.(?<fraction>[0-9]+))?Z$/u;

type CanonicalUtcInstantParts = {
  fraction: string;
  wholeSecondEpoch: number;
};

function canonicalUtcInstantParts(
  value: string,
): CanonicalUtcInstantParts | null {
  const match = canonicalUtcInstantPartsPattern.exec(value);
  if (!match?.groups) return null;

  const wholeSecondEpoch = Date.parse(`${match.groups.whole}Z`);
  if (!Number.isFinite(wholeSecondEpoch)) return null;
  const parsed = new Date(wholeSecondEpoch);
  if (
    parsed.getUTCFullYear() !== Number(match.groups.year) ||
    parsed.getUTCMonth() + 1 !== Number(match.groups.month) ||
    parsed.getUTCDate() !== Number(match.groups.day) ||
    parsed.getUTCHours() !== Number(match.groups.hour) ||
    parsed.getUTCMinutes() !== Number(match.groups.minute) ||
    parsed.getUTCSeconds() !== Number(match.groups.second)
  ) {
    return null;
  }
  return {
    fraction: (match.groups.fraction ?? '').replace(/0+$/u, ''),
    wholeSecondEpoch,
  };
}

export function compareCanonicalUtcInstants(
  left: string,
  right: string,
): number | null {
  const leftParts = canonicalUtcInstantParts(left);
  const rightParts = canonicalUtcInstantParts(right);
  if (!leftParts || !rightParts) return null;

  if (leftParts.wholeSecondEpoch !== rightParts.wholeSecondEpoch) {
    return leftParts.wholeSecondEpoch < rightParts.wholeSecondEpoch ? -1 : 1;
  }

  const precision = Math.max(
    leftParts.fraction.length,
    rightParts.fraction.length,
  );
  const normalizedLeft = leftParts.fraction.padEnd(precision, '0');
  const normalizedRight = rightParts.fraction.padEnd(precision, '0');
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

export function canonicalUtcInstantOccursBefore(
  earlier: string,
  later: string,
): boolean {
  return compareCanonicalUtcInstants(earlier, later) === -1;
}

export function strictlyLaterCanonicalUtcInstant(
  candidate: string,
  lowerBound: string,
): string {
  const comparison = compareCanonicalUtcInstants(candidate, lowerBound);
  if (comparison === null) {
    throw new Error('canonical_utc_instant_invalid');
  }
  if (comparison > 0) return candidate;

  const lowerBoundParts = canonicalUtcInstantPartsPattern.exec(lowerBound);
  if (!lowerBoundParts?.groups) {
    throw new Error('canonical_utc_instant_invalid');
  }
  return `${lowerBoundParts.groups.whole}.${lowerBoundParts.groups.fraction ?? ''}1Z`;
}
