import type { StructuredToolParams } from '@langchain/core/tools';
import { z } from 'zod';
import {
  isIssuedModelPublicationBundle,
  validateModelPublicationReference,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import {
  responsePublicationDeclarationSchema,
  type ResponsePublicationDeclaration,
} from './responsePrivacyAttestation.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from './selectedActionResponseAuthority.js';
import {
  responseClaimKindSchema,
} from './responseEvidenceContracts.js';
import {
  providerPortableToolSchema,
} from './providerPortableToolSchema.js';
export {
  responseClaimKindSchema,
  type ResponseClaimEvidence,
  type ResponseClaimKind,
} from './responseEvidenceContracts.js';

export const GROUNDED_RESPONSE_TOOL_NAME = 'submitGroundedResponse';

export const responseEvidenceReferenceSchema = z.object({
  evidenceId: z.string().trim().min(1),
  claimKinds: z.array(responseClaimKindSchema).min(1),
}).strict();

export const responseFactualClaimsSchema = z.object({
  evidenceReferences: z.array(responseEvidenceReferenceSchema),
  hasUnsupportedFactualClaim: z.boolean(),
}).strict();

export type ResponseFactualClaims = z.infer<
  typeof responseFactualClaimsSchema
>;

export const groundedResponseSchema = z.object({
  customerText: z.string().trim().min(1),
  projectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  factualClaims: responseFactualClaimsSchema,
  publicationDeclaration: responsePublicationDeclarationSchema,
  selectedActionResponse: selectedActionResponseReferenceSchema.optional(),
}).strict();

export const groundedResponseToolDefinition: StructuredToolParams = {
  name: GROUNDED_RESPONSE_TOOL_NAME,
  description: [
    'Submit the final customer-facing response instead of returning plain text.',
    'Copy projectionDigest exactly from the issued model publication bundle.',
    'Reference the closed-world verified response evidence for every factual claim.',
    'Set hasUnsupportedFactualClaim when any factual claim is not fully supported.',
    'Declare semantic relevance, private-data disclosure authority, and internal-metadata disclosure in publicationDeclaration.',
    'Set privateDataDisclosure to unauthorized or disclosesInternalMetadata to true instead of submitting unsafe customer text.',
    'Include selectedActionResponse only when the trusted response context supplies its exact typed reference.',
  ].join(' '),
  // Provider adapters receive a conservative, dereferenced JSON Schema.
  // groundedResponseSchema remains the authoritative runtime validator.
  schema: providerPortableToolSchema(groundedResponseSchema),
};

export type GroundedResponseValidation =
  | {
      ok: true;
      customerText: string;
      projectionDigest: string;
      factualClaims: ResponseFactualClaims;
      publicationDeclaration: ResponsePublicationDeclaration;
      selectedActionResponse?: SelectedActionResponseReference;
    }
  | { ok: false; errorCode: string };

export type ResponseFactualClaimsValidation =
  | { ok: true; factualClaims: ResponseFactualClaims }
  | { ok: false; errorCode: string };

export function validateResponseFactualClaims(
  input: {
    raw: unknown;
    bundle: ModelPublicationBundle;
  },
): ResponseFactualClaimsValidation {
  if (!isIssuedModelPublicationBundle(input.bundle)) {
    return {
      ok: false,
      errorCode: 'agent_model_publication_reference_invalid',
    };
  }
  const parsed = responseFactualClaimsSchema.safeParse(input.raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'agent_grounded_response_invalid' };
  }
  if (parsed.data.hasUnsupportedFactualClaim) {
    return { ok: false, errorCode: 'agent_response_claim_unsupported' };
  }
  const evidenceById = new Map(
    input.bundle.evidence.map((entry) => [
      entry.evidenceId,
      entry,
    ]),
  );
  const allowedEvidenceIds = new Set(input.bundle.allowedEvidenceIds);
  for (const reference of parsed.data.evidenceReferences) {
    const evidence = evidenceById.get(reference.evidenceId);
    if (
      !evidence ||
      !allowedEvidenceIds.has(reference.evidenceId) ||
      reference.claimKinds.some(
        (kind) => !evidence.claimKinds.includes(kind),
      )
    ) {
      return { ok: false, errorCode: 'agent_response_evidence_mismatch' };
    }
    const governedClaim = reference.claimKinds.includes('policy') ||
      reference.claimKinds.includes('allergen');
    if (
      governedClaim &&
      (!reference.claimKinds.includes('source') || !evidence.officialSource)
    ) {
      return {
        ok: false,
        errorCode: 'agent_response_official_source_required',
      };
    }
  }
  return { ok: true, factualClaims: parsed.data };
}

export function validateGroundedResponse(
  input: {
    raw: unknown;
    bundle: ModelPublicationBundle;
  },
): GroundedResponseValidation {
  const parsed = groundedResponseSchema.safeParse(input.raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'agent_grounded_response_invalid' };
  }
  if (
    !validateModelPublicationReference({
      bundle: input.bundle,
      projectionDigest: parsed.data.projectionDigest,
    })
  ) {
    return {
      ok: false,
      errorCode: 'agent_model_publication_reference_invalid',
    };
  }
  const claims = validateResponseFactualClaims({
    raw: parsed.data.factualClaims,
    bundle: input.bundle,
  });
  return claims.ok
    ? {
        ok: true,
        customerText: parsed.data.customerText,
        projectionDigest: parsed.data.projectionDigest,
        factualClaims: claims.factualClaims,
        publicationDeclaration: parsed.data.publicationDeclaration,
        ...(parsed.data.selectedActionResponse
          ? { selectedActionResponse: parsed.data.selectedActionResponse }
          : {}),
      }
    : claims;
}
