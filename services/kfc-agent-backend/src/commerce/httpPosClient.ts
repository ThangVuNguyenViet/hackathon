import { z } from 'zod';
import type {
  ExternalCallContext,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import type { ToolResult } from '../domain/types.js';
import type { PosClient } from './posTypes.js';
import { providerPosTicketResultSchema } from './providerResponseSchemas.js';

export interface HttpPosClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

function externalCallIsCancelled(context: ExternalCallContext): boolean {
  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

function failureDetail(error: unknown): string {
  return error instanceof Error
    ? error.message
    : error === undefined
      ? 'caller signal or deadline'
      : String(error);
}

function requestCancellationFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: 'pos_request_cancelled',
    message: `POS request was cancelled: ${failureDetail(error)}`,
  };
}

function mutationAmbiguityFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: 'pos_mutation_ambiguous',
    message: `POS mutation outcome is ambiguous after dispatch: ${failureDetail(error)}`,
  };
}

function invalidProviderResponseFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: 'pos_invalid_provider_response',
    message: `POS returned an invalid response: ${failureDetail(error)}`,
  };
}

function unexpectedMutationStatusFailure<T>(
  expectedStatus: 'accepted' | 'cancelled',
  actualStatus: unknown,
): ToolResult<T> {
  if (actualStatus === 'rejected') {
    return {
      ok: false,
      errorCode:
        expectedStatus === 'accepted'
          ? 'pos_order_rejected'
          : 'pos_cancellation_rejected',
      message: `POS returned rejected while ${expectedStatus} was required`,
    };
  }
  return {
    ok: false,
    errorCode: 'pos_mutation_ambiguous',
    message: `POS returned ${String(actualStatus)} while ${expectedStatus} was required`,
  };
}

function providerMutationIdentityIsValid(
  identity: ProviderMutationIdentity | null | undefined,
): identity is ProviderMutationIdentity {
  return Boolean(
    identity &&
    typeof identity.idempotencyKey === 'string' &&
    typeof identity.bindingFingerprint === 'string' &&
    identity.idempotencyKey.length <= 512 &&
    opaqueProviderIdSchema.safeParse(identity.idempotencyKey).success &&
    /^[a-f0-9]{64}$/u.test(identity.bindingFingerprint),
  );
}

function providerMutationIdentityRequiredFailure<T>(): ToolResult<T> {
  return {
    ok: false,
    errorCode: 'provider_mutation_identity_required',
    message: 'A canonical provider mutation identity is required',
  };
}

export function createHttpPosClient(options: HttpPosClientOptions): PosClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    externalCallContext: ExternalCallContext,
    schema: z.ZodType<ToolResult<T>>,
    init: RequestInit = {},
    mutation = false,
    expectedMutationStatus?: 'accepted' | 'cancelled',
  ): Promise<ToolResult<T>> {
    if (externalCallIsCancelled(externalCallContext)) {
      return requestCancellationFailure(externalCallContext.signal.reason);
    }
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: externalCallContext.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      const payload: unknown = await response.json();
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        return mutation
          ? mutationAmbiguityFailure(parsed.error)
          : invalidProviderResponseFailure(parsed.error);
      }
      if (!response.ok && parsed.data.ok) {
        return mutation
          ? mutationAmbiguityFailure(
              new Error(
                `POS returned HTTP ${response.status} with a success body`,
              ),
            )
          : invalidProviderResponseFailure(
              new Error(
                `POS returned HTTP ${response.status} with a success body`,
              ),
            );
      }
      if (
        parsed.data.ok &&
        expectedMutationStatus !== undefined &&
        (typeof parsed.data.value !== 'object' ||
          parsed.data.value === null ||
          !('status' in parsed.data.value) ||
          parsed.data.value.status !== expectedMutationStatus)
      ) {
        const actualStatus =
          typeof parsed.data.value === 'object' &&
          parsed.data.value !== null &&
          'status' in parsed.data.value
            ? parsed.data.value.status
            : undefined;
        return unexpectedMutationStatusFailure(
          expectedMutationStatus,
          actualStatus,
        );
      }
      return parsed.data;
    } catch (error) {
      if (mutation) {
        return mutationAmbiguityFailure(error);
      }
      if (
        externalCallIsCancelled(externalCallContext) ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return requestCancellationFailure(error);
      }
      return {
        ok: false,
        errorCode: 'pos_unavailable',
        message: `POS request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    submitOrder: ({ order }, externalCallContext, mutationIdentity) =>
      providerMutationIdentityIsValid(mutationIdentity)
        ? request(
            '/v1/tickets',
            externalCallContext,
            providerPosTicketResultSchema,
            {
              method: 'POST',
              headers: {
                'idempotency-key': mutationIdentity.idempotencyKey,
                'x-provider-binding-fingerprint':
                  mutationIdentity.bindingFingerprint,
              },
              body: JSON.stringify({ order }),
            },
            true,
            'accepted',
          )
        : Promise.resolve(providerMutationIdentityRequiredFailure()),
    getTicket: (ticketId, externalCallContext) =>
      request(
        `/v1/tickets/${encodeURIComponent(ticketId)}`,
        externalCallContext,
        providerPosTicketResultSchema,
      ),
    cancelTicket: (ticketId, externalCallContext, mutationIdentity) =>
      providerMutationIdentityIsValid(mutationIdentity)
        ? request(
            `/v1/tickets/${encodeURIComponent(ticketId)}/cancel`,
            externalCallContext,
            providerPosTicketResultSchema,
            {
              method: 'POST',
              headers: {
                'idempotency-key': mutationIdentity.idempotencyKey,
                'x-provider-binding-fingerprint':
                  mutationIdentity.bindingFingerprint,
              },
            },
            true,
            'cancelled',
          )
        : Promise.resolve(providerMutationIdentityRequiredFailure()),
  };
}
