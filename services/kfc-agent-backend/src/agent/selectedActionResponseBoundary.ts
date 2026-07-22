import { createHash } from 'node:crypto';
import type {
  CustomerCommand,
  TrustedCustomerActionEnvelope,
} from '../domain/customerCommand.js';
import { kfcGenUiVerifiedStateRevision } from '../genui/kfcGenUi.js';
import type { AgentGraphState } from '../graph/state.js';
import { canonicalJson } from '../graph/turnSupport.js';
import { classifyToolSideEffect } from '../ordering/toolExecutor.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type {
  CurrentSelectedActionAuthority,
  SelectedActionResponseAuthority,
  SelectedActionResponseReference,
} from './selectedActionResponseAuthority.js';
import { validateSelectedActionResponseAuthority } from './selectedActionResponseAuthority.js';
import {
  groundedResponseSchema,
  validateGroundedResponse,
  type ResponseFactualClaims,
} from './responseGrounding.js';
import type { ResponsePublicationDeclaration } from './responsePrivacyAttestation.js';
import type { ModelPublicationBundle } from './modelPublicationProjection.js';
import type { StructuredActionOutcome } from './structuredCustomerAction.js';

export type SelectedActionEffectAuthorityErrorCode =
  | 'selected_action_effect_authority_missing'
  | 'selected_action_rejection_authority_missing'
  | 'selected_action_tool_effect_missing';

export interface SelectedActionGraphEffect {
  envelope: TrustedCustomerActionEnvelope;
  outcome: StructuredActionOutcome;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  approvalDecision: 'approve' | 'reject' | null;
  validatedApprovalActionDigest: string | null;
}

export type SelectedActionGraphAuthorities =
  | {
      ok: true;
      authority: SelectedActionResponseAuthority;
      currentAuthority: CurrentSelectedActionAuthority;
      reference: SelectedActionResponseReference;
    }
  | {
      ok: false;
      errorCode: SelectedActionEffectAuthorityErrorCode;
    };

export type SelectedActionGroundedResponseValidation =
  | {
      ok: true;
      customerText: string;
      projectionDigest: string;
      factualClaims: ResponseFactualClaims;
      publicationDeclaration: ResponsePublicationDeclaration;
      selectedActionResponse?: SelectedActionResponseReference;
    }
  | {
      ok: false;
      errorCode: string;
    };

function opaqueDigest(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex')}`;
}

function typedEntityId(kind: string, value: string): string {
  const exact = `${kind}:${value}`;
  return exact.length <= 256 ? exact : opaqueDigest(kind, value);
}

function commandEntityIds(command: CustomerCommand): string[] {
  switch (command.kind) {
    case 'cart_update':
      return [typedEntityId('item', command.itemCode)];
    case 'cart_batch_update':
      return command.items.map(({ itemCode }) =>
        typedEntityId('item', itemCode),
      );
    case 'modifier_selection':
      return [
        typedEntityId('item', command.itemCode),
        typedEntityId('modifier_group', command.groupId),
        typedEntityId('modifier', command.modifierId),
      ];
    case 'select_payment_method':
      return [typedEntityId('payment_method', command.selection.methodId)];
    case 'open_allergen_evidence':
      return [typedEntityId('official_source', command.sourceUrl)];
    case 'accept_fulfillment':
      return command.savedAddressRef
        ? [typedEntityId('saved_address_ref', command.savedAddressRef.id)]
        : [];
    case 'confirm_order':
    case 'start_fulfillment':
    case 'edit_cart':
    case 'submit_address':
    case 'apply_voucher':
    case 'change_payment_method':
    case 'continue_payment':
    case 'track_order':
    case 'request_support':
    case 'add_support_detail':
      return [];
  }
}

function selectedEntityIds(envelope: TrustedCustomerActionEnvelope): string[] {
  return [
    typedEntityId('assistant_turn', envelope.assistantTurnId),
    typedEntityId('attachment', envelope.attachmentId),
    ...commandEntityIds(envelope.command),
  ];
}

function verifiedEffect(input: SelectedActionGraphEffect):
  | {
      kind: 'none' | 'presentation' | 'read' | 'mutation';
      verificationBasis: unknown;
    }
  | {
      errorCode: SelectedActionEffectAuthorityErrorCode;
    } {
  if (input.outcome === 'presentation_ready') {
    return {
      kind: 'presentation',
      verificationBasis: {
        transition: 'graph_owned_presentation',
      },
    };
  }
  if (input.outcome === 'customer_rejected') {
    if (
      input.approvalDecision !== 'reject' ||
      !input.validatedApprovalActionDigest
    ) {
      return { errorCode: 'selected_action_rejection_authority_missing' };
    }
    return {
      kind: 'none',
      verificationBasis: {
        transition: 'revalidated_customer_rejection',
        approvalActionDigest: input.validatedApprovalActionDigest,
      },
    };
  }
  const successfulTrace = input.currentTurnToolTrace.at(-1);
  if (!successfulTrace?.ok) {
    return { errorCode: 'selected_action_tool_effect_missing' };
  }
  return {
    kind:
      classifyToolSideEffect(
        successfulTrace.toolName,
        successfulTrace.arguments,
      ) === 'read'
        ? 'read'
        : 'mutation',
    verificationBasis: {
      transition: 'verified_tool_effect',
      trace: input.currentTurnToolTrace,
    },
  };
}

/**
 * Captures the trusted effect before response composition and independently
 * derives its current binding from graph-owned state. Model output supplies
 * only the returned reference.
 */
export function buildSelectedActionGraphAuthorities(
  input: SelectedActionGraphEffect,
): SelectedActionGraphAuthorities {
  const effect = verifiedEffect(input);
  if ('errorCode' in effect) {
    return { ok: false, errorCode: effect.errorCode };
  }
  const selection = {
    entityIds: selectedEntityIds(input.envelope),
    verifiedRevision: input.envelope.verifiedRevision,
  };
  const verifiedRevision = kfcGenUiVerifiedStateRevision(input.state);
  const verificationId = opaqueDigest('verification', {
    actionDigest: input.envelope.actionDigest,
    selection,
    outcome: input.outcome,
    kind: effect.kind,
    verifiedRevision,
    basis: effect.verificationBasis,
  });
  const effectId = opaqueDigest('effect', {
    actionDigest: input.envelope.actionDigest,
    outcome: input.outcome,
    kind: effect.kind,
    verifiedRevision,
    verificationId,
  });
  const effectAuthority = {
    effectId,
    outcome: input.outcome,
    verifiedRevision,
    kind: effect.kind,
    verification: {
      status: 'verified' as const,
      verificationId,
    },
  };
  const authority: SelectedActionResponseAuthority = {
    schemaVersion: 'kfc-selected-action-response-authority-v1',
    actionDigest: input.envelope.actionDigest,
    selection,
    effect: effectAuthority,
  };
  const currentAuthority: CurrentSelectedActionAuthority = {
    schemaVersion: 'kfc-current-selected-action-authority-v1',
    actionDigest: input.envelope.actionDigest,
    selection,
    effect: effectAuthority,
  };
  const reference: SelectedActionResponseReference = {
    schemaVersion: 'kfc-selected-action-response-reference-v1',
    actionDigest: authority.actionDigest,
    selection: authority.selection,
    effect: {
      effectId: authority.effect.effectId,
      outcome: authority.effect.outcome,
      verifiedRevision: authority.effect.verifiedRevision,
    },
    assertion:
      authority.effect.kind === 'mutation'
        ? 'mutation_completed'
        : 'outcome_acknowledged',
  };
  return {
    ok: true,
    authority,
    currentAuthority,
    reference,
  };
}

export function validateSelectedActionGroundedResponse(input: {
  raw: unknown;
  publicationBundle: ModelPublicationBundle;
  state: AgentGraphState;
  envelope: TrustedCustomerActionEnvelope | null;
  outcome: StructuredActionOutcome | null;
  authority: SelectedActionResponseAuthority | null;
  currentTurnToolTrace: ToolTraceEntry[];
  approvalDecision: 'approve' | 'reject' | null;
  validatedApprovalActionDigest: string | null;
}): SelectedActionGroundedResponseValidation {
  const grounded = validateGroundedResponse({
    raw: input.raw,
    bundle: input.publicationBundle,
    currentUserMessage: input.state.latestUserMessage,
  });
  if (!grounded.ok) {
    /*
     * A graph-owned selected-action effect can become stale after response
     * composition but before validation. Publication freshness correctly
     * rejects the old projection digest first; retain the more precise
     * graph-authority classification when the typed response itself is valid
     * and the trusted effect no longer matches current verified state.
     */
    if (
      grounded.errorCode === 'agent_model_publication_reference_invalid' &&
      input.envelope &&
      input.authority &&
      input.outcome
    ) {
      const parsed = groundedResponseSchema.safeParse(input.raw);
      if (parsed.success && parsed.data.selectedActionResponse) {
        const current = buildSelectedActionGraphAuthorities({
          envelope: input.envelope,
          outcome: input.outcome,
          state: input.state,
          currentTurnToolTrace: input.currentTurnToolTrace,
          approvalDecision: input.approvalDecision,
          validatedApprovalActionDigest: input.validatedApprovalActionDigest,
        });
        if (current.ok) {
          const selectedAction = validateSelectedActionResponseAuthority({
            reference: parsed.data.selectedActionResponse,
            authority: input.authority,
            currentAuthority: current.currentAuthority,
          });
          if (
            !selectedAction.ok &&
            selectedAction.errorCode ===
              'selected_action_response_stale_outcome'
          ) {
            return selectedAction;
          }
        }
      }
    }
    return grounded;
  }
  if (!input.envelope) {
    return grounded.selectedActionResponse
      ? {
          ok: false,
          errorCode: 'selected_action_response_authority_missing',
        }
      : grounded;
  }
  if (!grounded.selectedActionResponse || !input.authority || !input.outcome) {
    return {
      ok: false,
      errorCode: 'selected_action_response_reference_required',
    };
  }
  const current = buildSelectedActionGraphAuthorities({
    envelope: input.envelope,
    outcome: input.outcome,
    state: input.state,
    currentTurnToolTrace: input.currentTurnToolTrace,
    approvalDecision: input.approvalDecision,
    validatedApprovalActionDigest: input.validatedApprovalActionDigest,
  });
  if (!current.ok) return current;
  const validation = validateSelectedActionResponseAuthority({
    reference: grounded.selectedActionResponse,
    authority: input.authority,
    currentAuthority: current.currentAuthority,
  });
  return validation.ok ? grounded : validation;
}
