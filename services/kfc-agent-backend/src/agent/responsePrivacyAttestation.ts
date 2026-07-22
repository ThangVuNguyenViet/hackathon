import { z } from 'zod';
import {
  privateDisclosureEvidenceIds,
  isIssuedModelPublicationBundle,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import { stateRevision } from '../graph/turnSupport.js';
import type { ResponseEvidenceLimitation } from './responseEvidenceContracts.js';

export const RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION =
  'kfc-response-publication-attestation-v1' as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const evidenceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => value === value.trim(),
    'Evidence identifiers must not require normalization',
  );

const disclosureAuthoritySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('current_user_message'),
      messageDigest: digestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('publication_evidence'),
      evidenceId: evidenceIdSchema,
    })
    .strict(),
]);

export const responsePublicationAttestationSchema = z
  .object({
    schemaVersion: z.literal(RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION),
    projectionDigest: digestSchema,
    responseDigest: digestSchema,
    semanticRelevance: z.enum(['aligned', 'misaligned']),
    privateDataDisclosure: z.enum(['none', 'authorized', 'unauthorized']),
    disclosureAuthorities: z.array(disclosureAuthoritySchema).max(64),
    disclosesInternalMetadata: z.boolean(),
  })
  .strict();

export type ResponsePublicationAttestation = z.infer<
  typeof responsePublicationAttestationSchema
>;

export const responsePublicationDeclarationSchema =
  responsePublicationAttestationSchema
    .pick({
      semanticRelevance: true,
      privateDataDisclosure: true,
      disclosureAuthorities: true,
      disclosesInternalMetadata: true,
    })
    .strict();

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

export type ResponsePublicationDeclarationConsistencyValidation =
  | { ok: true }
  | {
      ok: false;
      errorCode: 'agent_response_publication_rejected';
      correctable: boolean;
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

function declarationRejected(
  correctable: boolean,
): ResponsePublicationDeclarationConsistencyValidation {
  return {
    ok: false,
    errorCode: 'agent_response_publication_rejected',
    correctable,
  };
}

function normalizeHarmlessPublicEvidenceAuthorities(
  declaration: ResponsePublicationDeclaration,
  bundle: ModelPublicationBundle,
): ResponsePublicationDeclaration {
  if (declaration.privateDataDisclosure !== 'none') return declaration;

  const privateEvidenceIds = new Set(privateDisclosureEvidenceIds(bundle));
  const issuedEvidenceIds = new Set(
    bundle.evidence.map(({ evidenceId }) => evidenceId),
  );
  const disclosureAuthorities = declaration.disclosureAuthorities.filter(
    (authority) =>
      authority.kind !== 'publication_evidence' ||
      !issuedEvidenceIds.has(authority.evidenceId) ||
      privateEvidenceIds.has(authority.evidenceId),
  );
  return disclosureAuthorities.length ===
    declaration.disclosureAuthorities.length
    ? declaration
    : { ...declaration, disclosureAuthorities };
}

export function validateResponsePublicationDeclarationConsistency(input: {
  raw: unknown;
  bundle: ModelPublicationBundle;
  factualClaims: {
    evidenceReferences: readonly { evidenceId: string }[];
  };
}): ResponsePublicationDeclarationConsistencyValidation {
  if (!isIssuedModelPublicationBundle(input.bundle)) {
    return declarationRejected(false);
  }
  const parsedDeclaration = responsePublicationDeclarationSchema.safeParse(
    input.raw,
  );
  if (!parsedDeclaration.success) return declarationRejected(false);
  const declaration = normalizeHarmlessPublicEvidenceAuthorities(
    parsedDeclaration.data,
    input.bundle,
  );
  if (
    declaration.semanticRelevance !== 'aligned' ||
    declaration.privateDataDisclosure === 'unauthorized' ||
    declaration.disclosesInternalMetadata
  ) {
    return declarationRejected(false);
  }

  const privateEvidenceIds = new Set(
    privateDisclosureEvidenceIds(input.bundle),
  );
  const issuedEvidenceIds = new Set(
    input.bundle.evidence.map(({ evidenceId }) => evidenceId),
  );
  if (
    declaration.disclosureAuthorities.some((authority) =>
      authority.kind === 'publication_evidence'
        ? !issuedEvidenceIds.has(authority.evidenceId)
        : authority.messageDigest !==
          input.bundle.lifecycle.currentUserMessageDigest,
    )
  ) {
    return declarationRejected(false);
  }
  const authorityKeys = declaration.disclosureAuthorities.map(authorityKey);
  if (new Set(authorityKeys).size !== authorityKeys.length) {
    return declarationRejected(true);
  }

  const citedPrivateEvidenceIds = [
    ...new Set(
      input.factualClaims.evidenceReferences
        .map(({ evidenceId }) => evidenceId)
        .filter((evidenceId) => privateEvidenceIds.has(evidenceId)),
    ),
  ].sort();
  const declaredPrivateEvidenceIds = declaration.disclosureAuthorities
    .flatMap((authority) =>
      authority.kind === 'publication_evidence' ? [authority.evidenceId] : [],
    )
    .sort();
  const authoritySetMismatch =
    JSON.stringify(citedPrivateEvidenceIds) !==
    JSON.stringify(declaredPrivateEvidenceIds);
  const disclosureFlagMismatch =
    (citedPrivateEvidenceIds.length > 0 &&
      declaration.privateDataDisclosure !== 'authorized') ||
    (declaration.privateDataDisclosure === 'none' &&
      declaration.disclosureAuthorities.length > 0) ||
    (declaration.privateDataDisclosure === 'authorized' &&
      declaration.disclosureAuthorities.length === 0);

  return authoritySetMismatch || disclosureFlagMismatch
    ? declarationRejected(true)
    : { ok: true };
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
    attestation.disclosureAuthorities.some((authority) =>
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
    disclosedLimitations: readonly ResponseEvidenceLimitation[];
    hasUnsupportedFactualClaim?: boolean;
  };
}): Promise<ResponsePublicationAttestationValidation> {
  const parsedDeclaration = responsePublicationDeclarationSchema.safeParse(
    input.raw,
  );
  if (!parsedDeclaration.success) return rejected();
  const declaration = normalizeHarmlessPublicEvidenceAuthorities(
    parsedDeclaration.data,
    input.bundle,
  );
  const consistency = validateResponsePublicationDeclarationConsistency({
    raw: declaration,
    bundle: input.bundle,
    factualClaims: input.factualClaims,
  });
  if (!consistency.ok) return rejected();
  return validateResponsePublicationAttestation({
    raw: {
      schemaVersion: RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION,
      projectionDigest: input.bundle.projectionDigest,
      responseDigest: await stateRevision(input.customerText),
      ...declaration,
    },
    bundle: input.bundle,
    customerText: input.customerText,
  });
}
