import { z } from 'zod';
import type {
  CustomerCommand,
} from '../domain/customerCommand.js';
import { canonicalJson } from '../graph/turnSupport.js';
import {
  selectedActionResponseReferenceSchema,
  validateSelectedActionResponseAuthority,
  type CurrentSelectedActionAuthority,
  type SelectedActionResponseAuthority,
  type SelectedActionResponseReference,
} from './selectedActionResponseAuthority.js';

export interface SelectedActionSemanticTarget {
  schemaVersion: 'kfc-selected-action-semantic-target-v1';
  command: CustomerCommand;
  reference: SelectedActionResponseReference;
  authority: SelectedActionResponseAuthority;
  currentAuthority: CurrentSelectedActionAuthority;
}

export const selectedActionSemanticAttestationSchema = z.object({
  schemaVersion:
    z.literal('kfc-selected-action-semantic-attestation-v1'),
  reference: selectedActionResponseReferenceSchema,
  semanticAlignment: z.enum(['aligned', 'misaligned']),
}).strict();

export type SelectedActionSemanticAttestation = z.infer<
  typeof selectedActionSemanticAttestationSchema
>;

export type SelectedActionSemanticTargetValidation =
  | {
      ok: true;
      target: SelectedActionSemanticTarget;
    }
  | {
      ok: false;
      errorCode: string;
    };

export type SelectedActionSemanticAttestationValidation =
  | { ok: true }
  | {
      ok: false;
      errorCode: string;
    };

export function buildSelectedActionSemanticTarget(input: {
  command: CustomerCommand;
  reference: SelectedActionResponseReference;
  authority: SelectedActionResponseAuthority;
  currentAuthority: CurrentSelectedActionAuthority;
}): SelectedActionSemanticTargetValidation {
  const authority = validateSelectedActionResponseAuthority({
    reference: input.reference,
    authority: input.authority,
    currentAuthority: input.currentAuthority,
  });
  return authority.ok
    ? {
        ok: true,
        target: {
          schemaVersion: 'kfc-selected-action-semantic-target-v1',
          command: input.command,
          reference: authority.reference,
          authority: input.authority,
          currentAuthority: input.currentAuthority,
        },
      }
    : authority;
}

export function validateSelectedActionSemanticAttestation(input: {
  raw: unknown;
  target?: SelectedActionSemanticTarget;
}): SelectedActionSemanticAttestationValidation {
  if (!input.target) {
    return input.raw === undefined
      ? { ok: true }
      : {
          ok: false,
          errorCode: 'selected_action_semantic_target_missing',
        };
  }
  const attestation = selectedActionSemanticAttestationSchema.safeParse(
    input.raw,
  );
  if (!attestation.success) {
    return {
      ok: false,
      errorCode: 'selected_action_semantic_attestation_missing',
    };
  }
  if (
    attestation.data.semanticAlignment !== 'aligned' ||
    canonicalJson(attestation.data.reference) !==
      canonicalJson(input.target.reference)
  ) {
    return {
      ok: false,
      errorCode: 'selected_action_semantic_alignment_rejected',
    };
  }
  const authority = validateSelectedActionResponseAuthority({
    reference: attestation.data.reference,
    authority: input.target.authority,
    currentAuthority: input.target.currentAuthority,
  });
  return authority.ok ? { ok: true } : authority;
}
