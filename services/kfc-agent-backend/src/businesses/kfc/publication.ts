import { z } from 'zod';
import {
  responseClaimKindSchema,
  responseEvidenceLimitationSchema,
} from '../../agent/responseEvidenceContracts.js';
import { selectedActionResponseReferenceSchema } from '../../agent/selectedActionResponseAuthority.js';

const disclosureAuthoritySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('current_user_message'),
      messageDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal('publication_evidence'),
      evidenceId: z.string().trim().min(1).max(128),
    })
    .strict(),
]);

export const kfcGroundedPublicationSchema = z
  .object({
    customerText: z.string().trim().min(1),
    projectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    factualClaims: z
      .object({
        evidenceReferences: z.array(
          z
            .object({
              evidenceId: z.string().trim().min(1),
              claimKinds: z.array(responseClaimKindSchema).min(1),
            })
            .strict(),
        ),
        disclosedLimitations: z.array(responseEvidenceLimitationSchema),
        hasUnsupportedFactualClaim: z.boolean(),
      })
      .strict(),
    publicationDeclaration: z
      .object({
        semanticRelevance: z.enum(['aligned', 'misaligned']),
        privateDataDisclosure: z.enum(['none', 'authorized', 'unauthorized']),
        disclosureAuthorities: z.array(disclosureAuthoritySchema).max(64),
        disclosesInternalMetadata: z.boolean(),
      })
      .strict(),
    selectedActionResponse: selectedActionResponseReferenceSchema.nullable(),
  })
  .strict();

export type KfcGroundedPublication = z.infer<
  typeof kfcGroundedPublicationSchema
>;
