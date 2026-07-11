import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

describe('customer streaming environment', () => {
  it('defaults the rollout to off', () => {
    const env = loadEnv({});

    expect(env.KFC_CUSTOMER_CHAT_STREAMING_MODE).toBe('off');
    expect(env.KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT).toBe(0);
    expect(env.KFC_CUSTOMER_CHAT_STREAMING_POLICY_REVISION).toBe('customer-streaming-v1-off');
    expect(env.KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED).toBe(false);
  });

  it('parses explicit rollout configuration without treating false as true', () => {
    const env = loadEnv({
      KFC_CUSTOMER_CHAT_STREAMING_MODE: 'cohort',
      KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT: '25',
      KFC_CUSTOMER_CHAT_STREAMING_POLICY_REVISION: 'release-2026-07-11',
      KFC_CUSTOMER_CHAT_STREAMING_INTERNAL_CUSTOMER_IDS: 'customer_1, customer_2',
      KFC_CUSTOMER_CHAT_STREAMING_COHORT_SALT: 'private-salt',
      KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED: 'false',
    });

    expect(env.KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT).toBe(25);
    expect(env.KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED).toBe(false);
  });

  it('rejects invalid rollout configuration', () => {
    expect(() => loadEnv({ KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT: '101' })).toThrow();
    expect(() => loadEnv({ KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED: 'yes' })).toThrow();
  });
});
