import type { ToolResult } from '../domain/types.js';
import type { ProviderMutationIdentity } from './interfaces.js';

interface ProviderMutationOutcome {
  bindingFingerprint: string;
  result: Promise<ToolResult<unknown>>;
}

/**
 * Models the minimum provider-side idempotency contract used by local/mock
 * providers: one key may replay one exact bound mutation, but it may never be
 * rebound to a different approval authority.
 */
export class ProviderMutationReplayRegistry {
  readonly #outcomeByKey = new Map<string, ProviderMutationOutcome>();

  run<Value>(
    identity: ProviderMutationIdentity,
    operation: () => Promise<ToolResult<Value>> | ToolResult<Value>,
  ): Promise<ToolResult<Value>> {
    if (
      !identity ||
      identity.idempotencyKey.length < 1 ||
      identity.idempotencyKey.length > 512 ||
      identity.idempotencyKey.trim() !== identity.idempotencyKey ||
      !/^[a-f0-9]{64}$/u.test(identity.bindingFingerprint)
    ) {
      return Promise.resolve({
        ok: false,
        errorCode: 'provider_mutation_identity_required',
        message: 'A canonical provider mutation identity is required',
      });
    }
    const existing = this.#outcomeByKey.get(identity.idempotencyKey);
    if (existing) {
      if (existing.bindingFingerprint !== identity.bindingFingerprint) {
        return Promise.resolve({
          ok: false,
          errorCode: 'provider_idempotency_conflict',
          message:
            'Provider idempotency key conflicts with another bound action',
        });
      }
      return existing.result as Promise<ToolResult<Value>>;
    }
    const result = Promise.resolve().then(operation);
    this.#outcomeByKey.set(identity.idempotencyKey, {
      bindingFingerprint: identity.bindingFingerprint,
      result,
    });
    return result;
  }
}
