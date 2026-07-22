import type { ConversationTurn } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { agentToolArgumentSchemas } from '../ordering/toolCatalog.js';
import type { ModelPublicationBundle } from './modelPublicationProjection.js';
import { validateModelQuoteFulfillmentAddressAuthority } from './modelQuoteFulfillmentAddressAuthority.js';
import { claimPendingSavedAddressQuote } from './savedAddressVerifiedRef.js';
import type {
  PendingToolCall,
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export type PreparedModelQuoteFulfillment =
  | {
      ok: true;
      state: AgentGraphState;
      call: PendingToolCall;
    }
  | {
      ok: false;
      kind: 'failure' | 'validation_error';
      errorCode: string;
    };

/**
 * Shared authorization boundary for every model-authored fulfillment quote.
 * The model-authored arguments remain audit-only. The returned call contains
 * only the server-authorized executor arguments, including a transient raw
 * address only when an opaque saved-address reference was atomically claimed.
 */
export async function prepareModelQuoteFulfillment(input: {
  call: PendingToolCall;
  callCount: number;
  publicationBundle: ModelPublicationBundle;
  currentUserTurn: ConversationTurn | undefined;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  useId: string;
}): Promise<PreparedModelQuoteFulfillment> {
  if (!input.currentUserTurn) {
    return {
      ok: false,
      kind: 'failure',
      errorCode: 'agent_address_authority_mismatch',
    };
  }
  const parsed = agentToolArgumentSchemas.quoteFulfillment.safeParse(
    input.call.arguments,
  );
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'validation_error',
      errorCode: 'invalid_tool_arguments',
    };
  }
  const authoredArguments = structuredClone(
    (input.call.auditArguments ?? parsed.data) as Record<string, unknown>,
  );
  if (parsed.data.savedAddressRef !== null) {
    const publishedRef =
      input.publicationBundle.modelState.pendingSavedAddressRef;
    if (
      input.callCount !== 1 ||
      parsed.data.method !== 'delivery' ||
      publishedRef?.kind !== 'saved_address' ||
      publishedRef.id !== parsed.data.savedAddressRef.id
    ) {
      return {
        ok: false,
        kind: 'validation_error',
        errorCode: 'structured_action_saved_address_ref_unavailable',
      };
    }
    const claimed = await claimPendingSavedAddressQuote({
      ref: parsed.data.savedAddressRef,
      method: 'delivery',
      useId: input.useId,
      callId: input.call.id,
      turnInput: input.runtime.turnInput,
      state: input.state,
    });
    if (!claimed.ok) {
      return {
        ok: false,
        kind: 'validation_error',
        errorCode: claimed.errorCode,
      };
    }
    return {
      ok: true,
      state: claimed.state,
      call: {
        ...claimed.call,
        auditArguments: authoredArguments,
      },
    };
  }
  const authority = await validateModelQuoteFulfillmentAddressAuthority({
    publicationBundle: input.publicationBundle,
    currentUserTurn: input.currentUserTurn,
    recentTurns: input.state.recentTurns ?? [],
    proposedAddress: parsed.data.address,
  });
  if (!authority.ok) {
    return {
      ok: false,
      kind: 'failure',
      errorCode: authority.errorCode,
    };
  }
  return {
    ok: true,
    state: input.state,
    call: {
      id: input.call.id,
      toolName: 'quoteFulfillment',
      arguments: {
        address: authority.address,
        savedAddressRef: null,
        method: parsed.data.method,
      },
      auditArguments: authoredArguments,
    },
  };
}
