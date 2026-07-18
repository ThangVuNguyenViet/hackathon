import { z } from 'zod';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';
import {
  extractText,
  pendingDecisionSchema,
  plannerOutputSchema,
  presentedSavedAddressIndex,
  referencesCatalogName,
  type PendingDecision,
  type ResponsesBody,
} from './toolPlannerNormalization.js';
import type { ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';

interface ClassifierRequestContext {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}

export async function classifyUnresolvedCatalogReference(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata('planner reference classification', context.model, context.diagnosticContext);
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 24,
        text: {
          format: {
            type: 'json_schema',
            name: 'catalog_reference_resolution',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                resolution: { type: 'string', enum: ['unresolved_reference', 'other'] },
              },
              required: ['resolution'],
            },
          },
        },
        instructions: [
          'Classify only whether the latest customer request relies on an unresolved reference to a catalog item.',
          'Use unresolved_reference when it points generically to an item but the immediately preceding assistant turn presented multiple choices, only a generic clarification, or no single named candidate.',
          'Use other for an explicit named item, a resolved single candidate, or any non-referential request.',
          'Use meaning, never a fixed word list. Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: context.input.state.latestUserMessage,
          precedingAssistantTurn: [...(context.input.consentTurns ?? context.input.recentTurns)]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.text,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = z
      .object({
        resolution: z.enum(['unresolved_reference', 'other']),
      })
      .parse(JSON.parse(text ?? ''));
    return result.resolution === 'unresolved_reference';
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyActiveCartModifierChange(
  context: ClassifierRequestContext & {
    input: ToolPlannerInput;
    model: string;
    candidate: NonNullable<ToolPlannerInput['menuCatalogContext']>['candidates'][number];
  },
): Promise<{ confirmedChange: boolean; additionalRequest: 'none' | 'membership' | 'other' | 'unclear' } | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata(
      'planner active-cart modifier classification',
      context.model,
      context.diagnosticContext,
    );
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 24,
        text: {
          format: {
            type: 'json_schema',
            name: 'active_cart_modifier_change',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                operation: { type: 'string', enum: ['apply_change', 'information', 'other'] },
                subjectMatch: { type: 'string', enum: ['active_item', 'other', 'unknown'] },
                optionMatch: { type: 'string', enum: ['supplied_option', 'none', 'unknown'] },
                additionalRequest: { type: 'string', enum: ['none', 'membership', 'other', 'unclear'] },
              },
              required: ['operation', 'subjectMatch', 'optionMatch', 'additionalRequest'],
            },
          },
        },
        instructions: [
          'Classify three independent axes for the latest customer request.',
          'operation=apply_change for an instruction or affirmative request to apply a modifier; information for a question, comparison, or explanation; otherwise other.',
          'subjectMatch=active_item when the request targets the single active cart item or components inside it. The customer need not repeat the item name when the conversation presents only that active item.',
          'optionMatch=supplied_option when the request selects one of the supplied option names or aliases. A requested component quantity may describe components inside the active item rather than cart-item quantity.',
          'additionalRequest=membership when the latest request also asks for membership, loyalty, points, rewards, or wallet information; other for another additional request; unclear when uncertain; otherwise none.',
          'Use conversation meaning and the supplied catalog evidence, never a fixed word list.',
          'Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: context.input.state.latestUserMessage,
          precedingAssistantTurn: [...(context.input.consentTurns ?? context.input.recentTurns)]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.text,
          activeCartItem: {
            code: context.candidate.code,
            name: context.candidate.name,
            quantity: context.candidate.activeCartQuantity,
          },
          modifierOptions: context.candidate.modifierGroups.flatMap((group) =>
            group.options.map((option) => ({
              groupId: group.groupId,
              name: option.name,
              aliases: option.searchAliases ?? [],
            })),
          ),
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = z
      .object({
        operation: z.enum(['apply_change', 'information', 'other']),
        subjectMatch: z.enum(['active_item', 'other', 'unknown']),
        optionMatch: z.enum(['supplied_option', 'none', 'unknown']),
        additionalRequest: z.enum(['none', 'membership', 'other', 'unclear']),
      })
      .parse(JSON.parse(text ?? ''));
    return {
      confirmedChange:
        result.operation === 'apply_change' &&
        result.subjectMatch !== 'other' &&
        result.optionMatch === 'supplied_option',
      additionalRequest: result.additionalRequest,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function unresolvedPendingDecisions(
  input: ToolPlannerInput,
  parsed: z.infer<typeof plannerOutputSchema>,
): { catalogSuggestion: boolean; reorder: boolean } {
  return {
    catalogSuggestion: Boolean(
      input.state.pendingCatalogSuggestion &&
      parsed.pendingDecisions?.catalogSuggestion === undefined &&
      parsed.catalogSuggestion?.decision !== 'accept',
    ),
    reorder: Boolean(
      input.state.pendingReorder && parsed.pendingDecisions?.reorder === undefined && parsed.entities.reorderConfirmed !== true,
    ),
  };
}

export async function classifyPendingDecision(
  context: ClassifierRequestContext & {
    input: ToolPlannerInput;
    parsed: z.infer<typeof plannerOutputSchema>;
    model: string;
    independentlyClassified?: PendingDecision;
  },
): Promise<PendingDecision | undefined> {
  const { input, parsed, independentlyClassified } = context;
  const unresolved = unresolvedPendingDecisions(input, parsed);
  unresolved.catalogSuggestion = unresolved.catalogSuggestion && independentlyClassified?.catalogSuggestion === undefined;
  unresolved.reorder = unresolved.reorder && independentlyClassified?.reorder === undefined;
  const presentedAddressIndex = presentedSavedAddressIndex(input);
  const pendingSavedAddressIndex =
    presentedAddressIndex !== undefined &&
    parsed.savedAddressDecision?.addressIndex === presentedAddressIndex &&
    parsed.savedAddressDecision.decision === 'accept'
      ? undefined
      : presentedAddressIndex;
  const primaryAddressDraft =
    typeof parsed.entities.addressDraft === 'object' &&
    parsed.entities.addressDraft !== null &&
    !Array.isArray(parsed.entities.addressDraft)
      ? (parsed.entities.addressDraft as Record<string, unknown>)
      : undefined;
  const primaryHasCurrentTurnAddressEvidence = primaryAddressDraft
    ? Object.values(primaryAddressDraft).some(
        (value) => typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value),
      )
    : false;
  const assessSavedAddressSubject =
    pendingSavedAddressIndex === undefined &&
    !input.state.address &&
    !input.state.fulfillment &&
    !primaryHasCurrentTurnAddressEvidence &&
    (input.state.customerContext?.savedAddresses.length ?? 0) === 1 &&
    parsed.toolCalls.some((call) => call.toolName === 'updateCart') &&
    parsed.savedAddressDecision === undefined;
  const primaryFoodEvidence = pendingDecisionSchema.safeParse({
    foodContentEvidenceRequirement: parsed.foodContentEvidenceRequirement ?? parsed.entities.foodContentEvidenceRequirement,
  });
  const primaryFoodContentEvidenceRequirement = primaryFoodEvidence.success
    ? primaryFoodEvidence.data.foodContentEvidenceRequirement
    : undefined;
  const primaryResolvesFoodEvidence =
    primaryFoodContentEvidenceRequirement === 'not-required' ||
    (primaryFoodContentEvidenceRequirement === 'required' && parsed.intent === 'safety');
  const directResponseCanReachCustomer =
    parsed.entities.cartMutationRequested !== true &&
    parsed.toolCalls.every((call) =>
      ['searchMenu', 'searchPromotions', 'getItemDetails', 'getModifierOptions', 'listPaymentMethods'].includes(call.toolName),
    );
  const assessFoodContentEvidence =
    parsed.directResponse !== undefined &&
    directResponseCanReachCustomer &&
    !primaryResolvesFoodEvidence &&
    !parsed.toolCalls.some((call) => call.toolName === 'handoff') &&
    parsed.toolCalls.some((call) => call.toolName === 'getModifierOptions' || call.toolName === 'searchMenu') &&
    (input.availableTools.includes('searchContentPolicy') || input.availableTools.includes('answerAllergenQuestion'));
  if (
    !unresolved.catalogSuggestion &&
    !unresolved.reorder &&
    pendingSavedAddressIndex === undefined &&
    !assessSavedAddressSubject &&
    !assessFoodContentEvidence
  )
    return independentlyClassified;
  const precedingAssistantTurn = [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant');
  if (!precedingAssistantTurn && !assessSavedAddressSubject && !assessFoodContentEvidence) {
    return independentlyClassified;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const decisionValueSchema = {
      type: 'string',
      enum: ['accept', 'decline', 'defer', 'unrelated', 'unclear'],
    };
    const classificationProperties: Record<string, unknown> = {
      ...(unresolved.catalogSuggestion ? { catalogSuggestion: decisionValueSchema } : {}),
      ...(unresolved.reorder
        ? {
            reorderRelation: {
              type: 'string',
              enum: [
                'accept_copy',
                'redirect_to_favorite',
                'redirect_to_other',
                'defer',
                'unrelated',
                'unclear',
              ],
            },
          }
        : {}),
      ...(pendingSavedAddressIndex !== undefined ? { savedAddress: decisionValueSchema } : {}),
      ...(assessSavedAddressSubject
        ? {
            savedAddressSubjectMatch: {
              type: 'string',
              enum: ['target', 'alternate', 'unknown', 'not-applicable'],
            },
          }
        : {}),
      ...(assessFoodContentEvidence
        ? {
            foodContentEvidenceRequirement: {
              type: 'string',
              enum: ['required', 'not-required', 'unknown'],
            },
          }
        : {}),
    };
    const requestMetadata = createOpenAiRequestMetadata(
      'planner pending-decision classification',
      context.model,
      context.diagnosticContext,
    );
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 120,
        text: {
          format: {
            type: 'json_schema',
            name: 'pending_decision_classification',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: classificationProperties,
              required: Object.keys(classificationProperties),
            },
          },
        },
        instructions: [
          'Classify the latest customer turn against only the supplied pending actions.',
          'Return exactly one JSON object.',
          'catalogSuggestion and savedAddress values must be accept, decline, defer, unrelated, or unclear when those fields are required.',
          'savedAddressSubjectMatch must be target, alternate, unknown, or not-applicable.',
          'foodContentEvidenceRequirement must be required, not-required, or unknown.',
          'For a pending reorder, classify one mutually exclusive reorderRelation.',
          'Use accept_copy only when the latest turn accepts copying the supplied prior order.',
          'Use redirect_to_favorite when it requests the customer favorite or usual selection instead of that copy.',
          'The supplied customerFavorites collection is authoritative for the customer usual or favorite selection. A request for what the customer usually eats targets that collection and must be redirect_to_favorite, not redirect_to_other, defer, or unclear.',
          'Use redirect_to_other for another replacement item or shopping path; otherwise use defer, unrelated, or unclear.',
          'Return every field required by the supplied JSON schema and no others.',
          'Use conversation meaning and references, never a fixed word list.',
          'A mixed turn can accept a pending action while also asking another question.',
          'Judge only the latest customer turn. Earlier customer acceptance or rejection must never carry forward to this turn.',
          'Use the immediately preceding assistant turn only to resolve what the latest turn refers to.',
          'Acceptance requires the latest turn to endorse the exact pending action. A request for a different item or action instead is decline or unrelated, never accept.',
          'The reorder decision targets creation of a separate new order copied from the identified prior order; it does not target cancellation or mutation of any currently submitted order.',
          'When the customer affirmatively answers the assistant confirmation and also requires the currently submitted order to remain unchanged, use reorderRelation=accept_copy.',
          'Do not ask for or require a second confirmation after the customer has affirmatively answered the immediately preceding reorder confirmation.',
          'Semantic example: assistant asks whether to create a separate repeat order without changing the submitted order; customer agrees and restates that the submitted order must remain unchanged. Use reorderRelation=accept_copy.',
          'Semantic counterexample: customer says not now or asks to decide later. Use reorderRelation=defer.',
          'When the customer redirects from copying the pending prior order to a different selection source, item, or shopping path, use redirect_to_favorite or redirect_to_other even if the alternative may overlap with items in that order.',
          'Judge only the pending action and conversation; no other planner output is relevant.',
        ].join(' '),
        input: JSON.stringify({
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: precedingAssistantTurn
            ? { role: precedingAssistantTurn.role, text: precedingAssistantTurn.text }
            : undefined,
          pendingCatalogSuggestion: unresolved.catalogSuggestion ? input.state.pendingCatalogSuggestion : undefined,
          pendingReorder:
            unresolved.reorder && input.state.pendingReorder
              ? {
                  orderId: input.state.pendingReorder.orderId,
                  items: input.state.pendingReorder.cart.items.map(({ itemCode, name, quantity }) => ({
                    itemCode,
                    name,
                    quantity,
                  })),
                }
              : undefined,
          pendingSavedAddress:
            pendingSavedAddressIndex === undefined
              ? undefined
              : {
                  addressIndex: pendingSavedAddressIndex,
                  address: input.state.customerContext?.savedAddresses[pendingSavedAddressIndex],
                },
          savedAddressSubjectAssessment: assessSavedAddressSubject
            ? {
                candidates: input.state.customerContext?.savedAddresses.map((address, addressIndex) => ({
                  addressIndex,
                  address,
                })),
                rule: 'Classify target only when the latest turn semantically refers to the supplied saved-address subject. A newly typed or partial location is alternate, not target.',
              }
            : undefined,
          foodContentEvidenceAssessment: assessFoodContentEvidence
            ? {
                proposedTools: parsed.toolCalls.map((call) => call.toolName),
                proposedDirectResponse: parsed.directResponse,
                rule: 'Classify required when answering the latest question would assert that food contains or excludes an ingredient, allergen, or safety-sensitive property not authoritatively proved by a selectable modifier label. Otherwise classify not-required or unknown.',
              }
            : undefined,
          customerFavorites: input.state.customerContext?.favorites.map(({ code, name }) => ({
            code,
            name,
            sourceMeaning: 'customer usual or favorite selection',
          })),
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const rawClassification = text ? JSON.parse(text) as Record<string, unknown> : undefined;
    const reorderRelation = rawClassification?.reorderRelation;
    const normalizedReorderRelation =
      reorderRelation === 'accept_copy'
        ? { reorder: 'accept' as const, selectionSource: 'recent_order' as const }
        : reorderRelation === 'redirect_to_favorite'
          ? { reorder: 'decline' as const, selectionSource: 'favorite' as const }
          : reorderRelation === 'redirect_to_other'
            ? { reorder: 'decline' as const, selectionSource: 'other' as const }
            : reorderRelation === 'defer' || reorderRelation === 'unrelated' || reorderRelation === 'unclear'
              ? { reorder: reorderRelation, selectionSource: 'unknown' as const }
              : {};
    const classified = rawClassification
      ? pendingDecisionSchema.parse({ ...rawClassification, ...normalizedReorderRelation })
      : undefined;
    return classified ? { ...independentlyClassified, ...classified } : independentlyClassified;
  } catch {
    return independentlyClassified;
  } finally {
    clearTimeout(timeout);
  }
}

const fastSubmittedOrderDecisionSchema = z.object({
  decision: z.enum([
    'order_status',
    'cancellation_status',
    'payment_status',
    'human_support',
    'order_status_handoff',
    'submitted_order_edit_policy',
    'abnormal_large_order_handoff',
    'handoff_explanation',
    'reorder_confirmation',
    'full_planning',
  ]),
  cancellationRequested: z.boolean(),
  abnormalLargeOrderRequested: z.boolean(),
  separateReorderRequested: z.boolean().optional(),
  reason: z.string().trim().min(1).optional(),
});
const fastSubmittedOrderFlagsSchema = z.object({
  cancellationRequested: z.boolean(),
  abnormalLargeOrderRequested: z.boolean(),
  separateReorderRequested: z.boolean().optional(),
});
const compactSubmittedOrderDecisionSchema = z.object({
  d: fastSubmittedOrderDecisionSchema.shape.decision,
  s: z.enum(['submitted_order', 'prior_order_copy', 'other']),
  o: z.enum(['status', 'edit', 'cancel', 'reorder', 'payment', 'support', 'explanation', 'other']),
});
const compactSubmittedOrderResponseFormat = {
  type: 'json_schema',
  name: 'submitted_order_decision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      d: { type: 'string', enum: fastSubmittedOrderDecisionSchema.shape.decision.options },
      s: { type: 'string', enum: ['submitted_order', 'prior_order_copy', 'other'] },
      o: {
        type: 'string',
        enum: ['status', 'edit', 'cancel', 'reorder', 'payment', 'support', 'explanation', 'other'],
      },
    },
    required: ['d', 's', 'o'],
  },
} as const;

function normalizeSubmittedOrderDecision(raw: unknown): z.infer<typeof fastSubmittedOrderDecisionSchema> {
  const compact = compactSubmittedOrderDecisionSchema.safeParse(raw);
  if (compact.success) {
    return {
      decision:
        compact.data.o === 'explanation'
          ? 'handoff_explanation'
          : compact.data.s === 'submitted_order' && compact.data.o === 'edit'
            ? 'submitted_order_edit_policy'
            : compact.data.d,
      cancellationRequested: compact.data.s === 'submitted_order' && compact.data.o === 'cancel',
      abnormalLargeOrderRequested: compact.data.d === 'abnormal_large_order_handoff',
      separateReorderRequested: compact.data.s === 'prior_order_copy' && compact.data.o === 'reorder',
    };
  }
  return fastSubmittedOrderDecisionSchema.parse(raw);
}

function normalizeSubmittedOrderFlags(raw: unknown): z.infer<typeof fastSubmittedOrderFlagsSchema> {
  const compact = compactSubmittedOrderDecisionSchema.safeParse(raw);
  return compact.success
    ? {
        cancellationRequested: compact.data.s === 'submitted_order' && compact.data.o === 'cancel',
        abnormalLargeOrderRequested: compact.data.d === 'abnormal_large_order_handoff',
        separateReorderRequested: compact.data.s === 'prior_order_copy' && compact.data.o === 'reorder',
      }
    : fastSubmittedOrderFlagsSchema.parse(raw);
}

export async function fetchPlannerResponse(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export async function classifySubmittedOrderRequest(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | undefined> {
  const { input } = context;
  if (!input.state.order) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata('tool planning', context.model, context.diagnosticContext);
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 48,
        text: { format: compactSubmittedOrderResponseFormat },
        instructions: [
          'Semantically classify only the latest request; earlier order or payment issues must not override it. Use meaning, never a fixed word list.',
          'Return exactly one compact JSON object with required d,s,o. d is the decision; s is submitted_order, prior_order_copy, or other; o is status, edit, cancel, reorder, payment, support, explanation, or other.',
          'Allowed decisions: order_status, cancellation_status, payment_status, human_support, order_status_handoff, submitted_order_edit_policy, abnormal_large_order_handoff, handoff_explanation, reorder_confirmation, full_planning.',
          'Use s=submitted_order and o=cancel exactly for a request to cancel the submitted order. Use cancellation_status for its first status check; use order_status_handoff only for continued cancellation when cancellationStatusChecked is true.',
          'Use abnormal_large_order_handoff for at least 100 requested items or packs, regardless of older order context.',
          'Use s=prior_order_copy and o=reorder exactly when the customer asks to create a distinct new order copied from a prior order; keeping the submitted order unchanged or correcting a cancellation discussion does not make this an order-status request.',
          'Use order_status for progress or ETA reads. Use payment_status for payment-state reads or reported failures, including repeated failures.',
          'Payment creation, retry, or method change is full_planning. Use submitted_order_edit_policy for a non-mutating answer about changing submitted-order items.',
          'Use s=submitted_order and o=edit for adding, removing, or changing items on an already submitted order; this is submitted_order_edit_policy, never order_status.',
          'Use o=explanation when the latest request asks why an active handoff is required.',
          'Use human_support only for a person or active transfer. Use reorder_confirmation for an unconfirmed separate copy of a prior order, including when the customer corrects a preceding cancellation discussion by keeping the submitted order unchanged.',
          'Use handoff_explanation with no new tool when the latest request asks why an already active handoff is required; older payment or order issues must not override that explanation.',
          'Use full_planning for confirmed reorder mutation, ordinary cart, address, fulfillment, other payment mutation, ambiguity, or anything else.',
        ].join(' '),
        input: JSON.stringify({
          locale: 'vi-VN',
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text,
          verifiedOrderState: {
            status: input.state.order.status,
            paymentStatus: input.state.order.paymentStatus,
          },
          verifiedPaymentStatus: input.state.paymentAttempt?.status,
          cancellationStatusChecked: input.state.cancellationStatusChecked === true,
          activeHandoffReasons: input.state.handoff?.reasons,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    if (!text) return undefined;
    const rawDecision: unknown = JSON.parse(text);
    const semanticFlags = normalizeSubmittedOrderFlags(rawDecision);
    if (semanticFlags.abnormalLargeOrderRequested && input.availableTools.includes('handoff')) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { abnormalLargeOrder: true },
        toolCalls: [
          {
            toolName: 'handoff',
            arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
          },
        ],
        responseClaims: [],
      };
    }
    if (semanticFlags.separateReorderRequested && !input.state.pendingReorder) {
      return {
        intent: 'ordering',
        contextPolicy: { recentOrder: 'confirm_before_use' },
        entities: { asksClarification: true, reorderConfirmationRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    if (
      semanticFlags.cancellationRequested &&
      input.state.cancellationStatusChecked === true &&
      input.availableTools.includes('getOrderStatus') &&
      input.availableTools.includes('handoff')
    ) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { humanSupportRequested: true },
        toolCalls: [
          { toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } },
          { toolName: 'handoff', arguments: { reasons: ['submitted_order_cancellation'] } },
        ],
        responseClaims: [],
      };
    }
    if (semanticFlags.cancellationRequested && input.availableTools.includes('getOrderStatus')) {
      return {
        intent: 'order_status',
        entities: { cancellationStatusChecked: true },
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    const decision = normalizeSubmittedOrderDecision(rawDecision);
    const compactDecision = compactSubmittedOrderDecisionSchema.safeParse(rawDecision);
    const typedActiveHandoffExplanation = Boolean(
      input.state.handoff &&
      (decision.decision === 'handoff_explanation' ||
        (compactDecision.success &&
          (compactDecision.data.o === 'explanation' ||
            (decision.decision === 'order_status' &&
              compactDecision.data.s === 'other' &&
              compactDecision.data.o === 'other' &&
              input.state.handoff !== undefined)))),
    );
    if (typedActiveHandoffExplanation) {
      return {
        intent: 'handoff',
        entities: { handoffExplanationRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    if (decision.decision === 'abnormal_large_order_handoff' && input.availableTools.includes('handoff')) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { abnormalLargeOrder: true },
        toolCalls: [
          {
            toolName: 'handoff',
            arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
          },
        ],
        responseClaims: [],
      };
    }
    if (decision.decision === 'order_status' && input.availableTools.includes('getOrderStatus')) {
      return {
        intent: 'order_status',
        entities: {},
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (decision.decision === 'cancellation_status' && input.availableTools.includes('getOrderStatus')) {
      return {
        intent: 'order_status',
        entities: { cancellationStatusChecked: true },
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (decision.decision === 'payment_status' && input.availableTools.includes('checkPaymentStatus')) {
      return {
        intent: 'payment',
        entities: {},
        toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (decision.decision === 'human_support' && input.availableTools.includes('handoff')) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { humanSupportRequested: true },
        toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['human_support_requested'] } }],
        responseClaims: [],
      };
    }
    if (
      decision.decision === 'order_status_handoff' &&
      input.availableTools.includes('getOrderStatus') &&
      input.availableTools.includes('handoff')
    ) {
      if (input.state.cancellationStatusChecked !== true) return undefined;
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { humanSupportRequested: true },
        toolCalls: [
          { toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } },
          { toolName: 'handoff', arguments: { reasons: ['submitted_order_cancellation'] } },
        ],
        responseClaims: [],
      };
    }
    if (decision.decision === 'submitted_order_edit_policy') {
      return {
        intent: 'order_status',
        entities: { submittedOrderEditPolicyRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    if (decision.decision === 'reorder_confirmation' && !input.state.pendingReorder) {
      return {
        intent: 'ordering',
        contextPolicy: { recentOrder: 'confirm_before_use' },
        entities: { asksClarification: true, reorderConfirmationRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifySubmittedOrderRead(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | 'requires_full_planning'> {
  const { input } = context;
  if (!input.state.order) return 'requires_full_planning';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata('tool planning', context.model, context.diagnosticContext);
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 24,
        text: {
          format: {
            type: 'json_schema',
            name: 'submitted_order_read',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                read: { type: 'string', enum: ['order_status', 'payment_status', 'other'] },
                operation: {
                  type: 'string',
                  enum: ['read', 'edit', 'cancel', 'reorder', 'support', 'other'],
                },
                subject: {
                  type: 'string',
                  enum: ['submitted_order', 'payment', 'prior_order', 'other'],
                },
                mutationRequested: { type: 'boolean' },
              },
              required: ['read', 'operation', 'subject', 'mutationRequested'],
            },
          },
        },
        instructions: [
          'Classify three independent axes for the latest request: read type, operation, and subject.',
          'Use order_status for progress, delivery status, or ETA reads.',
          'Use payment_status for payment-state reads or a reported payment failure.',
          'operation=read only for a read-only question. Use edit, cancel, reorder, or support whenever that action is requested.',
          'subject=submitted_order for the already submitted order, payment for its payment, prior_order for a previous order, otherwise other.',
          'mutationRequested=false for status reads and reported failures that only require checking status. It is true for retrying, creating, changing, editing, cancelling, or reordering.',
          'Cancellation, editing, reordering, support, explanation, cart, address, fulfillment, ordering, and payment mutation use read=other.',
          'Use meaning, never a fixed word list. Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: input.state.latestUserMessage,
          verifiedOrderStatus: input.state.order.status,
          verifiedPaymentStatus: input.state.paymentAttempt?.status ?? input.state.order.paymentStatus,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = z
      .object({
        read: z.enum(['order_status', 'payment_status', 'other']),
        operation: z.enum(['read', 'edit', 'cancel', 'reorder', 'support', 'other']),
        subject: z.enum(['submitted_order', 'payment', 'prior_order', 'other']),
        mutationRequested: z.boolean(),
      })
      .parse(JSON.parse(text ?? ''));
    if (
      result.operation === 'cancel' &&
      result.subject === 'submitted_order' &&
      input.state.cancellationStatusChecked === true &&
      input.availableTools.includes('getOrderStatus') &&
      input.availableTools.includes('handoff')
    ) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { humanSupportRequested: true },
        toolCalls: [
          { toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } },
          { toolName: 'handoff', arguments: { reasons: ['submitted_order_cancellation'] } },
        ],
        responseClaims: [],
      };
    }
    if (result.operation === 'cancel' && result.subject === 'submitted_order' && input.availableTools.includes('getOrderStatus')) {
      return {
        intent: 'order_status',
        entities: { cancellationStatusChecked: true },
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (
      result.read === 'order_status' &&
      result.operation === 'read' &&
      result.subject === 'submitted_order' &&
      result.mutationRequested === false &&
      input.availableTools.includes('getOrderStatus')
    ) {
      return {
        intent: 'order_status',
        entities: {},
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (
      result.read === 'payment_status' &&
      result.operation === 'read' &&
      result.subject === 'payment' &&
      result.mutationRequested === false &&
      input.availableTools.includes('checkPaymentStatus')
    ) {
      return {
        intent: 'payment',
        entities: {},
        toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    return 'requires_full_planning';
  } catch {
    return 'requires_full_planning';
  } finally {
    clearTimeout(timeout);
  }
}
