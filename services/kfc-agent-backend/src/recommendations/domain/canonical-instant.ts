const canonicalUtcInstantPartsPattern =
  /^(?<whole>[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])(?:\.(?<fraction>[0-9]+))?Z$/u;

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
