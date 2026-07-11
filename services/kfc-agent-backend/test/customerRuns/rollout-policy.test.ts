import { describe, expect, it } from 'vitest';
import {
  createStreamingRolloutPolicy,
  decideStreamingAssignment,
} from '../../src/customerRuns/rolloutPolicy.js';

const capableClient = {
  appVersion: '1.0.0+1',
  supportedSchemaVersions: [1],
};

function policy(overrides: Record<string, unknown> = {}) {
  return createStreamingRolloutPolicy({
    mode: 'off',
    cohortPercent: 0,
    policyRevision: 'streaming-policy-1',
    internalCustomerIds: [],
    cohortSalt: 'private-rollout-salt',
    supportedSchemaMin: 1,
    supportedSchemaMax: 1,
    provisionalGenUiEnabled: false,
    ...overrides,
  });
}

describe('customer streaming rollout policy', () => {
  it('selects legacy when the master mode is off', () => {
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientCapability: capableClient,
        policy: policy(),
      }),
    ).toMatchObject({ path: 'legacy', reason: 'rollout_off', policyRevision: 'streaming-policy-1' });
  });

  it('selects legacy for an incapable or schema-incompatible client', () => {
    const enabled = policy({ mode: 'on' });
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientCapability: null,
        policy: enabled,
      }),
    ).toMatchObject({ path: 'legacy', reason: 'client_incapable' });
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientCapability: { appVersion: '0.9.0', supportedSchemaVersions: [2] },
        policy: enabled,
      }),
    ).toMatchObject({ path: 'legacy', reason: 'unsupported_schema' });
  });

  it('uses the internal allowlist without percentage exposure', () => {
    const internal = policy({ mode: 'internal', internalCustomerIds: ['customer_1'] });
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientCapability: capableClient,
        policy: internal,
      }),
    ).toMatchObject({ path: 'stream', reason: 'internal_allowlist' });
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_2',
        customerId: 'customer_2',
        clientCapability: capableClient,
        policy: internal,
      }),
    ).toMatchObject({ path: 'legacy', reason: 'not_internal' });
  });

  it('makes stable cohort decisions and lets the allowlist override the bucket', () => {
    const cohort = policy({
      mode: 'cohort',
      cohortPercent: 10,
      internalCustomerIds: ['always_stream'],
      provisionalGenUiEnabled: true,
    });
    const input = {
      sessionId: 'kfc:stable_customer',
      customerId: 'stable_customer',
      clientCapability: capableClient,
      policy: cohort,
    };

    expect(decideStreamingAssignment(input)).toEqual(decideStreamingAssignment(input));
    expect(
      decideStreamingAssignment({ ...input, customerId: 'always_stream' }),
    ).toMatchObject({ path: 'stream', reason: 'internal_allowlist', provisionalGenUiEnabled: true });
  });

  it('selects streaming for every capable compatible client in on mode', () => {
    expect(
      decideStreamingAssignment({
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientCapability: capableClient,
        policy: policy({ mode: 'on', provisionalGenUiEnabled: true }),
      }),
    ).toMatchObject({ path: 'stream', reason: 'rollout_on', schemaVersion: 1, provisionalGenUiEnabled: true });
  });

  it('rejects invalid policy bounds', () => {
    expect(() => policy({ cohortPercent: 101 })).toThrow();
    expect(() => policy({ supportedSchemaMin: 2, supportedSchemaMax: 1 })).toThrow();
    expect(() => policy({ mode: 'cohort', cohortSalt: '' })).toThrow();
  });
});
