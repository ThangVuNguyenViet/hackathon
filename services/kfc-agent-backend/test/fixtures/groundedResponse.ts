import {
  AIMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import { z } from 'zod';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  type ResponseClaimKind,
  type ResponseFactualClaims,
} from '../../src/agent/responseGrounding.js';
import {
  responseClaimKindSchema,
  type ResponseEvidenceLimitation,
} from '../../src/agent/responseEvidenceContracts.js';
import type {
  SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';

type EvidenceReference = {
  evidenceId: string;
  claimKinds: ResponseClaimKind[];
};

const groundedResponsePublicationSchema = z.object({
  projectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  evidence: z.array(z.object({
    evidenceId: z.string().min(1),
    claimKinds: z.array(responseClaimKindSchema),
    privateData: z.boolean(),
  }).passthrough()),
}).passthrough();

type GroundedResponsePublication =
  z.infer<typeof groundedResponsePublicationSchema>;
type EvidenceReferenceInput =
  | EvidenceReference[]
  | ((publication: GroundedResponsePublication) => EvidenceReference[]);

export function groundedResponseClaims(input: {
  evidenceReferences?: Array<{
    evidenceId: string;
    claimKinds: ResponseClaimKind[];
  }>;
  disclosedLimitations?: ResponseEvidenceLimitation[];
  hasUnsupportedFactualClaim?: boolean;
} = {}): ResponseFactualClaims {
  return {
    evidenceReferences: input.evidenceReferences ?? [],
    disclosedLimitations: input.disclosedLimitations ?? [],
    hasUnsupportedFactualClaim:
      input.hasUnsupportedFactualClaim ?? false,
  };
}

export function groundedResponseToolCall(input: {
  customerText: string;
  projectionDigest: string;
  evidenceReferences?: Array<{
    evidenceId: string;
    claimKinds: ResponseClaimKind[];
  }>;
  disclosedLimitations?: ResponseEvidenceLimitation[];
  hasUnsupportedFactualClaim?: boolean;
  publicationDeclaration?: {
    semanticRelevance: 'aligned' | 'misaligned';
    privateDataDisclosure: 'none' | 'authorized' | 'unauthorized';
    disclosureAuthorities: Array<
      | {
          kind: 'current_user_message';
          messageDigest: string;
        }
      | {
          kind: 'publication_evidence';
          evidenceId: string;
        }
    >;
    disclosesInternalMetadata: boolean;
  };
  selectedActionResponse?: SelectedActionResponseReference;
}): ToolCall {
  return {
    name: GROUNDED_RESPONSE_TOOL_NAME,
    args: {
      customerText: input.customerText,
      projectionDigest: input.projectionDigest,
      factualClaims: groundedResponseClaims(input),
      publicationDeclaration: input.publicationDeclaration ?? {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
      selectedActionResponse: input.selectedActionResponse ?? null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function publicationSnapshot(
  messages: BaseMessage[],
): GroundedResponsePublication {
  for (const message of [...messages].reverse()) {
    if (typeof message.content !== 'string') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const publication = parsed.publication;
    const result = groundedResponsePublicationSchema.safeParse(publication);
    if (result.success) return result.data;
  }
  // The LangChain pack owns publication validation directly and therefore no
  // longer injects the deleted graph publication snapshot into model history.
  // Tests that do not need private evidence can still author a valid neutral
  // publication with an opaque deterministic projection digest.
  return {
    projectionDigest: '0'.repeat(64),
    evidence: [],
  };
}

function evidenceReferences(
  input: EvidenceReferenceInput | undefined,
  publication: GroundedResponsePublication,
): EvidenceReference[] | undefined {
  const requested = typeof input === 'function'
    ? input(publication)
    : input;
  if (!requested) return undefined;
  const issued = new Set(publication.evidence.map(({ evidenceId }) => evidenceId));
  return requested.filter(({ evidenceId }) => issued.has(evidenceId));
}

export function groundedResponseModelReply(input: {
  customerText: string;
  evidenceReferences?: EvidenceReferenceInput;
  disclosedLimitations?: ResponseEvidenceLimitation[];
  hasUnsupportedFactualClaim?: boolean;
  publicationDeclaration?: {
    semanticRelevance: 'aligned' | 'misaligned';
    privateDataDisclosure: 'none' | 'authorized' | 'unauthorized';
    disclosureAuthorities: Array<
      | {
          kind: 'current_user_message';
          messageDigest: string;
        }
      | {
          kind: 'publication_evidence';
          evidenceId: string;
        }
    >;
    disclosesInternalMetadata: boolean;
  };
  selectedActionResponse?: SelectedActionResponseReference;
}): (messages: BaseMessage[]) => AIMessage {
  return (messages) => {
    const publication = publicationSnapshot(messages);
    return new AIMessage(JSON.stringify({
      customerText: input.customerText,
      projectionDigest: publication.projectionDigest,
      factualClaims: groundedResponseClaims({
        evidenceReferences: evidenceReferences(
          input.evidenceReferences,
          publication,
        ),
        disclosedLimitations: input.disclosedLimitations,
        hasUnsupportedFactualClaim: input.hasUnsupportedFactualClaim,
      }),
      publicationDeclaration: input.publicationDeclaration ?? {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
      selectedActionResponse: input.selectedActionResponse ?? null,
    }));
  };
}
