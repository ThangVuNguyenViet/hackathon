import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalJson } from '../agent/turnSupport.js';
import type {
  LiveQualityExperimentOutput,
  ScenarioArgumentConstraint,
} from './liveQualityContracts.js';

type ArgumentEvaluationOutput = Pick<
  LiveQualityExperimentOutput,
  'stateAfter' | 'stateBefore'
>;

export function valueAtPath(
  value: unknown,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((current, segment) =>
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined, value);
}

export function valuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return isDeepStrictEqual(left, right);
}

function argumentConstraintMatches(
  constraint: ScenarioArgumentConstraint,
  call: { arguments: Record<string, unknown> },
  output: ArgumentEvaluationOutput,
): boolean {
  const actual = valueAtPath(call.arguments, constraint.path);
  switch (constraint.operator) {
    case 'exists':
      return constraint.path.split('|').some((path) =>
        valueAtPath(call.arguments, path) !== undefined);
    case 'absent':
      return constraint.path.split('|').every((path) =>
        valueAtPath(call.arguments, path) === undefined);
    case 'equals':
      return valuesEqual(actual, constraint.value);
    case 'one_of':
      return constraint.values?.some((value) =>
        valuesEqual(actual, value)) === true;
    case 'equals_state_path': {
      const authority = valueAtPath(
        constraint.stateSource === 'before'
          ? output.stateBefore
          : output.stateAfter,
        constraint.statePath ?? '',
      );
      return actual !== undefined &&
        authority !== undefined &&
        valuesEqual(actual, authority);
    }
  }
}

function privateArgumentConstraintsMatch(
  constraints: readonly ScenarioArgumentConstraint[],
  call: { arguments: Record<string, unknown> },
  output: ArgumentEvaluationOutput,
): boolean | undefined {
  const argumentKeys = Object.keys(call.arguments).sort();
  const privateDigest = call.arguments.privateArgumentsDigest;
  const explicitAddressDigest =
    call.arguments.explicitAddressInputDigest;
  const privateEnvelope =
    argumentKeys.length === 1 &&
    argumentKeys[0] === 'privateArgumentsDigest' &&
    typeof privateDigest === 'string';
  const explicitAddressEnvelope =
    (
      argumentKeys.join(',') ===
        'explicitAddressInputDigest,explicitAddressInputRedacted,method' ||
      argumentKeys.join(',') ===
        'explicitAddressInputDigest,explicitAddressInputRedacted'
    ) &&
    call.arguments.explicitAddressInputRedacted === true &&
    typeof explicitAddressDigest === 'string';
  if (!privateEnvelope && !explicitAddressEnvelope) return undefined;

  const expected: Record<string, unknown> = {};
  const setExpectedValue = (
    path: string,
    value: unknown,
  ): boolean => {
    const segments = path.split('.');
    if (
      segments.length === 0 ||
      segments.some((segment) => !segment || /^\d+$/u.test(segment))
    ) {
      return false;
    }
    let cursor = expected;
    for (const segment of segments.slice(0, -1)) {
      const existing = cursor[segment];
      if (
        existing !== undefined &&
        (
          typeof existing !== 'object' ||
          existing === null ||
          Array.isArray(existing)
        )
      ) {
        return false;
      }
      const next =
        existing as Record<string, unknown> | undefined ??
        {};
      cursor[segment] = next;
      cursor = next;
    }
    cursor[segments.at(-1)!] = value;
    return true;
  };
  for (const constraint of constraints) {
    if (constraint.path.includes('|')) return false;
    if (constraint.operator === 'equals') {
      if (!setExpectedValue(constraint.path, constraint.value)) {
        return false;
      }
      continue;
    }
    if (constraint.operator === 'equals_state_path') {
      const authority = valueAtPath(
        constraint.stateSource === 'before'
          ? output.stateBefore
          : output.stateAfter,
        constraint.statePath ?? '',
      );
      if (authority === undefined) return false;
      if (!setExpectedValue(constraint.path, authority)) return false;
      continue;
    }
    if (constraint.operator === 'absent') continue;
    return false;
  }
  const expectedDigest = createHash('sha256')
    .update(canonicalJson(expected))
    .digest('hex');
  if (
    explicitAddressEnvelope &&
    'method' in expected &&
    call.arguments.method !== expected.method
  ) {
    return false;
  }
  const digest = privateEnvelope
    ? privateDigest
    : explicitAddressDigest;
  return digest === expectedDigest;
}

export function callArgumentsMatch(
  constraints: readonly ScenarioArgumentConstraint[],
  call: { arguments: Record<string, unknown> },
  output: ArgumentEvaluationOutput,
  argumentEncoding?: 'sha256_digest_only',
): boolean {
  if (argumentEncoding === 'sha256_digest_only') {
    return privateArgumentConstraintsMatch(
      constraints,
      call,
      output,
    ) === true;
  }
  return constraints.every((rule) =>
    argumentConstraintMatches(rule, call, output));
}
