import { z } from 'zod';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalOpaqueIdSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: 'Opaque identifiers must already be canonical',
  });

const uniqueEntityIdsSchema = z.array(canonicalOpaqueIdSchema)
  .max(32)
  .superRefine((ids, context) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Selected entity identifiers must be unique',
        });
      }
      seen.add(id);
    });
  });

export const selectedActionOutcomeSchema = z.enum([
  'customer_rejected',
  'presentation_ready',
  'tool_succeeded',
]);

export const selectedActionEffectKindSchema = z.enum([
  'none',
  'presentation',
  'read',
  'mutation',
]);

const selectedActionEffectVerificationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    verificationId: canonicalOpaqueIdSchema,
  }).strict(),
  z.object({
    status: z.literal('unverified'),
  }).strict(),
]);

const selectedActionSelectionSchema = z.object({
  entityIds: uniqueEntityIdsSchema,
  verifiedRevision: digestSchema,
}).strict();

const selectedActionEffectReferenceSchema = z.object({
  effectId: canonicalOpaqueIdSchema,
  outcome: selectedActionOutcomeSchema,
  verifiedRevision: digestSchema,
}).strict();

const selectedActionEffectAuthoritySchema =
  selectedActionEffectReferenceSchema.extend({
    kind: selectedActionEffectKindSchema,
    verification: selectedActionEffectVerificationSchema,
  }).strict().superRefine((effect, context) => {
    const kindMatchesOutcome =
      (
        effect.outcome === 'customer_rejected' &&
        effect.kind === 'none'
      ) ||
      (
        effect.outcome === 'presentation_ready' &&
        effect.kind === 'presentation'
      ) ||
      (
        effect.outcome === 'tool_succeeded' &&
        (effect.kind === 'read' || effect.kind === 'mutation')
      );
    if (!kindMatchesOutcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'Effect kind must match its structured action outcome',
      });
    }
  });

export const selectedActionResponseAuthoritySchema = z.object({
  schemaVersion: z.literal('kfc-selected-action-response-authority-v1'),
  actionDigest: digestSchema,
  selection: selectedActionSelectionSchema,
  effect: selectedActionEffectAuthoritySchema,
}).strict();

export type SelectedActionResponseAuthority = z.infer<
  typeof selectedActionResponseAuthoritySchema
>;

export const selectedActionResponseReferenceSchema = z.object({
  schemaVersion: z.literal('kfc-selected-action-response-reference-v1'),
  actionDigest: digestSchema,
  selection: selectedActionSelectionSchema,
  effect: selectedActionEffectReferenceSchema,
  assertion: z.enum([
    'outcome_acknowledged',
    'mutation_completed',
  ]),
}).strict();

export type SelectedActionResponseReference = z.infer<
  typeof selectedActionResponseReferenceSchema
>;

export const currentSelectedActionAuthoritySchema = z.object({
  schemaVersion: z.literal('kfc-current-selected-action-authority-v1'),
  actionDigest: digestSchema,
  selection: selectedActionSelectionSchema,
  effect: selectedActionEffectAuthoritySchema,
}).strict();

export type CurrentSelectedActionAuthority = z.infer<
  typeof currentSelectedActionAuthoritySchema
>;

export type SelectedActionResponseAuthorityErrorCode =
  | 'selected_action_response_reference_invalid'
  | 'selected_action_response_authority_invalid'
  | 'selected_action_response_current_authority_invalid'
  | 'selected_action_response_stale_outcome'
  | 'selected_action_response_action_mismatch'
  | 'selected_action_response_effect_mismatch'
  | 'selected_action_response_revision_mismatch'
  | 'selected_action_response_entity_mismatch'
  | 'selected_action_response_effect_unverified'
  | 'selected_action_response_mutation_unverified';

export type SelectedActionResponseAuthorityValidation =
  | {
      ok: true;
      reference: SelectedActionResponseReference;
    }
  | {
      ok: false;
      errorCode: SelectedActionResponseAuthorityErrorCode;
    };

function sameEntityIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

/**
 * Authorizes only the typed selected-action part of a model response.
 *
 * The caller owns creation of the verified effect record and the current-effect
 * binding. Customer text and generated prose are intentionally absent from this
 * boundary.
 */
export function validateSelectedActionResponseAuthority(input: {
  reference: unknown;
  authority: unknown;
  currentAuthority: unknown;
}): SelectedActionResponseAuthorityValidation {
  const reference = selectedActionResponseReferenceSchema.safeParse(
    input.reference,
  );
  if (!reference.success) {
    return {
      ok: false,
      errorCode: 'selected_action_response_reference_invalid',
    };
  }
  const authority = selectedActionResponseAuthoritySchema.safeParse(
    input.authority,
  );
  if (!authority.success) {
    return {
      ok: false,
      errorCode: 'selected_action_response_authority_invalid',
    };
  }
  const currentAuthority = currentSelectedActionAuthoritySchema.safeParse(
    input.currentAuthority,
  );
  if (!currentAuthority.success) {
    return {
      ok: false,
      errorCode: 'selected_action_response_current_authority_invalid',
    };
  }

  const trusted = authority.data;
  const current = currentAuthority.data;
  const claimed = reference.data;
  if (
    trusted.actionDigest !== current.actionDigest ||
    trusted.effect.effectId !== current.effect.effectId ||
    trusted.effect.outcome !== current.effect.outcome ||
    trusted.effect.verifiedRevision !== current.effect.verifiedRevision ||
    trusted.selection.verifiedRevision !==
      current.selection.verifiedRevision ||
    !sameEntityIdSet(
      trusted.selection.entityIds,
      current.selection.entityIds,
    )
  ) {
    return {
      ok: false,
      errorCode: 'selected_action_response_stale_outcome',
    };
  }
  const currentVerification = current.effect.verification;
  const trustedVerification = trusted.effect.verification;
  const verificationMatches =
    currentVerification.status === trustedVerification.status &&
    (
      currentVerification.status === 'unverified' ||
      (
        trustedVerification.status === 'verified' &&
        currentVerification.verificationId ===
          trustedVerification.verificationId
      )
    );
  if (
    trusted.effect.kind !== current.effect.kind ||
    !verificationMatches ||
    currentVerification.status !== 'verified'
  ) {
    return {
      ok: false,
      errorCode:
        claimed.assertion === 'mutation_completed'
          ? 'selected_action_response_mutation_unverified'
          : 'selected_action_response_effect_unverified',
    };
  }
  if (claimed.actionDigest !== trusted.actionDigest) {
    return {
      ok: false,
      errorCode: 'selected_action_response_action_mismatch',
    };
  }
  if (
    claimed.effect.effectId !== trusted.effect.effectId ||
    claimed.effect.outcome !== trusted.effect.outcome
  ) {
    return {
      ok: false,
      errorCode: 'selected_action_response_effect_mismatch',
    };
  }
  if (
    claimed.selection.verifiedRevision !==
      trusted.selection.verifiedRevision ||
    claimed.effect.verifiedRevision !== trusted.effect.verifiedRevision
  ) {
    return {
      ok: false,
      errorCode: 'selected_action_response_revision_mismatch',
    };
  }
  if (!sameEntityIdSet(
    claimed.selection.entityIds,
    trusted.selection.entityIds,
  )) {
    return {
      ok: false,
      errorCode: 'selected_action_response_entity_mismatch',
    };
  }
  if (
    claimed.assertion === 'mutation_completed' &&
    (
      current.effect.kind !== 'mutation' ||
      current.effect.outcome !== 'tool_succeeded'
    )
  ) {
    return {
      ok: false,
      errorCode: 'selected_action_response_mutation_unverified',
    };
  }
  return { ok: true, reference: claimed };
}
