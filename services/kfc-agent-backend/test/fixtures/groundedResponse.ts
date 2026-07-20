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
  hasUnsupportedFactualClaim?: boolean;
} = {}): ResponseFactualClaims {
  return {
    evidenceReferences: input.evidenceReferences ?? [],
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
      ...(input.selectedActionResponse
        ? { selectedActionResponse: input.selectedActionResponse }
        : {}),
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
  throw new Error('test_model_publication_missing');
}

function evidenceReferences(
  input: EvidenceReferenceInput | undefined,
  publication: GroundedResponsePublication,
): EvidenceReference[] | undefined {
  return typeof input === 'function'
    ? input(publication)
    : input;
}

export function groundedResponseModelReply(input: {
  customerText: string;
  evidenceReferences?: EvidenceReferenceInput;
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
    return (
    new AIMessage({
      content: '',
      tool_calls: [groundedResponseToolCall({
        ...input,
        evidenceReferences: evidenceReferences(
          input.evidenceReferences,
          publication,
        ),
        projectionDigest: publication.projectionDigest,
      })],
    })
    );
  };
}
