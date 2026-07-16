import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ContextPolicyDirective } from '../graph/contextPolicy.js';
import { toolNames } from '../ordering/toolCatalog.js';
import type { FulfillmentPlanningContext, MenuPlanningContext, ToolCallRequest, ToolName } from '../ordering/types.js';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';
import {
  extractText,
  normalizeCatalogSelectionCalls,
  normalizeCatalogSuggestion,
  normalizePlannerEntities,
  normalizePlannerOutputEnvelope,
  normalizeSavedAddressDecision,
  pendingDecisionSchema,
  plannerOutputSchema,
  precedingAssistantReferencesCatalogName,
  presentedSavedAddressIndex,
  recoverExplicitActiveCartModifierSelection,
  referencesCatalogName,
  savedAddressReferenceSchema,
  validateToolCalls,
  withoutRejectedCatalogMutation,
  type PendingDecision,
  type ResponsesBody,
} from './toolPlannerNormalization.js';
import {
  activeCheckoutPlannerInstructions,
  catalogOrderingPlannerInstructions,
  compactPlannerMenuCatalogContext,
  compactPlannerState,
  compactPlannerTurns,
  plannerInstructions,
  planningPatterns,
  toolArgumentExamples,
  trimTrailingSlash,
} from './toolPlannerPrompts.js';


export type CommercePlannerState = Omit<AgentGraphState, 'channel' | 'recentTurns'>;

export interface ToolPlannerInput {
  state: CommercePlannerState;
  availableTools: ToolName[];
  recentTurns: ConversationTurn[];
  /** Trusted conversation evidence used only for consent validation, never sent to the model. */
  consentTurns?: ConversationTurn[];
  contextInventory?: ToolPlannerContextInventory;
  menuCatalogContext?: MenuPlanningContext;
  fulfillmentLocationContext?: FulfillmentPlanningContext;
  planningProfile?: 'full' | 'catalog_ordering' | 'active_checkout';
  /** Optional first-pass plan for an in-deadline AI self-review. Never commerce evidence. */
  priorPlanForReview?: ToolPlannerOutput;
}

export interface ToolPlannerContextInventory {
  cart: { available: boolean; itemCount: number };
  address: { available: boolean };
  fulfillment: { available: boolean };
  order: { available: boolean };
  payment: { available: boolean };
  menuSearchResults: { available: boolean; itemCount: number };
  customer: { available: boolean; savedAddressCount: number; recentOrderCount: number; favoriteCount?: number };
}

export interface ToolPlannerOutput {
  intent: Intent;
  contextPolicy?: ContextPolicyDirective;
  entities: Record<string, unknown>;
  pendingDecisions?: PendingDecision;
  catalogSuggestion?: CatalogSuggestionPlan;
  savedAddressDecision?: SavedAddressDecisionPlan;
  catalogSelections?: CatalogSelectionPlan[];
  toolCalls: ToolCallRequest[];
  responseClaims: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  directResponse?: string;
}

export interface SavedAddressDecisionPlan {
  addressIndex: number;
  decision: 'suggest' | 'accept';
}

export interface CatalogSuggestionPlan {
  itemCode: string;
  source: 'favorite' | 'recent_order';
  decision: 'suggest' | 'accept';
}

export interface CatalogSelectionPlan {
  requestFragment: string;
  itemCode: string;
  quantity: number;
  replacesItemCodes: string[];
  modifierChoices: Array<{
    groupId: string;
    name: string;
  }>;
}

export interface ToolPlanner {
  supportsMultiStep?: boolean;
  plan(input: ToolPlannerInput): Promise<ToolPlannerOutput>;
}

export class StaticToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;
  private index = 0;

  constructor(private readonly outputs: ToolPlannerOutput[]) {}

  async plan(_input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const output = this.outputs[this.index] ?? this.outputs.at(-1);
    this.index += 1;
    if (!output) {
      return {
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Mình cần thêm thông tin để hỗ trợ đúng.',
      };
    }
    return output;
  }
}

export interface OpenAIToolPlannerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}

async function fetchPlannerResponse(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
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

export function repairPlannerToolPolicy(_input: ToolPlannerInput, output: ToolPlannerOutput): ToolPlannerOutput {
  return output;
}

export class OpenAIToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIToolPlannerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.openai.com/v1');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async classifyPendingDecision(
    input: ToolPlannerInput,
    parsed: z.infer<typeof plannerOutputSchema>,
  ): Promise<PendingDecision | undefined> {
    const pendingSavedAddressIndex = presentedSavedAddressIndex(input);
    const assessSavedAddressSubject =
      pendingSavedAddressIndex === undefined &&
      !input.state.address &&
      !input.state.fulfillment &&
      (input.state.customerContext?.savedAddresses.length ?? 0) === 1 &&
      parsed.toolCalls.some((call) => call.toolName === 'updateCart') &&
      parsed.savedAddressDecision === undefined;
    const assessFoodContentEvidence =
      parsed.directResponse !== undefined &&
      parsed.toolCalls.some((call) => call.toolName === 'getModifierOptions') &&
      (input.availableTools.includes('searchContentPolicy') ||
        input.availableTools.includes('answerAllergenQuestion'));
    if (
      !input.state.pendingCatalogSuggestion &&
      !input.state.pendingReorder &&
      pendingSavedAddressIndex === undefined &&
      !assessSavedAddressSubject &&
      !assessFoodContentEvidence
    ) return undefined;

    const precedingAssistantTurn = [...(input.consentTurns ?? input.recentTurns)]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    if (!precedingAssistantTurn && !assessSavedAddressSubject && !assessFoodContentEvidence) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const requestMetadata = createOpenAiRequestMetadata(
        'planner pending-decision classification',
        this.options.model,
        this.options.diagnosticContext,
      );
      const response = await fetchPlannerResponse(this.fetchImpl, `${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_output_tokens: 120,
          text: { format: { type: 'json_object' } },
          instructions: [
            'Classify the latest customer turn against only the supplied pending actions.',
            'Return exactly one JSON object.',
            'Pending-action values must be one string: accept, decline, defer, unrelated, or unclear.',
            'savedAddressSubjectMatch must be target, alternate, unknown, or not-applicable.',
            'foodContentEvidenceRequirement must be required, not-required, or unknown.',
            'Example: {"catalogSuggestion":"accept","reorder":"unrelated","savedAddress":"defer","foodContentEvidenceRequirement":"required"}. Omit a key when its assessment is absent.',
            'Use conversation meaning and references, never a fixed word list.',
            'A mixed turn can accept a pending action while also asking another question.',
            'Judge only the latest customer turn. Earlier customer acceptance or rejection must never carry forward to this turn.',
            'Use the immediately preceding assistant turn only to resolve what the latest turn refers to.',
            'Acceptance requires the latest turn to endorse the exact pending action. A request for a different item or action instead is decline or unrelated, never accept.',
            'The reorder decision targets creation of a separate new order copied from the identified prior order; it does not target cancellation or mutation of any currently submitted order.',
            'When the customer affirmatively answers the assistant confirmation and also requires the currently submitted order to remain unchanged, classify the separate pending reorder as accept.',
            'Do not classify the reorder as decline merely because the customer requires the currently submitted order to remain unchanged.',
            'When the customer redirects from copying the pending prior order to a different selection source, item, or shopping path, classify the pending reorder as decline even if the alternative may overlap with items in that order.',
            'Judge only the pending action and conversation; no other planner output is relevant.',
          ].join(' '),
          input: JSON.stringify({
            responseFormat: 'json',
            latestUserMessage: input.state.latestUserMessage,
            precedingAssistantTurn: precedingAssistantTurn
              ? { role: precedingAssistantTurn.role, text: precedingAssistantTurn.text }
              : undefined,
            pendingCatalogSuggestion: input.state.pendingCatalogSuggestion,
            pendingReorder: input.state.pendingReorder
              ? {
                  orderId: input.state.pendingReorder.orderId,
                  items: input.state.pendingReorder.cart.items.map(({ itemCode, name, quantity }) => ({
                    itemCode,
                    name,
                    quantity,
                  })),
                }
              : undefined,
            pendingSavedAddress: pendingSavedAddressIndex === undefined
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
            customerFavorites: input.state.customerContext?.favorites.map(({ code, name }) => ({ code, name })),
          }),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ResponsesBody;
      assertOpenAiResponseOk(response, body, requestMetadata);
      const text = extractText(body);
      return text ? pendingDecisionSchema.parse(JSON.parse(text)) : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async classifySavedAddressReference(
    input: ToolPlannerInput,
    parsed: z.infer<typeof plannerOutputSchema>,
  ): Promise<number | undefined> {
    const savedAddresses = input.state.customerContext?.savedAddresses ?? [];
    if (
      savedAddresses.length === 0 ||
      input.state.address ||
      parsed.savedAddressDecision ||
      parsed.entities.addressChangeRequested === true ||
      !parsed.toolCalls.some((call) => call.toolName === 'updateCart')
    ) return undefined;

    const proposedDraft = typeof parsed.entities.addressDraft === 'object' &&
      parsed.entities.addressDraft !== null &&
      !Array.isArray(parsed.entities.addressDraft)
      ? parsed.entities.addressDraft as Record<string, unknown>
      : undefined;
    const hasCurrentTurnAddressEvidence = proposedDraft
      ? Object.values(proposedDraft).some((value) =>
          typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value),
        )
      : false;
    if (hasCurrentTurnAddressEvidence) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const requestMetadata = createOpenAiRequestMetadata(
        'planner saved-address classification',
        this.options.model,
        this.options.diagnosticContext,
      );
      const response = await fetchPlannerResponse(this.fetchImpl, `${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_output_tokens: 80,
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
            precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)]
              .reverse()
              .find((turn) => turn.role === 'assistant')?.text,
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

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    const requestMetadata = createOpenAiRequestMetadata(
      'tool planning',
      this.options.model,
      this.options.diagnosticContext,
    );

    const compactProfile = input.planningProfile === 'active_checkout' || input.planningProfile === 'catalog_ordering';
    const activeToolArgumentExamples = compactProfile
      ? Object.fromEntries(
          input.availableTools.map((toolName) => [toolName, toolArgumentExamples[toolName]]),
        )
      : toolArgumentExamples;
    const activeInstructions = input.planningProfile === 'active_checkout'
      ? activeCheckoutPlannerInstructions
      : input.planningProfile === 'catalog_ordering'
        ? catalogOrderingPlannerInstructions
        : plannerInstructions;
    let response: Response;
    try {
      response = await fetchPlannerResponse(this.fetchImpl, `${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          max_output_tokens: 640,
          text: { format: { type: 'json_object' } },
          instructions: activeInstructions,
          input: JSON.stringify(
            {
              locale: 'vi-VN',
              responseFormat: 'json',
              state: compactPlannerState(input.state),
              contextInventory: input.contextInventory,
              menuCatalogContext: compactPlannerMenuCatalogContext(input.menuCatalogContext),
              fulfillmentLocationContext: input.fulfillmentLocationContext,
              priorPlanForReview: input.priorPlanForReview,
              requiredDecisions: {
                ...(input.state.pendingCatalogSuggestion
                  ? {
                      pendingCatalogSuggestion: {
                        candidate: input.state.pendingCatalogSuggestion,
                        rule: 'Classify the latest turn against this exact presented candidate. Semantic acceptance requires the same top-level catalogSuggestion with decision=accept, including on a mixed request; rejection or deferral must not accept it.',
                      },
                    }
                  : {}),
                ...(input.contextInventory?.customer.recentOrderCount
                  ? {
                      recentOrder: {
                        available: true,
                        rule: 'If recentTurns contain a reorder awaiting confirmation, latest-turn confirmation requires contextPolicy.recentOrder=active and entities.reorderConfirmed=true. An initial or still-unconfirmed reorder requires confirm_before_use.',
                      },
                    }
                  : {}),
                ...(input.priorPlanForReview &&
                input.state.addressDraft &&
                (!input.state.addressDraft.line1 || !input.state.addressDraft.district || !input.state.addressDraft.city) &&
                (input.state.customerContext?.savedAddresses.length ?? 0) > 0
                  ? {
                      savedAddressSourceReview: {
                        carriedPartialDraft: input.state.addressDraft,
                        candidates: input.state.customerContext?.savedAddresses.map((address, addressIndex) => ({
                          addressIndex,
                          address,
                        })),
                        rule: 'Review the latest turn semantically. If it refers to one saved-address candidate, emit top-level savedAddressDecision with decision=suggest and omit addressDraft. Carry the partial draft only when the latest turn itself supplies or reaffirms its address fields.',
                      },
                    }
                  : {}),
                abnormalLargeOrder: {
                  threshold: 100,
                  rule: 'A request at or above this quantity requires intent=handoff and handoff reason abnormal_large_order, with no cart or order mutation.',
                },
              },
              availableTools: input.availableTools,
              recentTurns: compactPlannerTurns(input.recentTurns),
              toolArgumentExamples: activeToolArgumentExamples,
              ...(compactProfile ? {} : { planningPatterns }),
              outputSchema: compactProfile ? {
                intent: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
                contextPolicy: { '<only needed slice>': 'active' },
                entities: {
                  '<only true flags>': true,
                  addressDraft: '<only customer-supplied or uniquely provider-resolved fields>',
                },
                catalogSuggestion: '<optional {itemCode, source, decision}>',
                savedAddressDecision: '<optional {addressIndex, decision}>',
                catalogSelections: [{
                  requestFragment: '<exact latest-message phrase>',
                  itemCode: '<verified candidate code>',
                  quantity: 1,
                  replacesItemCodes: [],
                  modifierChoices: [{ groupId: '<exact groupId>', name: '<exact modifierChoices name>' }],
                }],
                toolCalls: [{ toolName: '<available tool name>', arguments: {} }],
                responseClaims: '<optional promotion|payment_success|allergen_certainty array>',
                directResponse: '<optional only for clarification or tool-less/read-only response>',
              } : {
                intent: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
                contextPolicy: {
                  cart: 'active|confirm_before_use|irrelevant',
                  order: 'active|confirm_before_use|irrelevant',
                  fulfillment: 'active|confirm_before_use|irrelevant',
                  menuSearchResults: 'active|confirm_before_use|irrelevant',
                  payment: 'active|confirm_before_use|irrelevant',
                  handoff: 'active|confirm_before_use|irrelevant',
                  recentTurns: 'active|confirm_before_use|irrelevant',
                  customer: 'active|confirm_before_use|irrelevant',
                  membership: 'active|confirm_before_use|irrelevant',
                  recentOrder: 'active|confirm_before_use|irrelevant',
                },
                entities: {
                  smallTalk: false,
                  cartMutationRequested: false,
                  cartMutationConfirmed: false,
                  fulfillmentAccepted: false,
                  useSavedAddress: false,
                  reorderConfirmed: false,
                  orderConfirmed: false,
                  asksClarification: false,
                  freshShoppingJourney: false,
                  addressChangeRequested: false,
                  addressDraft: {
                    line1: 'verbatim building, number, street, ward, or other local-address text from the latest message; omit only when absent',
                    district: 'customer-provided district or one uniquely provider-resolved canonical district',
                    city: 'customer-provided city or one uniquely provider-resolved canonical city',
                    label: 'optional customer-provided address label; never synthesize a default',
                  },
                },
                catalogSuggestion: {
                  itemCode: 'verified customer-evidence candidate code to propose without mutation',
                  source: 'favorite|recent_order',
                  decision: 'suggest|accept',
                },
                savedAddressDecision: {
                  addressIndex: 'zero-based index from state.customerContext.savedAddresses',
                  decision: 'suggest|accept',
                },
                catalogSelections: [{
                  requestFragment: 'exact contiguous requested item phrase from the latest message',
                  itemCode: 'verified candidate code satisfying every descriptor in that phrase',
                  quantity: 1,
                  replacesItemCodes: ['exact visible active-cart code only when this selection explicitly replaces it'],
                  modifierChoices: [{
                    groupId: 'exact modifierChoices groupId when a requested descriptor needs it',
                    name: 'exact modifierChoices name',
                  }],
                }],
                toolCalls: [
                  {
                    toolName: 'searchMenu',
                    arguments: {
                      query: '<specific item/category text or omit for full menu>',
                    },
                  },
                ],
                responseClaims: [],
                directResponse: 'model-written response for no-tool or read-only discovery plans',
              },
            },
          ),
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI tool planning timed out after ${this.options.timeoutMs ?? 8_000}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);

    const text = extractText(body);
    if (!text) throw new Error('OpenAI tool planning returned no text');
    let parsed = plannerOutputSchema.parse(normalizePlannerOutputEnvelope(JSON.parse(text)));
    const savedAddressReferenceIndex = await this.classifySavedAddressReference(input, parsed);
    if (savedAddressReferenceIndex !== undefined) {
      const entities = { ...parsed.entities };
      delete entities.addressDraft;
      parsed = {
        ...parsed,
        entities,
        savedAddressDecision: { addressIndex: savedAddressReferenceIndex, decision: 'suggest' },
      };
    }
    const pendingDecision = await this.classifyPendingDecision(input, parsed);
    if (
      (parsed.contextPolicy.recentOrder === 'active' ||
        parsed.contextPolicy.recentOrder === 'confirm_before_use') &&
      parsed.entities.reorderConfirmed !== true &&
      pendingDecision?.reorder !== 'decline' &&
      pendingDecision?.reorder !== 'unrelated'
    ) {
      parsed = {
        ...parsed,
        contextPolicy: { ...parsed.contextPolicy, recentOrder: 'confirm_before_use' },
        catalogSuggestion: parsed.catalogSuggestion?.source === 'favorite'
          ? undefined
          : parsed.catalogSuggestion,
        entities: { ...parsed.entities, asksClarification: true },
      };
    }
    if (input.state.pendingCatalogSuggestion && pendingDecision?.catalogSuggestion) {
      if (pendingDecision.catalogSuggestion === 'accept') {
        parsed = {
          ...parsed,
          catalogSuggestion: {
            itemCode: input.state.pendingCatalogSuggestion.itemCode,
            source: input.state.pendingCatalogSuggestion.source,
            decision: 'accept',
          },
          catalogSelections: [],
          toolCalls: parsed.toolCalls.filter((call) => call.toolName !== 'updateCart'),
        };
      } else if (parsed.catalogSuggestion?.decision === 'accept') {
        parsed = { ...parsed, catalogSuggestion: undefined };
      }
    }
    if (input.state.pendingReorder && pendingDecision?.reorder) {
      if (pendingDecision.reorder === 'accept') {
        parsed = {
          ...parsed,
          intent: 'ordering',
          contextPolicy: { ...parsed.contextPolicy, recentOrder: 'active' },
          entities: { ...parsed.entities, reorderConfirmed: true, asksClarification: false },
        };
      } else if (parsed.entities.reorderConfirmed === true) {
        parsed = {
          ...parsed,
          entities: { ...parsed.entities, reorderConfirmed: false },
        };
      }
    }
    const pendingSavedAddressIndex = presentedSavedAddressIndex(input);
    if (pendingSavedAddressIndex !== undefined && pendingDecision?.savedAddress) {
      if (pendingDecision.savedAddress === 'accept') {
        parsed = {
          ...parsed,
          savedAddressDecision: { addressIndex: pendingSavedAddressIndex, decision: 'accept' },
        };
      } else if (parsed.savedAddressDecision?.decision === 'accept') {
        parsed = { ...parsed, savedAddressDecision: undefined };
      }
    }
    if (
      pendingSavedAddressIndex === undefined &&
      pendingDecision?.savedAddressSubjectMatch === 'target' &&
      (input.state.customerContext?.savedAddresses.length ?? 0) === 1
    ) {
      const { addressDraft: _ignoredAddressDraft, ...entitiesWithoutAddressDraft } = parsed.entities;
      parsed = {
        ...parsed,
        savedAddressDecision: { addressIndex: 0, decision: 'suggest' },
        entities: {
          ...entitiesWithoutAddressDraft,
          useSavedAddress: false,
          fulfillmentAccepted: false,
          asksClarification: true,
        },
      };
    }
    if (
      pendingDecision?.foodContentEvidenceRequirement === 'required' &&
      !parsed.toolCalls.some((call) =>
        call.toolName === 'searchContentPolicy' || call.toolName === 'answerAllergenQuestion')
    ) {
      const evidenceTool = input.availableTools.includes('answerAllergenQuestion')
        ? 'answerAllergenQuestion' as const
        : input.availableTools.includes('searchContentPolicy')
          ? 'searchContentPolicy' as const
          : undefined;
      if (evidenceTool) {
        parsed = {
          ...parsed,
          intent: 'safety',
          toolCalls: [
            ...parsed.toolCalls,
            {
              toolName: evidenceTool,
              arguments: evidenceTool === 'searchContentPolicy'
                ? { kind: 'allergen', query: input.state.latestUserMessage }
                : { query: input.state.latestUserMessage },
            },
          ],
          directResponse: undefined,
        };
      }
    }
    const recoveredActiveCartModifierSelection = recoverExplicitActiveCartModifierSelection(input, parsed);
    const catalogSelections = recoveredActiveCartModifierSelection
      ? [recoveredActiveCartModifierSelection]
      : parsed.catalogSelections;
    const validatedToolCalls = validateToolCalls(
      parsed.toolCalls,
      input.availableTools,
      input.priorPlanForReview,
    );
    const normalizedCatalogCalls = normalizeCatalogSelectionCalls(input, catalogSelections, validatedToolCalls);
    const normalizedCatalogSuggestion = catalogSelections.length === 0
      ? normalizeCatalogSuggestion(input, parsed.catalogSuggestion)
      : undefined;
    const pendingCatalogSuggestion = input.state.pendingCatalogSuggestion;
    const acceptedCatalogSuggestion =
      normalizedCatalogSuggestion?.plan.decision === 'accept' &&
      pendingCatalogSuggestion?.itemCode === normalizedCatalogSuggestion.evidence.itemCode &&
      pendingCatalogSuggestion.source === normalizedCatalogSuggestion.plan.source &&
      pendingCatalogSuggestion.name === normalizedCatalogSuggestion.evidence.name &&
      input.availableTools.includes('updateCart') &&
      precedingAssistantReferencesCatalogName(input, normalizedCatalogSuggestion.evidence.name)
        ? normalizedCatalogSuggestion
        : undefined;
    const suggestionEvidence = normalizedCatalogCalls.suggestedCustomerEvidenceItem ??
      (acceptedCatalogSuggestion ? undefined : normalizedCatalogSuggestion?.evidence);
    const requiresCatalogConfirmation = normalizedCatalogCalls.rejected || Boolean(suggestionEvidence);
    const normalizedEntities = normalizePlannerEntities(parsed.entities);
    if (recoveredActiveCartModifierSelection) {
      normalizedEntities.asksClarification = false;
      normalizedEntities.cartMutationRequested = true;
      normalizedEntities.cartMutationConfirmed = true;
    }
    const savedAddressDecision = normalizeSavedAddressDecision(
      input,
      parsed.savedAddressDecision,
      normalizedEntities,
    );
    if (savedAddressDecision) {
      delete normalizedEntities.addressDraft;
    }
    const normalizedToolCalls = acceptedCatalogSuggestion
      ? [
          ...withoutRejectedCatalogMutation(normalizedCatalogCalls.toolCalls)
            .filter((call) => call.toolName !== 'searchMenu'),
          {
            toolName: 'updateCart' as const,
            arguments: { itemCode: acceptedCatalogSuggestion.evidence.itemCode, quantity: 1 },
          },
        ]
      : suggestionEvidence
        ? withoutRejectedCatalogMutation(normalizedCatalogCalls.toolCalls)
        : normalizedCatalogCalls.toolCalls;
    const hasMembershipProfileRead = normalizedToolCalls.some((call) => call.toolName === 'getMembershipProfile');
    const hasCartForRewardContext = Boolean(input.state.cart) ||
      normalizedToolCalls.some((call) => call.toolName === 'updateCart' && call.arguments.quantity !== 0);
    const hasDependentMembershipRead = normalizedToolCalls.some((call) =>
      ['listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory'].includes(call.toolName),
    );
    const toolCallsWithGroundedMembership =
      hasMembershipProfileRead &&
      hasCartForRewardContext &&
      !hasDependentMembershipRead &&
      input.availableTools.includes('listMembershipRewards')
        ? [
            ...normalizedToolCalls,
            { toolName: 'listMembershipRewards' as const, arguments: {} },
          ]
        : normalizedToolCalls;
    const toolCallsWithSavedAddressPolicy = savedAddressDecision?.decision === 'suggest'
      ? toolCallsWithGroundedMembership.filter(
          (call) => !['quoteFulfillment', 'previewOrder', 'placeOrder', 'createPaymentLink'].includes(call.toolName),
        )
      : toolCallsWithGroundedMembership;
    const toolCallsWithGroundedProductDetails = toolCallsWithSavedAddressPolicy.map((call): ToolCallRequest => {
      if (call.toolName !== 'getItemDetails' || typeof call.arguments.code !== 'string') return call;
      const candidate = input.menuCatalogContext?.candidates.find((entry) => entry.code === call.arguments.code);
      if (
        !candidate ||
        referencesCatalogName(input.state.latestUserMessage, candidate.name) ||
        precedingAssistantReferencesCatalogName(input, candidate.name)
      ) return call;
      return { toolName: 'searchMenu', arguments: {} };
    });
    const catalogNormalizedEntities = requiresCatalogConfirmation
      ? {
          ...normalizedEntities,
          asksClarification: true,
          ...(suggestionEvidence
            ? {
                cartMutationRequested: false,
                cartMutationConfirmed: false,
                reorderConfirmed: false,
                catalogSuggestion: suggestionEvidence,
              }
            : {}),
        }
        : acceptedCatalogSuggestion
        ? {
            ...normalizedEntities,
            asksClarification: false,
            cartMutationRequested: true,
            cartMutationConfirmed: true,
            reorderConfirmed: false,
          }
        : catalogSelections.length > 0 && normalizedCatalogCalls.toolCalls.some((call) => call.toolName === 'updateCart')
          ? { ...normalizedEntities, cartMutationRequested: true }
          : normalizedEntities;
    const finalEntities = savedAddressDecision
      ? {
          ...catalogNormalizedEntities,
          savedAddressDecision,
          useSavedAddress: savedAddressDecision.decision === 'accept',
          fulfillmentAccepted: savedAddressDecision.decision === 'accept',
          asksClarification: savedAddressDecision.decision === 'suggest' || catalogNormalizedEntities.asksClarification === true,
        }
      : catalogNormalizedEntities;
    const addressDraft =
      typeof finalEntities.addressDraft === 'object' &&
      finalEntities.addressDraft !== null &&
      !Array.isArray(finalEntities.addressDraft)
        ? finalEntities.addressDraft as Record<string, unknown>
        : undefined;
    const hasCompleteAddressDraft = Boolean(
      addressDraft &&
      typeof addressDraft.line1 === 'string' && addressDraft.line1.trim().length > 0 &&
      typeof addressDraft.district === 'string' && addressDraft.district.trim().length > 0 &&
      typeof addressDraft.city === 'string' && addressDraft.city.trim().length > 0,
    );
    const mayQuoteKnownAddress = Boolean(
      input.state.address && finalEntities.fulfillmentAccepted === true,
    );
    const finalToolCalls = toolCallsWithGroundedProductDetails.filter((call) =>
      (
        call.toolName !== 'quoteFulfillment' ||
        hasCompleteAddressDraft ||
        savedAddressDecision?.decision === 'accept' ||
        mayQuoteKnownAddress
      ) && (
        call.toolName !== 'collectInvoice' ||
        (
          typeof call.arguments.companyName === 'string' && call.arguments.companyName.trim().length > 0 &&
          typeof call.arguments.taxCode === 'string' && call.arguments.taxCode.trim().length > 0 &&
          typeof call.arguments.email === 'string' && call.arguments.email.trim().length > 0
        )
      ),
    );
    const requestsCancellationHandoff = finalToolCalls.some((call) =>
      call.toolName === 'handoff' &&
      Array.isArray(call.arguments.reasons) &&
      call.arguments.reasons.includes('order_cancellation_requested'),
    );
    const toolCallsWithOrderStatus =
      requestsCancellationHandoff &&
      input.state.order?.id &&
      input.availableTools.includes('getOrderStatus') &&
      !finalToolCalls.some((call) => call.toolName === 'getOrderStatus')
        ? [
            { toolName: 'getOrderStatus' as const, arguments: { orderId: input.state.order.id } },
            ...finalToolCalls,
          ]
        : finalToolCalls;
    return repairPlannerToolPolicy(input, {
      intent: parsed.intent,
      contextPolicy: savedAddressDecision
        ? { ...parsed.contextPolicy, customer: 'active', fulfillment: 'active' }
        : parsed.contextPolicy,
      entities: finalEntities,
      pendingDecisions: pendingDecision,
      catalogSuggestion: normalizedCatalogSuggestion?.plan,
      savedAddressDecision,
      catalogSelections: requiresCatalogConfirmation ? [] : catalogSelections,
      toolCalls: toolCallsWithOrderStatus,
      responseClaims: parsed.responseClaims,
      directResponse:
        requiresCatalogConfirmation ||
        acceptedCatalogSuggestion ||
        savedAddressDecision?.decision === 'suggest'
          ? undefined
          : parsed.directResponse,
    });
  }
}
