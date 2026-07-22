import { createHash } from 'node:crypto';
import type { MockedUpstreamApiProfile } from './mockedUpstreamProfile.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) =>
        `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Confirmation revisions are opaque equality tokens. Provider profile
 * contents can include private customer data and must never become a token.
 */
export function mockConfirmationProviderRevision(
  profile: MockedUpstreamApiProfile | undefined,
): string {
  const digest = createHash('sha256')
    .update(canonicalJson(profile ?? null))
    .digest('hex');
  return `mock:${digest}`;
}
