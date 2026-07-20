import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalJson } from '../graph/turnSupport.js';
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
  const argumentKeys = Object.keys(call.arguments);
  const digest = call.arguments.privateArgumentsDigest;
  if (
    argumentKeys.length !== 1 ||
    argumentKeys[0] !== 'privateArgumentsDigest' ||
    typeof digest !== 'string'
  ) {
    return undefined;
  }
  const expected: Record<string, unknown> = {};
  for (const constraint of constraints) {
    if (
      constraint.path.includes('.') ||
      constraint.path.includes('|')
    ) {
      return false;
    }
    if (constraint.operator === 'equals') {
      expected[constraint.path] = constraint.value;
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
      expected[constraint.path] = authority;
      continue;
    }
    if (constraint.operator === 'absent') continue;
    return false;
  }
  const expectedDigest = createHash('sha256')
    .update(canonicalJson(expected))
    .digest('hex');
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
