import {
  AIMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { fakeModel } from '@langchain/core/testing';
import { z } from 'zod';
import type {
  ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
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
import {
  selectedActionResponseReferenceSchema,
} from '../../src/agent/selectedActionResponseAuthority.js';
import type {
  SelectedActionSemanticTarget,
} from '../../src/agent/selectedActionResponseVerification.js';
import { stateRevision } from '../../src/graph/turnSupport.js';

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

export async function groundedResponseVerification(input: {
  publicationBundle: Pick<ModelPublicationBundle, 'projectionDigest'>;
  customerText: string;
  evidenceReferences?: Array<{
    evidenceId: string;
    claimKinds: ResponseClaimKind[];
  }>;
  hasUnsupportedFactualClaim?: boolean;
  selectedActionTarget?: Pick<SelectedActionSemanticTarget, 'reference'>;
  semanticAlignment?: 'aligned' | 'misaligned';
}) {
  return {
    ...groundedResponseClaims(input),
    publicationAttestation: {
      schemaVersion:
        'kfc-response-publication-attestation-v1' as const,
      projectionDigest: input.publicationBundle.projectionDigest,
      responseDigest: await stateRevision(input.customerText),
      semanticRelevance: 'aligned' as const,
      privateDataDisclosure: 'none' as const,
      disclosureAuthorities: [],
      disclosesInternalMetadata: false,
    },
    ...(input.selectedActionTarget
      ? {
          selectedActionAttestation: selectedActionSemanticAttestation(
            input.selectedActionTarget.reference,
            input.semanticAlignment,
          ),
        }
      : {}),
  };
}

export function selectedActionSemanticAttestation(
  reference: SelectedActionResponseReference,
  semanticAlignment: 'aligned' | 'misaligned' = 'aligned',
) {
  return {
    schemaVersion:
      'kfc-selected-action-semantic-attestation-v1' as const,
    reference,
    semanticAlignment,
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
  selectedActionResponse?: SelectedActionResponseReference;
}): ToolCall {
  return {
    name: GROUNDED_RESPONSE_TOOL_NAME,
    args: {
      customerText: input.customerText,
      projectionDigest: input.projectionDigest,
      factualClaims: groundedResponseClaims(input),
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

interface VerifierPayload {
  customerText: string;
  publicationBundle: GroundedResponsePublication;
  selectedActionTarget?: Pick<SelectedActionSemanticTarget, 'reference'>;
}

function verifierPayload(input: unknown): VerifierPayload {
  const message = Array.isArray(input) ? input.at(-1) : undefined;
  if (!isRecord(message) || typeof message.content !== 'string') {
    throw new Error('test_response_verifier_payload_missing');
  }
  const parsed: unknown = JSON.parse(message.content);
  if (
    !isRecord(parsed) ||
    typeof parsed.customerText !== 'string' ||
    !isRecord(parsed.publicationBundle)
  ) {
    throw new Error('test_response_verifier_payload_invalid');
  }
  const publicationBundle =
    groundedResponsePublicationSchema.safeParse(parsed.publicationBundle);
  if (!publicationBundle.success) {
    throw new Error('test_response_verifier_payload_invalid');
  }
  const selectedActionTarget = parsed.selectedActionTarget;
  const selectedActionReference = isRecord(selectedActionTarget)
    ? selectedActionResponseReferenceSchema.safeParse(
        selectedActionTarget.reference,
      )
    : undefined;
  return {
    customerText: parsed.customerText,
    publicationBundle: publicationBundle.data,
    ...(selectedActionReference?.success
      ? {
          selectedActionTarget: {
            reference: selectedActionReference.data,
          },
        }
      : {}),
  };
}

export function groundedResponseVerifierModel(input: {
  evidenceReferences?: EvidenceReferenceInput;
  hasUnsupportedFactualClaim?: boolean;
  semanticAlignment?: 'aligned' | 'misaligned';
  publicationSemanticRelevance?: 'aligned' | 'misaligned';
  privateDataDisclosure?: 'none' | 'authorized' | 'unauthorized';
  disclosureAuthorities?: Array<
    | {
        kind: 'current_user_message';
        messageDigest: string;
      }
    | {
        kind: 'publication_evidence';
        evidenceId: string;
      }
  >;
  disclosesInternalMetadata?: boolean;
  authorizeReferencedPrivateEvidence?: boolean;
  rawOutput?: Record<string, unknown>;
} = {}) {
  const model = fakeModel();
  Object.defineProperty(model, 'withStructuredOutput', {
    value: () =>
      RunnableLambda.from(async (raw: unknown) => {
        if (input.rawOutput) return input.rawOutput;
        const payload = verifierPayload(raw);
        const resolvedEvidenceReferences = evidenceReferences(
          input.evidenceReferences,
          payload.publicationBundle,
        );
        const referencedPrivateEvidenceIds =
          input.authorizeReferencedPrivateEvidence
            ? (resolvedEvidenceReferences ?? [])
                .map(({ evidenceId }) => evidenceId)
                .filter((evidenceId) =>
                  payload.publicationBundle.evidence.some(
                    (entry) =>
                      entry.evidenceId === evidenceId &&
                      entry.privateData,
                  ))
            : [];
        const verification = await groundedResponseVerification({
          publicationBundle: payload.publicationBundle,
          customerText: payload.customerText,
          evidenceReferences: resolvedEvidenceReferences,
          hasUnsupportedFactualClaim:
            input.hasUnsupportedFactualClaim,
          selectedActionTarget: payload.selectedActionTarget,
          semanticAlignment: input.semanticAlignment,
        });
        return {
          ...verification,
          publicationAttestation: {
            ...verification.publicationAttestation,
            semanticRelevance:
              input.publicationSemanticRelevance ?? 'aligned',
            privateDataDisclosure:
              input.privateDataDisclosure ??
              (referencedPrivateEvidenceIds.length > 0
                ? 'authorized'
                : 'none'),
            disclosureAuthorities:
              input.disclosureAuthorities ??
              referencedPrivateEvidenceIds.map((evidenceId) => ({
                kind: 'publication_evidence' as const,
                evidenceId,
              })),
            disclosesInternalMetadata:
              input.disclosesInternalMetadata ?? false,
          },
        };
      }),
  });
  return model;
}
