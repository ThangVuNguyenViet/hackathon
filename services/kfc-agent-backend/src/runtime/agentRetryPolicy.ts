import {
  modelRetryMiddleware,
  toolRetryMiddleware,
  type AnyAgentMiddleware,
} from 'langchain';
import type { AgentModelTransport } from '../config/agentModelProfile.js';

export interface AgentRetryProfile {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
}

const portableModelRetryProfile = Object.freeze({
  maxRetries: 2,
  initialDelayMs: 200,
  backoffFactor: 2,
  maxDelayMs: 1_000,
  jitter: true,
} satisfies AgentRetryProfile);

const portableReadToolRetryProfile = Object.freeze({
  maxRetries: 1,
  initialDelayMs: 100,
  backoffFactor: 2,
  maxDelayMs: 500,
  jitter: true,
} satisfies AgentRetryProfile);

const retryableErrorNames = new Set([
  'APIConnectionError',
  'APITimeoutError',
  'RateLimitError',
  'TimeoutError',
]);

const retryableErrorCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * One provider-neutral profile is used until live evidence justifies a
 * transport override. Keeping the transport parameter makes that override a
 * data change instead of a second retry implementation.
 */
export function resolveAgentModelRetryProfile(
  _transport?: AgentModelTransport,
): AgentRetryProfile {
  return portableModelRetryProfile;
}

export function createAgentModelRetryMiddleware(
  transport?: AgentModelTransport,
): AnyAgentMiddleware {
  const profile = resolveAgentModelRetryProfile(transport);
  return modelRetryMiddleware({
    ...profile,
    retryOn: isRetryableTransientError,
    onFailure: 'error',
  });
}

export function createReadToolRetryMiddleware(
  tools: readonly string[],
): AnyAgentMiddleware {
  return toolRetryMiddleware({
    ...portableReadToolRetryProfile,
    tools: [...tools],
    retryOn: isRetryableTransientError,
    onFailure: 'error',
  });
}

export function isRetryableTransientError(error: Error): boolean {
  for (const candidate of errorChain(error)) {
    if (candidate.name === 'AbortError') return false;
    if (retryableErrorNames.has(candidate.name)) return true;
    const status = numericProperty(candidate, 'status', 'statusCode');
    if (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      (status !== undefined && status >= 500 && status <= 599)
    ) {
      return true;
    }
    const code = stringProperty(candidate, 'code');
    if (code && retryableErrorCodes.has(code)) return true;
  }
  return false;
}

function errorChain(error: Error): Error[] {
  const chain: Error[] = [];
  let candidate: unknown = error;
  const seen = new Set<unknown>();
  while (
    candidate instanceof Error &&
    !seen.has(candidate) &&
    chain.length < 5
  ) {
    chain.push(candidate);
    seen.add(candidate);
    candidate = candidate.cause;
  }
  return chain;
}

function numericProperty(
  value: Error,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const candidate: unknown = Reflect.get(value, key);
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function stringProperty(value: Error, key: string): string | undefined {
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}
