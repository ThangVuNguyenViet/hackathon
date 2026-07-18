import { z } from 'zod';
import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';
import {
  extractText,
  plannerOutputSchema,
  referencesCatalogName,
  savedAddressReferenceSchema,
  type ResponsesBody,
} from './toolPlannerNormalization.js';
import type { ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';
import { classifySubmittedOrderRead, classifySubmittedOrderRequest, fetchPlannerResponse } from './toolPlannerClassifiers.js';

interface ClassifierRequestContext {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}

export async function classifyAddressChangeRequest(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<'change' | 'no_change' | 'unknown'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata(
      'planner address-change classification',
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
        max_output_tokens: 16,
        text: {
          format: {
            type: 'json_schema',
            name: 'address_change_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                decision: { type: 'string', enum: ['change', 'no_change', 'unknown'] },
              },
              required: ['decision'],
            },
          },
        },
        instructions: [
          'Classify whether the latest customer turn requests changing the delivery address or delivery location.',
          'Use change for a request to replace, update, or move the delivery destination, even when the new address is incomplete.',
          'Use no_change for delivery notes, access instructions, confirmation of the current address, or unrelated requests.',
          'Use unknown only when the meaning is genuinely ambiguous. Use meaning, never a fixed word list.',
          'Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: context.input.state.latestUserMessage,
          currentAddress: context.input.state.address,
          precedingAssistantTurn: [...(context.input.consentTurns ?? context.input.recentTurns)]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.text,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    return z.object({
      decision: z.enum(['change', 'no_change', 'unknown']),
    }).parse(JSON.parse(text ?? '')).decision;
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

const fastCatalogEvidenceDecisionSchema = z.object({
  decision: z.enum([
    'food_content_evidence',
    'customer_feedback',
    'human_support',
    'privacy_safe_response',
    'safe_read_only_discovery',
    'full_planning',
  ]),
  discoveryTool: z.enum(['searchMenu', 'searchPromotions', 'listPaymentMethods', 'searchContentPolicy']).nullable().optional(),
  query: z.string().trim().nullable().optional(),
  commerceMutationRequested: z.boolean().optional(),
  foodContentEvidenceRequirement: z.enum(['required', 'not-required', 'unknown']).optional(),
});

const fastCatalogEvidenceResponseFormat = {
  type: 'json_schema',
  name: 'fast_catalog_evidence_decision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: {
        type: 'string',
        enum: [
          'food_content_evidence',
          'customer_feedback',
          'human_support',
          'privacy_safe_response',
          'safe_read_only_discovery',
          'full_planning',
        ],
      },
      discoveryTool: {
        type: ['string', 'null'],
        enum: ['searchMenu', 'searchPromotions', 'listPaymentMethods', 'searchContentPolicy', null],
      },
      query: { type: ['string', 'null'] },
      commerceMutationRequested: { type: 'boolean' },
      foodContentEvidenceRequirement: {
        type: 'string',
        enum: ['required', 'not-required', 'unknown'],
      },
    },
    required: ['decision', 'discoveryTool', 'query', 'commerceMutationRequested', 'foodContentEvidenceRequirement'],
  },
} as const;

export async function classifySavedAddressReference(
  context: ClassifierRequestContext & {
    input: ToolPlannerInput;
    parsed: z.infer<typeof plannerOutputSchema>;
    model: string;
  },
): Promise<number | undefined> {
  const { input, parsed } = context;
  const savedAddresses = input.state.customerContext?.savedAddresses ?? [];
  if (
    savedAddresses.length === 0 ||
    input.state.address ||
    parsed.savedAddressDecision ||
    parsed.entities.addressChangeRequested === true ||
    !parsed.toolCalls.some((call) => call.toolName === 'updateCart')
  )
    return undefined;

  const proposedDraft =
    typeof parsed.entities.addressDraft === 'object' &&
    parsed.entities.addressDraft !== null &&
    !Array.isArray(parsed.entities.addressDraft)
      ? (parsed.entities.addressDraft as Record<string, unknown>)
      : undefined;
  const hasCurrentTurnAddressEvidence = proposedDraft
    ? Object.values(proposedDraft).some((value) => typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value))
    : false;
  if (hasCurrentTurnAddressEvidence) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata('planner saved-address classification', context.model, context.diagnosticContext);
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 48,
        text: { format: { type: 'json_object' } },
        instructions: [
          'Classify whether the latest customer turn semantically refers to exactly one supplied saved-address candidate.',
          'Return exactly one JSON object with decision=saved_address, not_saved_address, or unclear.',
          'For saved_address, include the matching numeric addressIndex. For either other decision, omit addressIndex.',
          'Use conversation meaning, never a fixed phrase or word list.',
          'Do not select a saved address merely because another typed or carried address is incomplete.',
          'Do not treat item selection, delivery intent, or generic continuation as saved-address evidence.',
        ].join(' '),
        input: JSON.stringify({
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text,
          carriedPartialAddressDraft: input.state.addressDraft,
          savedAddresses: savedAddresses.map((address, addressIndex) => ({ addressIndex, address })),
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = text ? savedAddressReferenceSchema.parse(JSON.parse(text)) : undefined;
    return result?.decision === 'saved_address' &&
      result.addressIndex !== undefined &&
      result.addressIndex !== null &&
      savedAddresses[result.addressIndex]
      ? result.addressIndex
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyActiveHandoffFollowup(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | 'requires_full_planning'> {
  const { input } = context;
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
        max_output_tokens: 32,
        text: {
          format: {
            type: 'json_schema',
            name: 'active_handoff_followup',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                relationship: { type: 'string', enum: ['explanation', 'new_request'] },
              },
              required: ['relationship'],
            },
          },
        },
        instructions: [
          'Classify only the latest customer request against the already active handoff.',
          'Use explanation only when the customer asks why the handoff is needed or asks to explain its reason.',
          'Vietnamese semantic example: assistant says a large order must be transferred to staff, then customer asks why it must be transferred; classify explanation.',
          'Use new_request for status, cancellation, payment, ordering, edits, support escalation, or any other request.',
          'Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text,
          activeHandoffReasons: input.state.handoff?.reasons,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = z
      .object({
        relationship: z.enum(['explanation', 'new_request']),
      })
      .parse(JSON.parse(text ?? ''));
    if (result.relationship !== 'explanation') return 'requires_full_planning';
    return {
      intent: 'handoff',
      contextPolicy: { handoff: 'active' },
      entities: { handoffExplanationRequested: true },
      toolCalls: [],
      responseClaims: [],
    };
  } catch {
    return 'requires_full_planning';
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyActiveCheckoutAvailabilityContinuation(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | 'requires_full_planning'> {
  const { input } = context;
  const fulfillment = input.state.fulfillment;
  const itemCodes = [...new Set(input.state.cart?.items.map((item) => item.itemCode) ?? [])];
  if (
    input.planningProfile !== 'active_checkout' ||
    !fulfillment ||
    fulfillment.availability.ok !== true ||
    itemCodes.length === 0 ||
    !input.availableTools.includes('checkStoreAvailability')
  ) return 'requires_full_planning';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata(
      'planner active-checkout read classification',
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
        max_output_tokens: 32,
        text: {
          format: {
            type: 'json_schema',
            name: 'active_checkout_read_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fulfillmentContinuation: { type: 'string', enum: ['accepts_current', 'not_accepting', 'unclear'] },
                checkoutOperation: { type: 'string', enum: ['read_only_recheck', 'mutation_or_confirmation', 'other', 'unclear'] },
                additionalRequest: { type: 'string', enum: ['none', 'invoice', 'payment', 'cart', 'address', 'other', 'unclear'] },
              },
              required: ['fulfillmentContinuation', 'checkoutOperation', 'additionalRequest'],
            },
          },
        },
        instructions: [
          'Classify only the latest customer request in the active checkout.',
          'Set fulfillmentContinuation=accepts_current only when the customer semantically accepts the current fulfillment timing or choice described by the preceding assistant.',
          'Set checkoutOperation=read_only_recheck only when the entire latest request needs only an availability recheck. Order confirmation or any mutation is mutation_or_confirmation.',
          'Set additionalRequest to invoice, payment, cart, address, other, or unclear when any such request or supplied data is also present; use none only when there is no additional request.',
          'Use conversation meaning, never a fixed phrase or word list. Return only the required JSON.',
        ].join(' '),
        input: JSON.stringify({
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text,
          fulfillment: {
            method: fulfillment.method,
            disposition: fulfillment.disposition,
            storeId: fulfillment.storeId,
            etaMinutes: fulfillment.etaMinutes,
          },
          cartItemCodes: itemCodes,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = z
      .object({
        fulfillmentContinuation: z.enum(['accepts_current', 'not_accepting', 'unclear']),
        checkoutOperation: z.enum(['read_only_recheck', 'mutation_or_confirmation', 'other', 'unclear']),
        additionalRequest: z.enum(['none', 'invoice', 'payment', 'cart', 'address', 'other', 'unclear']),
      })
      .parse(JSON.parse(text ?? ''));
    if (
      result.fulfillmentContinuation !== 'accepts_current' ||
      result.checkoutOperation !== 'read_only_recheck' ||
      result.additionalRequest !== 'none'
    ) return 'requires_full_planning';
    return {
      intent: 'ordering',
      contextPolicy: { cart: 'active', fulfillment: 'active' },
      entities: {},
      toolCalls: [{
        toolName: 'checkStoreAvailability',
        arguments: {
          storeId: fulfillment.storeId,
          itemCodes,
          disposition: fulfillment.disposition,
        },
      }],
      responseClaims: [],
    };
  } catch {
    return 'requires_full_planning';
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyCatalogEvidenceRequest(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | 'requires_full_planning' | undefined> {
  const { input } = context;
  if (input.state.order || input.state.pendingReorder || input.planningProfile === 'active_checkout' || input.priorPlanForReview)
    return undefined;
  const candidate = input.menuCatalogContext?.candidates.find((entry) => entry.activeCartItem) ?? input.menuCatalogContext?.candidates[0];
  const catalogQueryVocabulary = [
    ...new Set(
      (input.menuCatalogContext?.candidates ?? [])
        .flatMap((entry) => [entry.category, entry.name])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  ];
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
        max_output_tokens: 96,
        text: { format: fastCatalogEvidenceResponseFormat },
        instructions: [
          'Semantically classify the latest catalog request.',
          'Return exactly one JSON object with decision=food_content_evidence, customer_feedback, human_support, privacy_safe_response, safe_read_only_discovery, or full_planning, plus commerceMutationRequested and foodContentEvidenceRequirement. Every field is required.',
          'foodContentEvidenceRequirement must be required, not-required, or unknown. Use required whenever answering the latest request would assert that food contains or excludes an ingredient, allergen, spice level, cheese, or another food-content property. Use not-required only when no such claim is requested; use unknown when uncertain.',
          'For safe_read_only_discovery, commerceMutationRequested must be false because the entire latest request is non-mutating. Also return discoveryTool=searchMenu, searchPromotions, listPaymentMethods, or searchContentPolicy. Include a concise semantic query for searchMenu or searchContentPolicy; a query is optional for searchPromotions and forbidden for listPaymentMethods.',
          'A discovery query must be a short one-to-three-word catalog noun phrase, not the customer sentence. Omit budget, party size, conversational wording, and actions from the query.',
          'The catalog and customer locale is vi-VN. Return the query in natural Vietnamese using terminology likely to occur in the supplied catalog evidence; do not translate it to English.',
          'For searchMenu, query must copy exactly one value from catalogQueryVocabulary. Choose the supplied category or item name that best represents the requested read-only discovery.',
          'If any part of the latest turn asks to add, remove, replace, customize, or quantify items for an order, set commerceMutationRequested=true and use full_planning. A read-only question combined with ordering is full_planning.',
          'Use food_content_evidence only for a read-only question about ingredients, allergens, spiciness, cheese, or another food-content property.',
          'Use customer_feedback only for a complaint, frustration, praise, or correction that needs acknowledgement but no commerce mutation or human transfer.',
          'When a customer declines an optional suggestion and asks a new information lookup in the same turn, classify the requested lookup; the decline is not customer_feedback.',
          'Use human_support only when the latest turn explicitly requests a person or staff support.',
          'Use privacy_safe_response only for a request for private employee contact details that does not also request support.',
          'Use safe_read_only_discovery for a non-mutating menu, price, promotion, payment-method, policy, privacy, terms, data-handling, delivery-rule, order-support, contact-information, or other information lookup that still needs the read-only planner. Use discoveryTool=searchContentPolicy with a concise semantic query for those official-information lookups.',
          'A recommendation request that only needs to present menu options is safe_read_only_discovery. It is not catalog selection unless the customer asks to choose, add, replace, customize, or otherwise mutate an order.',
          'Example: recommending options for a group within a budget is safe_read_only_discovery with commerceMutationRequested=false, discoveryTool=searchMenu, and query="combo nhóm".',
          'Loaded verifiedCandidate evidence does not mean the customer selected it.',
          'Use full_planning for customer-directed selection, cart mutation, confirmation, address, fulfillment, ordering, payment mutation, or unresolved ambiguity.',
          'Use conversation meaning, never a fixed phrase or word list.',
        ].join(' '),
        input: JSON.stringify({
          locale: 'vi-VN',
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text,
          verifiedCandidate: candidate
            ? {
                code: candidate.code,
                name: candidate.name,
                activeCartItem: candidate.activeCartItem === true,
                modifierOptionNames: candidate.modifierGroups.flatMap((group) => group.options.map((option) => option.name)),
              }
            : undefined,
          catalogQueryVocabulary,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    if (!text) return undefined;
    const decision = fastCatalogEvidenceDecisionSchema.parse(JSON.parse(text));
    if (decision.decision === 'human_support' && input.availableTools.includes('handoff')) {
      return {
        intent: 'handoff',
        entities: { humanSupportRequested: true },
        toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['human_support_requested'] } }],
        responseClaims: [],
      };
    }
    if (decision.decision === 'customer_feedback') {
      return {
        intent: 'complaint',
        entities: { cartMutationRequested: false, customerFeedbackAcknowledgementRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    if (decision.decision === 'privacy_safe_response') {
      return {
        intent: 'safety',
        entities: { privacySafeResponse: true, officialSupportAlternativeRequested: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    if (decision.decision === 'full_planning') return 'requires_full_planning';
    if (decision.decision === 'safe_read_only_discovery') {
      if (decision.foodContentEvidenceRequirement !== 'not-required') return 'requires_full_planning';
      if (decision.commerceMutationRequested !== false) return 'requires_full_planning';
      if ((input.menuCatalogContext?.requestedQuantityPlans?.length ?? 0) > 0) return 'requires_full_planning';
      const toolName = decision.discoveryTool;
      if (!toolName || !input.availableTools.includes(toolName)) return 'requires_full_planning';
      if ((toolName === 'searchMenu' || toolName === 'searchContentPolicy') && !decision.query) {
        return 'requires_full_planning';
      }
      if (
        toolName === 'searchMenu' &&
        !catalogQueryVocabulary.some((value) => normalizeSearchText(value) === normalizeSearchText(decision.query ?? ''))
      )
        return 'requires_full_planning';
      return {
        intent: toolName === 'searchPromotions' ? 'voucher' : toolName === 'listPaymentMethods' ? 'payment' : 'ordering',
        entities: { cartMutationRequested: false },
        toolCalls: [
          {
            toolName,
            arguments: toolName === 'listPaymentMethods'
              ? {}
              : toolName === 'searchContentPolicy'
                ? { kind: 'policy', query: decision.query ?? '' }
                : { query: toolName === 'searchPromotions' ? '' : (decision.query ?? '') },
          },
        ],
        responseClaims: [],
      };
    }
    if (decision.decision !== 'food_content_evidence') return undefined;
    return candidate?.activeCartItem === true && input.availableTools.includes('getModifierOptions')
      ? {
          intent: 'safety',
          entities: {
            cartMutationRequested: false,
            foodContentEvidenceRequirement: 'required',
          },
          toolCalls: [{ toolName: 'getModifierOptions', arguments: { code: candidate.code } }],
          responseClaims: [],
        }
      : 'requires_full_planning';
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function tryFastInitialPlan(
  context: ClassifierRequestContext & {
    input: ToolPlannerInput;
    fastModel?: string;
    statusModel?: string;
    fullModel: string;
  },
): Promise<ToolPlannerOutput | 'requires_full_planning' | undefined> {
  const fastModel = context.fastModel?.trim();
  if (!fastModel || fastModel === context.fullModel || context.input.priorPlanForReview) return undefined;
  try {
    if ((context.input.menuCatalogContext?.requestedQuantityPlans?.length ?? 0) > 0) return 'requires_full_planning';
    if (context.input.state.pendingReorder) return 'requires_full_planning';
    if (!context.input.state.order && context.input.state.cart) return 'requires_full_planning';
    if (
      context.input.planningProfile === 'catalog_ordering' &&
      (context.input.contextInventory?.customer.savedAddressCount ?? context.input.state.customerContext?.savedAddresses.length ?? 0) > 0
    )
      return 'requires_full_planning';
    if (context.input.planningProfile === 'full' && context.input.state.order) {
      if (context.input.state.handoff) return undefined;
      const statusModel = context.statusModel?.trim();
      if (statusModel && statusModel !== context.fullModel) {
        const readPlan = await classifySubmittedOrderRead({ ...context, model: statusModel });
        if (readPlan !== 'requires_full_planning') return readPlan;
      }
      const submittedOrder = await classifySubmittedOrderRequest({ ...context, model: fastModel });
      return submittedOrder ?? 'requires_full_planning';
    }
    const catalogCandidates = context.input.menuCatalogContext?.candidates ?? [];
    if (
      context.input.planningProfile === 'full' &&
      catalogCandidates.length > 0 &&
      !catalogCandidates.some((candidate) => candidate.activeCartItem === true)
    )
      return 'requires_full_planning';
    return classifyCatalogEvidenceRequest({ ...context, model: fastModel });
  } catch {
    return context.input.planningProfile === 'full' ? 'requires_full_planning' : undefined;
  }
}

export async function tryFastReadOnlyReview(input: {
  plannerInput: ToolPlannerInput;
  fastModel?: string;
  fullModel: string;
  planWithModel: (model: string) => Promise<ToolPlannerOutput>;
}): Promise<ToolPlannerOutput | undefined> {
  const { plannerInput, fastModel } = input;
  const initialReadOnlyCandidate =
    !plannerInput.priorPlanForReview &&
    plannerInput.planningProfile === 'full' &&
    !plannerInput.state.order &&
    !plannerInput.state.pendingReorder;
  const readOnlyReviewCandidate = Boolean(
    plannerInput.priorPlanForReview &&
    plannerInput.priorPlanForReview.toolCalls.length === 0 &&
    (plannerInput.priorPlanForReview.catalogSelections?.length ?? 0) === 0 &&
    plannerInput.priorPlanForReview.entities.cartMutationRequested !== true,
  );
  if (
    !fastModel ||
    fastModel === input.fullModel ||
    plannerInput.planningProfile === 'active_checkout' ||
    (!initialReadOnlyCandidate && !readOnlyReviewCandidate)
  )
    return undefined;
  try {
    const reviewed = await input.planWithModel(fastModel);
    const allowedReadTools = new Set([
      'searchMenu',
      'searchPromotions',
      'getItemDetails',
      'getModifierOptions',
      'listPaymentMethods',
      'searchContentPolicy',
      'answerAllergenQuestion',
      'handoff',
    ]);
    const normalizedReviewed =
      reviewed.intent === 'handoff' &&
      plannerInput.availableTools.includes('handoff') &&
      !reviewed.toolCalls.some((call) => call.toolName === 'handoff')
        ? {
            ...reviewed,
            entities: {
              humanSupportRequested: true,
              cartMutationRequested: false,
            },
            toolCalls: [{ toolName: 'handoff' as const, arguments: { reasons: ['human_support_requested'] } }],
          }
        : reviewed;
    return normalizedReviewed.entities.cartMutationRequested !== true &&
      normalizedReviewed.entities.cartMutationConfirmed !== true &&
      normalizedReviewed.entities.addressChangeRequested !== true &&
      normalizedReviewed.entities.fulfillmentAccepted !== true &&
      normalizedReviewed.entities.orderConfirmed !== true &&
      normalizedReviewed.entities.reorderConfirmed !== true &&
      normalizedReviewed.entities.addressDraft === undefined &&
      (normalizedReviewed.catalogSelections?.length ?? 0) === 0 &&
      normalizedReviewed.toolCalls.every((call) => allowedReadTools.has(call.toolName))
      ? normalizedReviewed
      : undefined;
  } catch {
    return undefined;
  }
}
