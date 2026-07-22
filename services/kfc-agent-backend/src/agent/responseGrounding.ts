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
  responseEvidenceLimitationSchema,
  type ResponseEvidenceLimitationId,
  type ResponseEvidenceSubjectScope,
} from './responseEvidenceContracts.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import { MODEL_PUBLICATION_VALUE_REFERENCE_KEY } from './modelPublicationContextProjection.js';
import { providerPortableToolSchema } from './providerPortableToolSchema.js';
export {
  responseClaimKindSchema,
  type ResponseClaimEvidence,
  type ResponseClaimKind,
} from './responseEvidenceContracts.js';

export const GROUNDED_RESPONSE_TOOL_NAME = 'submitGroundedResponse';
export const CUSTOMER_TEXT_RESPONSE_DESCRIPTION =
  'Directly answer the latest customer request as the assistant using relevant verified publication evidence. Give the concrete requested facts; never evade by saying they are present in the menu, match displayed names, or are available in evidence. Write only customer-useful prose in the customer language. Never expose schema field names, enum values, evidence identifiers, source labels, validation bookkeeping, tool terminology, or graph state terminology. Render uncertainty naturally without copying internal labels. If the customer asks for advice without an action, comply silently instead of repeating that no cart or order change occurred. Do not copy, concatenate, or merely restate customer messages or the conversation transcript.';
export const FACTUAL_EVIDENCE_REFERENCES_DESCRIPTION =
  'For every factual claim in customerText, cite matching allowed current publication evidence. A factual answer about products, prices, composition, modifiers, availability, policies, orders, payments, membership, or tool outcomes requires at least one matching evidence reference. Exact customer-facing product and option names in trusted menu evidence are authoritative product metadata: explicitly named attributes such as không cay or sugar-free may be used directly without an uncertainty disclaimer. If required evidence is absent, call relevant read tools before returning this response; customer and prior assistant messages are not evidence.';
export const UNCITED_SUBJECTS_OR_ASPECTS_LIMITATION_DESCRIPTION =
  'For uncited_subjects_or_aspects_unknown, bind a concrete evidenceSubject from cited evidence and a concrete customerCriterion excerpt verbatim from the latest customer request in structured metadata, name the internal unverifiedAspect, and write customerDisclosure as a natural sentence in the customer language that states the relevant uncertainty without copying internal field names or enum values. Exact customer-facing product and option names in trusted menu evidence may directly support attributes explicitly present in those names. Do not infer an attribute from an omitted field, a missing option, or metadata that does not state it.';
export const EVIDENCE_LIMITATION_SUBJECT_SCOPE_DESCRIPTION =
  'When a required limitation has subjectScope included_modifier_option_name, evidenceSubject must exactly equal the name of a nested included modifier option whose modifierId is present and whose default is true; never use the enclosing product name, a modifier-group name, or an unselected alternative.';
export const COMPOSITE_PRODUCT_LIMITATION_DESCRIPTION =
  'For composite-product advice, a verified criterion-matching option may support the recommendation; choose evidenceSubject for an included component whose criterion-relevant aspect remains unknown, not the option that already satisfies the criterion, and disclose that exact unresolved aspect without claiming it.';

export function boundedGroundedResponseFeedback(errorCode: string): string {
  const prefix = `The prior structured response was rejected (${errorCode}). `;
  return `${prefix}Return a corrected response using the current publication. Make disclosedLimitations exactly match cited requiredLimitations. Bind a short customerCriterion excerpt verbatim from the latest request and an included evidenceSubject from cited evidence in structured metadata. Write customerDisclosure naturally in the customer language, state the relevant uncertainty, and include that sentence verbatim in customerText without copying schema fields, enum values, evidence identifiers, source labels, or internal bookkeeping. Do not repeat an advice-only or no-mutation constraint unless the customer asks whether an action occurred. ${COMPOSITE_PRODUCT_LIMITATION_DESCRIPTION}`.slice(
    0,
    1_024,
  );
}
export const DISCLOSED_EVIDENCE_LIMITATIONS_DESCRIPTION = [
  'When cited evidence lists requiredLimitations for a cited claim kind, include one object here for each exact required limitationId.',
  'Set coverageStatus to unknown_or_unverified, copy evidenceSubject from the cited evidence and customerCriterion verbatim from the latest customer request, name the internal unverifiedAspect, and write a natural customerDisclosure sentence in the customer language that states the relevant uncertainty and appears verbatim in customerText. Do not copy schema fields, enum values, evidence identifiers, source labels, or internal bookkeeping into customerDisclosure.',
  UNCITED_SUBJECTS_OR_ASPECTS_LIMITATION_DESCRIPTION,
  EVIDENCE_LIMITATION_SUBJECT_SCOPE_DESCRIPTION,
  COMPOSITE_PRODUCT_LIMITATION_DESCRIPTION,
  'Include no limitationId that is not required by cited evidence.',
].join(' ');

export const responseEvidenceReferenceSchema = z
  .object({
    evidenceId: z.string().trim().min(1),
    claimKinds: z.array(responseClaimKindSchema).min(1),
  })
  .strict();

export const responseFactualClaimsSchema = z
  .object({
    evidenceReferences: z
      .array(responseEvidenceReferenceSchema)
      .describe(FACTUAL_EVIDENCE_REFERENCES_DESCRIPTION),
    disclosedLimitations: z
      .array(responseEvidenceLimitationSchema)
      .describe(DISCLOSED_EVIDENCE_LIMITATIONS_DESCRIPTION),
    hasUnsupportedFactualClaim: z.boolean(),
  })
  .strict();

export type ResponseFactualClaims = z.infer<typeof responseFactualClaimsSchema>;

const groundedResponseShape = {
  customerText: z
    .string()
    .trim()
    .min(1)
    .describe(CUSTOMER_TEXT_RESPONSE_DESCRIPTION),
  projectionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  factualClaims: responseFactualClaimsSchema,
  publicationDeclaration: responsePublicationDeclarationSchema,
};

export const ordinaryGroundedResponseSchema = z
  .object({
    ...groundedResponseShape,
    selectedActionResponse: z.null(),
  })
  .strict();

export const selectedActionGroundedResponseSchema = z
  .object({
    ...groundedResponseShape,
    selectedActionResponse: selectedActionResponseReferenceSchema,
  })
  .strict();

export const groundedResponseSchema = z
  .object({
    ...groundedResponseShape,
    selectedActionResponse: selectedActionResponseReferenceSchema.nullable(),
  })
  .strict();

function responseToolDescription(selectedActionInstruction: string): string {
  return [
    'Submit the final customer-facing response instead of returning plain text.',
    'Copy projectionDigest exactly from the issued model publication bundle.',
    'Reference the closed-world verified response evidence for every factual claim.',
    'For cited evidence with requiredLimitations matching a cited claim kind, add one factualClaims.disclosedLimitations object containing its exact limitationId, coverageStatus unknown_or_unverified, an evidenceSubject copied from that cited evidence, a customerCriterion copied verbatim from the latest customer request, an internal unverifiedAspect, and a natural customerDisclosure sentence in the customer language that states the relevant uncertainty and appears verbatim in customerText.',
    UNCITED_SUBJECTS_OR_ASPECTS_LIMITATION_DESCRIPTION,
    EVIDENCE_LIMITATION_SUBJECT_SCOPE_DESCRIPTION,
    COMPOSITE_PRODUCT_LIMITATION_DESCRIPTION,
    'Include no disclosedLimitations limitationId that is not required by cited evidence.',
    'Set hasUnsupportedFactualClaim when any factual claim is not fully supported.',
    'Declare semantic relevance, private-data disclosure authority, and internal-metadata disclosure in publicationDeclaration.',
    'For every cited publication evidence entry with privateData true, set privateDataDisclosure to authorized and include exactly one publication_evidence authority with the same evidenceId.',
    'current_user_message only authorizes private data explicitly supplied in the current user message, never facts learned from publication evidence.',
    'Do not add extra or duplicate disclosure authorities.',
    'With no cited private publication evidence, include no publication_evidence authority.',
    'Set privateDataDisclosure to unauthorized or disclosesInternalMetadata to true instead of submitting unsafe customer text.',
    'Submit exactly { customerText, projectionDigest, factualClaims: { evidenceReferences, disclosedLimitations, hasUnsupportedFactualClaim }, publicationDeclaration, selectedActionResponse }.',
    'hasUnsupportedFactualClaim is required inside factualClaims and is never a top-level field.',
    selectedActionInstruction,
  ].join(' ');
}

export const ordinaryGroundedResponseToolDefinition: StructuredToolParams = {
  name: GROUNDED_RESPONSE_TOOL_NAME,
  description: responseToolDescription(
    'Set selectedActionResponse to null. Ordinary turns have no trusted selected-action response authority.',
  ),
  schema: providerPortableToolSchema(ordinaryGroundedResponseSchema),
};

export const selectedActionGroundedResponseToolDefinition: StructuredToolParams =
  {
    name: GROUNDED_RESPONSE_TOOL_NAME,
    description: responseToolDescription(
      'Copy responseContract.selectedActionResponse exactly; never derive it from publication evidence.',
    ),
    schema: providerPortableToolSchema(selectedActionGroundedResponseSchema),
  };

// Provider adapters receive mode-specific conservative JSON Schemas above.
// This broader schema remains the authoritative shared runtime parser.
export const groundedResponseToolDefinition =
  ordinaryGroundedResponseToolDefinition;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CUSTOMER_RESPONSE_CONTRACT_TOKENS = new Set([
  'uncited_subjects_or_aspects_unknown',
  'unknown_or_unverified',
  'modifier_option_name',
  'included_modifier_option_name',
  'limitationId',
  'coverageStatus',
  'evidenceSubject',
  'customerCriterion',
  'unverifiedAspect',
  'customerDisclosure',
  'projectionDigest',
  'factualClaims',
  'evidenceReferences',
  'disclosedLimitations',
  'hasUnsupportedFactualClaim',
  'publicationDeclaration',
  'semanticRelevance',
  'privateDataDisclosure',
  'disclosureAuthorities',
  'disclosesInternalMetadata',
  'selectedActionResponse',
  'subjectScope',
  'requiredLimitations',
  'publication_evidence',
  'current_user_message',
  'verified_state',
  'current_turn_execution',
  'current_turn_authenticated',
  MODEL_PUBLICATION_VALUE_REFERENCE_KEY,
]);

const freeFormToolArgumentKeys = new Set([
  'query',
  'city',
  'district',
  'label',
  'line1',
]);

function normalizedCustomerToken(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsBoundedToken(text: string, token: string): boolean {
  const normalizedText = normalizedCustomerToken(text);
  const normalizedToken = normalizedCustomerToken(token);
  if (!normalizedToken) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escapedPattern(normalizedToken)}(?=$|[^\\p{L}\\p{N}_])`,
    'u',
  ).test(normalizedText);
}

function isStrongMachineToken(value: string): boolean {
  return (
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/u.test(value) ||
    /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/u.test(value) ||
    /^[a-z0-9]+(?::[a-z0-9._-]+)+$/u.test(value) ||
    /^value-\d+$/u.test(value)
  );
}

function collectToolArgumentTokens(
  value: unknown,
  tokens: Set<string>,
  key?: string,
): void {
  if (typeof value === 'string') {
    if (!key || !freeFormToolArgumentKeys.has(key)) {
      if (isStrongMachineToken(value)) tokens.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectToolArgumentTokens(entry, tokens, key);
    return;
  }
  if (!isRecord(value)) return;
  for (const [entryKey, entry] of Object.entries(value)) {
    if (isStrongMachineToken(entryKey)) tokens.add(entryKey);
    collectToolArgumentTokens(entry, tokens, entryKey);
  }
}

function containsCustomerResponseContractToken(input: {
  customerText: string;
  bundle: ModelPublicationBundle;
  currentUserMessage?: string;
  currentTurnToolTrace?: readonly ToolTraceEntry[];
}): boolean {
  const tokens = new Set(CUSTOMER_RESPONSE_CONTRACT_TOKENS);
  for (const evidence of input.bundle.evidence) {
    if (isStrongMachineToken(evidence.evidenceId)) {
      tokens.add(evidence.evidenceId);
    }
    tokens.add(evidence.publicationAuthority);
  }
  for (const trace of input.currentTurnToolTrace ?? []) {
    collectToolArgumentTokens(trace.arguments, tokens);
  }
  for (const token of tokens) {
    if (
      input.currentUserMessage &&
      containsBoundedToken(input.currentUserMessage, token)
    ) {
      continue;
    }
    if (containsBoundedToken(input.customerText, token)) return true;
  }
  const promptReferenceIds =
    normalizedCustomerToken(input.customerText).match(/value-\d+/gu) ?? [];
  return promptReferenceIds.some(
    (token) =>
      !input.currentUserMessage ||
      !containsBoundedToken(input.currentUserMessage, token),
  );
}

function evidenceContainsIncludedModifierOptionName(
  value: unknown,
  subject: string,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      evidenceContainsIncludedModifierOptionName(entry, subject),
    );
  }
  if (!isRecord(value)) return false;
  const record = value;
  if (
    typeof record.modifierId === 'string' &&
    typeof record.name === 'string' &&
    record.name === subject &&
    record.default === true
  ) {
    return true;
  }
  return Object.values(record).some((entry) =>
    evidenceContainsIncludedModifierOptionName(entry, subject),
  );
}

function evidenceContainsScopedSubject(
  value: unknown,
  subject: string,
  subjectScope: ResponseEvidenceSubjectScope,
): boolean {
  switch (subjectScope) {
    case 'included_modifier_option_name':
      return evidenceContainsIncludedModifierOptionName(value, subject);
  }
}

export function validateResponseFactualClaims(input: {
  raw: unknown;
  bundle: ModelPublicationBundle;
  customerText: string;
  currentUserMessage?: string;
}): ResponseFactualClaimsValidation {
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
    input.bundle.evidence.map((entry) => [entry.evidenceId, entry]),
  );
  const allowedEvidenceIds = new Set(input.bundle.allowedEvidenceIds);
  const requiredLimitations = new Set<ResponseEvidenceLimitationId>();
  const evidenceSubjectsByLimitation = new Map<
    ResponseEvidenceLimitationId,
    { value: unknown; subjectScope: ResponseEvidenceSubjectScope }[]
  >();
  for (const reference of parsed.data.evidenceReferences) {
    const evidence = evidenceById.get(reference.evidenceId);
    if (
      !evidence ||
      !allowedEvidenceIds.has(reference.evidenceId) ||
      reference.claimKinds.some((kind) => !evidence.claimKinds.includes(kind))
    ) {
      return { ok: false, errorCode: 'agent_response_evidence_mismatch' };
    }
    for (const requirement of evidence.requiredLimitations) {
      if (
        reference.claimKinds.some((claimKind) =>
          requirement.claimKinds.includes(claimKind),
        )
      ) {
        requiredLimitations.add(requirement.limitationId);
        const evidenceSubjects =
          evidenceSubjectsByLimitation.get(requirement.limitationId) ?? [];
        evidenceSubjects.push({
          value: evidence.value,
          subjectScope: requirement.subjectScope,
        });
        evidenceSubjectsByLimitation.set(
          requirement.limitationId,
          evidenceSubjects,
        );
      }
    }
    const governedClaim =
      reference.claimKinds.includes('policy') ||
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
  const disclosedLimitations = parsed.data.disclosedLimitations;
  const disclosedLimitationIds = disclosedLimitations.map(
    ({ limitationId }) => limitationId,
  );
  if (
    new Set(disclosedLimitationIds).size !== disclosedLimitationIds.length ||
    disclosedLimitationIds.length !== requiredLimitations.size ||
    disclosedLimitationIds.some(
      (limitationId) => !requiredLimitations.has(limitationId),
    ) ||
    disclosedLimitations.some(
      ({
        limitationId,
        evidenceSubject,
        customerCriterion,
        customerDisclosure,
      }) => {
        const evidenceSubjects =
          evidenceSubjectsByLimitation.get(limitationId) ?? [];
        return (
          !evidenceSubjects.some(({ value, subjectScope }) =>
            evidenceContainsScopedSubject(value, evidenceSubject, subjectScope),
          ) ||
          !input.currentUserMessage?.includes(customerCriterion) ||
          !customerDisclosure.includes(evidenceSubject) ||
          !input.customerText.includes(customerDisclosure)
        );
      },
    )
  ) {
    return {
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    };
  }
  return { ok: true, factualClaims: parsed.data };
}

export function validateGroundedResponse(input: {
  raw: unknown;
  bundle: ModelPublicationBundle;
  currentUserMessage?: string;
  currentTurnToolTrace?: readonly ToolTraceEntry[];
}): GroundedResponseValidation {
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
  if (
    containsCustomerResponseContractToken({
      customerText: parsed.data.customerText,
      bundle: input.bundle,
      currentUserMessage: input.currentUserMessage,
      currentTurnToolTrace: input.currentTurnToolTrace,
    })
  ) {
    return {
      ok: false,
      errorCode: 'agent_response_customer_language_invalid',
    };
  }
  const claims = validateResponseFactualClaims({
    raw: parsed.data.factualClaims,
    bundle: input.bundle,
    customerText: parsed.data.customerText,
    currentUserMessage: input.currentUserMessage,
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
