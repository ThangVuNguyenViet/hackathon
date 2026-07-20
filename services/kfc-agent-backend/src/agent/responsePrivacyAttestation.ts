import { z } from 'zod';
import {
  privateDisclosureEvidenceIds,
  isIssuedModelPublicationBundle,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import { stateRevision } from '../graph/turnSupport.js';

export const RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION =
  'kfc-response-publication-attestation-v1' as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const evidenceIdSchema = z.string()
  .min(1)
  .max(128)
  .refine(
    (value) => value === value.trim(),
    'Evidence identifiers must not require normalization',
  );

const disclosureAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('current_user_message'),
    messageDigest: digestSchema,
  }).strict(),
  z.object({
    kind: z.literal('publication_evidence'),
    evidenceId: evidenceIdSchema,
  }).strict(),
]);

export const responsePublicationAttestationSchema = z.object({
  schemaVersion: z.literal(
    RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION,
  ),
  projectionDigest: digestSchema,
  responseDigest: digestSchema,
  semanticRelevance: z.enum(['aligned', 'misaligned']),
  privateDataDisclosure: z.enum([
    'none',
    'authorized',
    'unauthorized',
  ]),
  disclosureAuthorities: z.array(disclosureAuthoritySchema).max(64),
  disclosesInternalMetadata: z.boolean(),
}).strict();

export type ResponsePublicationAttestation = z.infer<
  typeof responsePublicationAttestationSchema
>;

export const responsePublicationDeclarationSchema =
  responsePublicationAttestationSchema.pick({
    semanticRelevance: true,
    privateDataDisclosure: true,
    disclosureAuthorities: true,
    disclosesInternalMetadata: true,
  }).strict();

export type ResponsePublicationDeclaration = z.infer<
  typeof responsePublicationDeclarationSchema
>;

export type ResponsePublicationAttestationValidation =
  | {
      ok: true;
      attestation: ResponsePublicationAttestation;
      responsePublicationSafe: true;
    }
  | {
      ok: false;
      errorCode: 'agent_response_publication_rejected';
      responsePublicationSafe: false;
    };

function rejected(): ResponsePublicationAttestationValidation {
  return {
    ok: false,
    errorCode: 'agent_response_publication_rejected',
    responsePublicationSafe: false,
  };
}

function authorityKey(
  authority: ResponsePublicationAttestation['disclosureAuthorities'][number],
): string {
  return authority.kind === 'current_user_message'
    ? `${authority.kind}:${authority.messageDigest}`
    : `${authority.kind}:${authority.evidenceId}`;
}

export async function validateResponsePublicationAttestation(input: {
  raw: unknown;
  bundle: ModelPublicationBundle;
  customerText: string;
}): Promise<ResponsePublicationAttestationValidation> {
  if (!isIssuedModelPublicationBundle(input.bundle)) return rejected();
  const parsed = responsePublicationAttestationSchema.safeParse(input.raw);
  if (!parsed.success) return rejected();

  const attestation = parsed.data;
  const responseDigest = await stateRevision(input.customerText);
  if (
    attestation.projectionDigest !== input.bundle.projectionDigest ||
    attestation.responseDigest !== responseDigest ||
    attestation.semanticRelevance !== 'aligned' ||
    attestation.privateDataDisclosure === 'unauthorized' ||
    attestation.disclosesInternalMetadata
  ) {
    return rejected();
  }

  const authorityKeys = attestation.disclosureAuthorities.map(authorityKey);
  if (new Set(authorityKeys).size !== authorityKeys.length) {
    return rejected();
  }

  const allowedEvidenceIds = new Set(
    privateDisclosureEvidenceIds(input.bundle),
  );
  if (
    attestation.disclosureAuthorities.some(
      (authority) =>
        authority.kind === 'publication_evidence'
          ? !allowedEvidenceIds.has(authority.evidenceId)
          : authority.messageDigest !==
            input.bundle.lifecycle.currentUserMessageDigest,
    )
  ) {
    return rejected();
  }

  if (
    attestation.privateDataDisclosure === 'none' &&
    attestation.disclosureAuthorities.length !== 0
  ) {
    return rejected();
  }
  if (
    attestation.privateDataDisclosure === 'authorized' &&
    attestation.disclosureAuthorities.length === 0
  ) {
    return rejected();
  }
  if (!isIssuedModelPublicationBundle(input.bundle)) return rejected();

  return {
    ok: true,
    attestation,
    responsePublicationSafe: true,
  };
}

/**
 * Binds the author model's publication declaration to trusted digests. The
 * model declares semantic properties as part of its single final-response
 * action; deterministic code supplies and validates all cryptographic and
 * closed-world authority bindings without making a second model call.
 */
export async function issueResponsePublicationAttestation(input: {
  raw: unknown;
  bundle: ModelPublicationBundle;
  customerText: string;
  factualClaims: {
    evidenceReferences: readonly {
      evidenceId: string;
      claimKinds?: readonly string[];
    }[];
    hasUnsupportedFactualClaim?: boolean;
  };
}): Promise<ResponsePublicationAttestationValidation> {
  const declaration = responsePublicationDeclarationSchema.safeParse(
    input.raw,
  );
  if (!declaration.success) return rejected();
  const privateEvidenceIds = new Set(
    privateDisclosureEvidenceIds(input.bundle),
  );
  const citedPrivateEvidenceIds = [
    ...new Set(
      input.factualClaims.evidenceReferences
        .map(({ evidenceId }) => evidenceId)
        .filter((evidenceId) => privateEvidenceIds.has(evidenceId)),
    ),
  ].sort();
  const declaredPrivateEvidenceIds = declaration.data
    .disclosureAuthorities
    .flatMap((authority) =>
      authority.kind === 'publication_evidence'
        ? [authority.evidenceId]
        : [])
    .sort();
  if (
    JSON.stringify(citedPrivateEvidenceIds) !==
      JSON.stringify(declaredPrivateEvidenceIds) ||
    (
      citedPrivateEvidenceIds.length > 0 &&
      declaration.data.privateDataDisclosure !== 'authorized'
    )
  ) {
    return rejected();
  }
  return validateResponsePublicationAttestation({
    raw: {
      schemaVersion: RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION,
      projectionDigest: input.bundle.projectionDigest,
      responseDigest: await stateRevision(input.customerText),
      ...declaration.data,
    },
    bundle: input.bundle,
    customerText: input.customerText,
  });
}
