import { z } from 'zod';
import type { CommerceAgentPolicy } from '../config/commerceAgentPolicy.js';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { WorkflowRoute } from '../domain/workflow.js';
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
  pendingDecisionSchema,
  plannerOutputSchema,
  precedingAssistantReferencesCatalogName,
  presentedSavedAddressIndex,
  referencesCatalogName,
  validateToolCalls,
  withoutRejectedCatalogMutation,
  type PendingDecision,
  type ResponsesBody,
} from './toolPlannerNormalization.js';
import { normalizeSavedAddressDecision } from './toolPlannerSavedAddressPolicy.js';
import { normalizeBoundedHandoffPlan, recoverVerifiedFavoriteSuggestion, withoutStaleMembershipReads } from './toolPlannerPlanPolicy.js';
import { trimTrailingSlash } from './toolPlannerPrompts.js';
import { buildToolPlannerRequest } from './toolPlannerRequest.js';
import { suppressStaleAddressChange } from './toolPlannerBehaviorGuards.js';
import {
  classifyActiveCartModifierChange,
  classifyPendingDecision,
  classifyUnresolvedCatalogReference,
  fetchPlannerResponse,
} from './toolPlannerClassifiers.js';
import {
  classifyActiveCheckoutAvailabilityContinuation, classifyActiveHandoffFollowup, classifyAddressChangeRequest, classifySavedAddressReference, tryFastInitialPlan, tryFastReadOnlyReview,
} from './toolPlannerBoundedClassifiers.js';
import { PlannerContractError, plannerSemanticViolations, priorPlanFromRawOutput, rawSchemaPlannerError, runPlannerWithSemanticReplan, type PlannerSemanticViolationCode } from './toolPlannerSemanticContract.js';
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
  workflowRoute?: WorkflowRoute;
  policy?: CommerceAgentPolicy;
  /** Optional first-pass plan for an in-deadline AI self-review. Never commerce evidence. */
  priorPlanForReview?: ToolPlannerOutput;
  semanticViolations?: PlannerSemanticViolationCode[];
}
export interface ToolPlannerContextInventory {
  cart: { available: boolean; itemCount: number };
  address: { available: boolean };
  fulfillment: { available: boolean };
  order: { available: boolean };
  payment: { available: boolean };
  handoff?: { available: boolean };
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
export { StaticToolPlanner } from './staticToolPlanner.js';
export interface OpenAIToolPlannerOptions {
  apiKey: string;
  model: string;
  fastModel?: string;
  statusModel?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}
export function repairPlannerToolPolicy(_input: ToolPlannerInput, output: ToolPlannerOutput): ToolPlannerOutput {
  return output;
}

function recoverVerifiedActiveModifierEnvelope(
  value: unknown,
  input: ToolPlannerInput,
  candidate: MenuPlanningContext['candidates'][number],
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  const entities =
    typeof output.entities === 'object' && output.entities !== null && !Array.isArray(output.entities)
      ? output.entities as Record<string, unknown>
      : {};
  if (!Array.isArray(output.catalogSelections) || output.catalogSelections.length !== 1) return value;
  const selection = output.catalogSelections[0];
  if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) return value;
  const selectionRecord = selection as Record<string, unknown>;
  if (
    entities.cartMutationConfirmed !== true &&
    entities.cartMutationRequested !== true &&
    selectionRecord.cartMutationConfirmed !== true &&
    output.intent !== 'cart_edit'
  ) return value;
  if (selectionRecord.itemCode !== candidate.code) return value;
  const choices = Array.isArray(selectionRecord.modifierChoices)
    ? selectionRecord.modifierChoices
    : Array.isArray(selectionRecord.modifiers)
      ? selectionRecord.modifiers
      : [];
  const verifiedChoices = choices.flatMap((choice) => {
    if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) return [];
    const record = choice as Record<string, unknown>;
    const group = candidate.modifierGroups.find((entry) => entry.groupId === record.groupId);
    const option = group?.options.find((entry) =>
      entry.name === record.name || entry.modifierId === record.modifierId
    );
    return group && option ? [{ groupId: group.groupId, name: option.name }] : [];
  });
  if (verifiedChoices.length === 0 || verifiedChoices.length !== choices.length) return value;
  return {
    ...output,
    entities: {
      ...entities,
      asksClarification: false,
      cartMutationRequested: true,
      ...(
        entities.cartMutationConfirmed === true || selectionRecord.cartMutationConfirmed === true
          ? { cartMutationConfirmed: true }
          : {}
      ),
    },
    catalogSelections: [{
      requestFragment: input.state.latestUserMessage,
      itemCode: candidate.code,
      quantity: candidate.activeCartQuantity ?? 1,
      replacesItemCodes: [],
      modifierChoices: verifiedChoices,
    }],
  };
}

export class OpenAIToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: OpenAIToolPlannerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.openai.com/v1');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }
  private classifyPendingDecision(
    input: ToolPlannerInput,
    parsed: z.infer<typeof plannerOutputSchema>,
    independentlyClassified?: PendingDecision,
  ): Promise<PendingDecision | undefined> {
    return classifyPendingDecision({
      input,
      parsed,
      independentlyClassified,
      model: this.options.model,
      apiKey: this.options.apiKey,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.options.timeoutMs,
      diagnosticContext: this.options.diagnosticContext,
    });
  }
  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    return runPlannerWithSemanticReplan(input, (nextInput) => this.planOnce(nextInput));
  }
  private async planOnce(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    if (input.semanticViolations) return this.planWithModel(input, this.options.model);
    const fastModel = this.options.fastModel?.trim();
    const fastInitial = await tryFastInitialPlan({
      input,
      fastModel,
      statusModel: this.options.statusModel,
      fullModel: this.options.model,
      apiKey: this.options.apiKey,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.options.timeoutMs,
      diagnosticContext: this.options.diagnosticContext,
    });
    if (fastInitial === 'requires_full_planning') return this.planWithModel(input, this.options.model);
    if (fastInitial) return fastInitial;
    const fastReview = await tryFastReadOnlyReview({
      plannerInput: input,
      fastModel,
      fullModel: this.options.model,
      planWithModel: (model) => this.planWithModel(input, model),
    });
    if (fastReview) return fastReview;
    return this.planWithModel(input, this.options.model);
  }
  private async planWithModel(input: ToolPlannerInput, plannerModel: string): Promise<ToolPlannerOutput> {
    let independentPendingDecisionPromise: Promise<PendingDecision | undefined> | undefined;
    const fullPlanner = plannerModel === this.options.model && !input.semanticViolations;
    const addressChangePromise =
      fullPlanner &&
      input.state.address &&
      input.state.fulfillment &&
      this.options.fastModel &&
      this.options.fastModel !== this.options.model
        ? classifyAddressChangeRequest({
            input,
            model: this.options.fastModel,
            apiKey: this.options.apiKey,
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.options.timeoutMs,
            diagnosticContext: this.options.diagnosticContext,
          })
        : undefined;
    const activeHandoffFollowupPromise =
      fullPlanner && input.state.handoff
        ? classifyActiveHandoffFollowup({
            input,
            model: this.options.model,
            apiKey: this.options.apiKey,
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.options.timeoutMs,
            diagnosticContext: this.options.diagnosticContext,
          })
        : undefined;
    const activeCheckoutReadPromise = fullPlanner && !input.state.handoff &&
      input.planningProfile === 'active_checkout' && input.state.fulfillment?.availability.ok === true &&
      input.state.cart?.items.length && input.availableTools.includes('checkStoreAvailability')
      ? classifyActiveCheckoutAvailabilityContinuation({
          input, model: this.options.model, apiKey: this.options.apiKey, baseUrl: this.baseUrl,
          fetchImpl: this.fetchImpl, timeoutMs: this.options.timeoutMs,
          diagnosticContext: this.options.diagnosticContext,
        })
      : undefined;
    const activeModifierCandidates =
      input.menuCatalogContext?.candidates.filter(
        (candidate) => candidate.activeCartItem && candidate.available && candidate.verifiedForMutation,
      ) ?? [];
    const activeModifierCandidate = activeModifierCandidates.length === 1 ? activeModifierCandidates[0] : undefined;
    const latestMessageReferencesActiveModifier = Boolean(
      activeModifierCandidate?.modifierGroups.some((group) =>
        group.options.some(
          (option) =>
            referencesCatalogName(input.state.latestUserMessage, option.name) ||
            (option.searchAliases ?? []).some((alias) => referencesCatalogName(input.state.latestUserMessage, alias)),
        ),
      ),
    );
    const activeCartModifierChangePromise =
      fullPlanner && activeModifierCandidate && latestMessageReferencesActiveModifier
        ? classifyActiveCartModifierChange({
            input,
            candidate: activeModifierCandidate,
            model: this.options.model,
            apiKey: this.options.apiKey,
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.options.timeoutMs,
            diagnosticContext: this.options.diagnosticContext,
          })
        : undefined;
    const unresolvedReferencePromise =
      input.planningProfile === 'active_checkout' &&
      fullPlanner &&
      !activeCartModifierChangePromise &&
      this.options.fastModel &&
      this.options.fastModel !== this.options.model
        ? classifyUnresolvedCatalogReference({
            input,
            model: this.options.fastModel,
            apiKey: this.options.apiKey,
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.options.timeoutMs,
            diagnosticContext: this.options.diagnosticContext,
          })
        : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    const requestMetadata = createOpenAiRequestMetadata('tool planning', plannerModel, this.options.diagnosticContext);
    const plannerRequest = buildToolPlannerRequest(input);
    let response: Response;
    try {
      let primarySettled = false;
      const primaryResponsePromise = fetchPlannerResponse(this.fetchImpl, `${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        body: JSON.stringify({
          model: plannerModel,
          temperature: 0,
          max_output_tokens:
            input.planningProfile === 'active_checkout' || input.state.order ? 384 : 640,
          text: { format: { type: 'json_object' } },
          instructions: plannerRequest.instructions,
          input: plannerRequest.input,
        }),
      }).then(
        (value) => {
          primarySettled = true;
          return value;
        },
        (error: unknown) => {
          primarySettled = true;
          throw error;
        },
      );
      void primaryResponsePromise.catch(() => undefined);
      const earlyBoundedPlanPromise = activeHandoffFollowupPromise ?? activeCheckoutReadPromise;
      if (earlyBoundedPlanPromise) {
        const firstResult = await Promise.race([
          primaryResponsePromise.then((primaryResponse) => ({ kind: 'primary' as const, primaryResponse })),
          earlyBoundedPlanPromise.then((boundedPlan) => ({ kind: 'bounded' as const, boundedPlan })),
        ]);
        if (firstResult.kind === 'bounded' && firstResult.boundedPlan !== 'requires_full_planning') {
          controller.abort('superseded');
          return firstResult.boundedPlan;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!primarySettled && plannerModel === this.options.model && (input.state.pendingCatalogSuggestion || input.state.pendingReorder)) {
        independentPendingDecisionPromise = this.classifyPendingDecision(
          input,
          plannerOutputSchema.parse({
            intent: 'unclear',
            entities: {},
            toolCalls: [],
            responseClaims: [],
          }),
        );
      }
      response = await primaryResponsePromise;
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
    const activeHandoffFollowup = await activeHandoffFollowupPromise;
    if (activeHandoffFollowup && activeHandoffFollowup !== 'requires_full_planning') {
      return activeHandoffFollowup;
    }
    const activeCartModifierChange = await activeCartModifierChangePromise;
    let parsed: z.infer<typeof plannerOutputSchema>;
    try {
      const envelope = normalizePlannerOutputEnvelope(JSON.parse(text));
      parsed = normalizeBoundedHandoffPlan(
        input,
        plannerOutputSchema.parse(
          activeModifierCandidate && latestMessageReferencesActiveModifier
            ? recoverVerifiedActiveModifierEnvelope(envelope, input, activeModifierCandidate)
            : envelope,
        ),
      );
    } catch (error) {
      if (!activeCartModifierChange?.confirmedChange) throw rawSchemaPlannerError(error);
      parsed = plannerOutputSchema.parse({ intent: 'cart_edit', entities: {}, toolCalls: [], responseClaims: [] });
    }
    const rawViolations = plannerSemanticViolations(input, priorPlanFromRawOutput(parsed), { rawToolArgumentsOnly: true });
    if (rawViolations.length > 0) throw new PlannerContractError(rawViolations, priorPlanFromRawOutput(parsed));
    const addressChangeDecision = await addressChangePromise;
    if (addressChangeDecision === 'change') {
      parsed = {
        ...parsed,
        entities: { ...parsed.entities, addressChangeRequested: true },
      };
    } else if (addressChangeDecision === 'no_change') {
      const {
        addressChangeRequested: _discardedAddressChange,
        addressDraft: _discardedAddressDraft,
        ...entities
      } = parsed.entities;
      parsed = { ...parsed, entities };
    }
    if (activeCartModifierChange?.confirmedChange) {
      parsed = {
        ...parsed,
        intent: 'cart_edit',
        entities: {
          ...parsed.entities,
          asksClarification: false,
          cartMutationRequested: true,
          cartMutationConfirmed: true,
        },
        catalogSelections: [{
          requestFragment: input.state.latestUserMessage,
          itemCode: activeModifierCandidate!.code,
          quantity: activeModifierCandidate!.activeCartQuantity ?? 1,
          replacesItemCodes: [],
          modifierChoices: activeCartModifierChange.selectedModifierChoices,
        }],
        toolCalls: activeCartModifierChange.additionalRequest === 'none' ? withoutStaleMembershipReads(parsed.toolCalls) : parsed.toolCalls,
        directResponse: undefined,
      };
    }
    if (
      unresolvedReferencePromise &&
      parsed.toolCalls.some((call) => call.toolName === 'searchMenu' || call.toolName === 'updateCart') &&
      (await unresolvedReferencePromise)
    ) {
      return {
        intent: 'unclear',
        entities: { asksClarification: true, unresolvedCatalogReference: true },
        toolCalls: [],
        responseClaims: [],
      };
    }
    const proposedAddressDraft =
      typeof parsed.entities.addressDraft === 'object' &&
      parsed.entities.addressDraft !== null &&
      !Array.isArray(parsed.entities.addressDraft)
        ? (parsed.entities.addressDraft as Record<string, unknown>)
        : undefined;
    const proposedDraftHasCurrentTurnEvidence = proposedAddressDraft
      ? Object.values(proposedAddressDraft).some(
          (value) => typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value),
        )
      : false;
    if (
      parsed.savedAddressDecision &&
      parsed.entities.addressChangeRequested !== true &&
      proposedAddressDraft &&
      !proposedDraftHasCurrentTurnEvidence
    ) {
      const { addressDraft: _discardedCopiedSavedAddress, ...entities } = parsed.entities;
      parsed = { ...parsed, entities };
    }
    const pendingDecisionPromise =
      independentPendingDecisionPromise
        ? independentPendingDecisionPromise.then((independentlyClassified) =>
            this.classifyPendingDecision(input, parsed, independentlyClassified),
          )
        : this.classifyPendingDecision(input, parsed);
    const [savedAddressReferenceIndex, classifiedPendingDecision] =
      plannerModel === this.options.model
        ? await Promise.all([
            classifySavedAddressReference({
              input,
              parsed,
              model: this.options.model,
              apiKey: this.options.apiKey,
              baseUrl: this.baseUrl,
              fetchImpl: this.fetchImpl,
              timeoutMs: this.options.timeoutMs,
              diagnosticContext: this.options.diagnosticContext,
            }),
            pendingDecisionPromise,
          ])
        : [undefined, undefined];
    const primaryFoodEvidence = pendingDecisionSchema.safeParse({
      foodContentEvidenceRequirement: parsed.foodContentEvidenceRequirement ?? parsed.entities.foodContentEvidenceRequirement,
    });
    const proposedPrimaryFoodEvidence = primaryFoodEvidence.success ? primaryFoodEvidence.data.foodContentEvidenceRequirement : undefined;
    const primaryFoodContentEvidence =
      proposedPrimaryFoodEvidence === 'not-required' || (proposedPrimaryFoodEvidence === 'required' && parsed.intent === 'safety')
        ? proposedPrimaryFoodEvidence
        : undefined;
    const combinedPendingDecision = primaryFoodContentEvidence
      ? {
          ...parsed.pendingDecisions,
          ...classifiedPendingDecision,
          foodContentEvidenceRequirement: primaryFoodContentEvidence,
        }
      : {
          ...parsed.pendingDecisions,
          ...classifiedPendingDecision,
        };
    const pendingDecision = Object.keys(combinedPendingDecision).length > 0 ? combinedPendingDecision : undefined; parsed = recoverVerifiedFavoriteSuggestion(input, parsed, pendingDecision);
    if (savedAddressReferenceIndex !== undefined) {
      const entities = { ...parsed.entities };
      delete entities.addressDraft;
      parsed = {
        ...parsed,
        entities,
        savedAddressDecision: { addressIndex: savedAddressReferenceIndex, decision: 'suggest' },
      };
    }
    if (
      (parsed.contextPolicy.recentOrder === 'active' || parsed.contextPolicy.recentOrder === 'confirm_before_use') &&
      parsed.entities.reorderConfirmed !== true &&
      pendingDecision?.reorder !== 'decline' &&
      pendingDecision?.reorder !== 'unrelated'
    ) {
      const preservesUnclearFavorite = Boolean(input.state.pendingReorder) && parsed.catalogSuggestion?.source === 'favorite' && (pendingDecision?.selectionSource === 'favorite' || (pendingDecision?.reorder !== 'accept' && pendingDecision?.reorder !== 'defer'));
      parsed = {
        ...parsed,
        contextPolicy: { ...parsed.contextPolicy, recentOrder: 'confirm_before_use' },
        catalogSuggestion: preservesUnclearFavorite ? parsed.catalogSuggestion : undefined,
        entities: { ...parsed.entities, asksClarification: true },
        catalogSelections: [],
        toolCalls: parsed.toolCalls.filter((call) => call.toolName !== 'searchMenu' && call.toolName !== 'updateCart'),
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
          catalogSelections: [],
          toolCalls: parsed.toolCalls.filter(
            (call) => !['searchMenu', 'getItemDetails', 'getModifierOptions', 'updateCart'].includes(call.toolName),
          ),
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
      !parsed.toolCalls.some((call) => call.toolName === 'searchContentPolicy' || call.toolName === 'answerAllergenQuestion')
    ) {
      const evidenceTool = input.availableTools.includes('answerAllergenQuestion')
        ? ('answerAllergenQuestion' as const)
        : input.availableTools.includes('searchContentPolicy')
          ? ('searchContentPolicy' as const)
          : undefined;
      if (evidenceTool) {
        parsed = {
          ...parsed,
          intent: 'safety',
          toolCalls: [
            ...parsed.toolCalls,
            {
              toolName: evidenceTool,
              arguments:
                evidenceTool === 'searchContentPolicy'
                  ? { kind: 'allergen', query: input.state.latestUserMessage }
                  : { query: input.state.latestUserMessage },
            },
          ],
          directResponse: undefined,
        };
      }
    }
    const catalogSelections = parsed.catalogSelections;
    const validatedToolCalls = validateToolCalls(parsed.toolCalls, input.availableTools, input.priorPlanForReview);
    const normalizedCatalogCalls = normalizeCatalogSelectionCalls(input, catalogSelections, validatedToolCalls);
    const normalizedCatalogSuggestion =
      catalogSelections.length === 0 ? normalizeCatalogSuggestion(input, parsed.catalogSuggestion) : undefined;
    const pendingCatalogSuggestion = input.state.pendingCatalogSuggestion;
    const acceptedCatalogSuggestion =
      normalizedCatalogSuggestion?.plan.decision === 'accept' &&
      pendingCatalogSuggestion?.itemCode === normalizedCatalogSuggestion.evidence.itemCode &&
      pendingCatalogSuggestion.source === normalizedCatalogSuggestion.plan.source &&
      pendingCatalogSuggestion.name === normalizedCatalogSuggestion.evidence.name &&
      input.availableTools.includes('updateCart')
        ? normalizedCatalogSuggestion
        : undefined;
    const suggestionEvidence =
      normalizedCatalogCalls.suggestedCustomerEvidenceItem ??
      (acceptedCatalogSuggestion ? undefined : normalizedCatalogSuggestion?.evidence);
    const requiresCatalogConfirmation = normalizedCatalogCalls.rejected || Boolean(suggestionEvidence);
    const normalizedEntities = normalizePlannerEntities(parsed.entities);
    const savedAddressDecision = normalizeSavedAddressDecision(input, parsed.savedAddressDecision, normalizedEntities);
    if (savedAddressDecision) {
      delete normalizedEntities.addressDraft;
    }
    const normalizedToolCalls = acceptedCatalogSuggestion
      ? [
          ...withoutRejectedCatalogMutation(normalizedCatalogCalls.toolCalls).filter((call) => call.toolName !== 'searchMenu'),
          {
            toolName: 'updateCart' as const,
            arguments: { itemCode: acceptedCatalogSuggestion.evidence.itemCode, quantity: 1 },
          },
        ]
      : suggestionEvidence
        ? withoutRejectedCatalogMutation(normalizedCatalogCalls.toolCalls)
        : normalizedCatalogCalls.toolCalls;
    const hasMembershipProfileRead = normalizedToolCalls.some((call) => call.toolName === 'getMembershipProfile');
    const hasCartForRewardContext =
      Boolean(input.state.cart) ||
      pendingDecision?.reorder === 'accept' ||
      normalizedToolCalls.some((call) => call.toolName === 'updateCart' && call.arguments.quantity !== 0);
    const hasDependentMembershipRead = normalizedToolCalls.some((call) =>
      ['listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory'].includes(call.toolName),
    );
    const toolCallsWithGroundedMembership =
      hasMembershipProfileRead &&
      hasCartForRewardContext &&
      !hasDependentMembershipRead &&
      input.availableTools.includes('listMembershipRewards')
        ? [...normalizedToolCalls, { toolName: 'listMembershipRewards' as const, arguments: {} }]
        : normalizedToolCalls;
    const toolCallsWithSavedAddressPolicy =
      savedAddressDecision?.decision === 'suggest'
        ? toolCallsWithGroundedMembership.filter(
            (call) =>
              !['findStores', 'checkStoreAvailability', 'quoteFulfillment', 'previewOrder', 'placeOrder', 'createPaymentLink'].includes(
                call.toolName,
              ),
          )
        : toolCallsWithGroundedMembership;
    const toolCallsWithGroundedProductDetails = toolCallsWithSavedAddressPolicy.map((call): ToolCallRequest => {
      if (call.toolName !== 'getItemDetails' || typeof call.arguments.code !== 'string') return call;
      const candidate = input.menuCatalogContext?.candidates.find((entry) => entry.code === call.arguments.code);
      if (
        !candidate ||
        referencesCatalogName(input.state.latestUserMessage, candidate.name) ||
        precedingAssistantReferencesCatalogName(input, candidate.name)
      )
        return call;
      return { toolName: 'searchMenu', arguments: {} };
    });
    const cartMutationItemCodes = new Set(
      toolCallsWithGroundedProductDetails.flatMap((call) => {
        if (call.toolName !== 'updateCart') return [];
        const directCode = typeof call.arguments.itemCode === 'string' ? [call.arguments.itemCode] : [];
        const changeCodes = Array.isArray(call.arguments.changes)
          ? call.arguments.changes.flatMap((change) =>
              typeof change === 'object' && change !== null && typeof change.itemCode === 'string' ? [change.itemCode] : [],
            )
          : [];
        return [...directCode, ...changeCodes];
      }),
    );
    const toolCallsWithoutRedundantCatalogSearch = toolCallsWithGroundedProductDetails.filter((call) => {
      if (call.toolName !== 'searchMenu') return true;
      return !input.menuCatalogContext?.candidates.some((candidate) => cartMutationItemCodes.has(candidate.code));
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
    let finalEntities: Record<string, unknown> = savedAddressDecision
      ? {
          ...catalogNormalizedEntities,
          savedAddressDecision,
          useSavedAddress: savedAddressDecision.decision === 'accept',
          fulfillmentAccepted: savedAddressDecision.decision === 'accept',
          asksClarification: savedAddressDecision.decision === 'suggest' || catalogNormalizedEntities.asksClarification === true,
        }
      : catalogNormalizedEntities;
    const unavailableCatalogClarification =
      input.menuCatalogContext?.candidates[0]?.available === false &&
      !toolCallsWithGroundedProductDetails.some((call) => call.toolName === 'updateCart');
    if (unavailableCatalogClarification) {
      const { addressDraft: _ignoredAddressDraft, ...catalogFirstEntities } = finalEntities;
      finalEntities = { ...catalogFirstEntities, asksClarification: true, keepMenuSurface: true };
    }
    const verifiedAddressChange = addressChangeDecision === 'change' ||
      (addressChangeDecision === 'unknown' && finalEntities.addressChangeRequested === true);
    suppressStaleAddressChange(input, finalEntities, verifiedAddressChange);
    const addressDraft =
      typeof finalEntities.addressDraft === 'object' && finalEntities.addressDraft !== null && !Array.isArray(finalEntities.addressDraft)
        ? (finalEntities.addressDraft as Record<string, unknown>)
        : undefined;
    const hasCompleteAddressDraft = Boolean(
      addressDraft &&
      typeof addressDraft.line1 === 'string' &&
      addressDraft.line1.trim().length > 0 &&
      typeof addressDraft.district === 'string' &&
      addressDraft.district.trim().length > 0 &&
      typeof addressDraft.city === 'string' &&
      addressDraft.city.trim().length > 0,
    );
    const mayQuoteKnownAddress = Boolean(input.state.address && finalEntities.fulfillmentAccepted === true);
    let finalToolCalls = toolCallsWithoutRedundantCatalogSearch.filter(
      (call) =>
        (call.toolName !== 'quoteFulfillment' ||
          (!input.state.fulfillment && (hasCompleteAddressDraft || savedAddressDecision?.decision === 'accept' || mayQuoteKnownAddress)) ||
          (finalEntities.addressChangeRequested === true && hasCompleteAddressDraft)) &&
        (call.toolName !== 'collectInvoice' ||
          (typeof call.arguments.companyName === 'string' &&
            call.arguments.companyName.trim().length > 0 &&
            typeof call.arguments.taxCode === 'string' &&
            call.arguments.taxCode.trim().length > 0 &&
            typeof call.arguments.email === 'string' &&
            call.arguments.email.trim().length > 0)),
    );
    if (
      hasCompleteAddressDraft &&
      proposedDraftHasCurrentTurnEvidence &&
      input.state.cart?.items.length &&
      input.availableTools.includes('quoteFulfillment') &&
      !finalToolCalls.some((call) => call.toolName === 'quoteFulfillment')
    ) {
      finalToolCalls = [...finalToolCalls, {
        toolName: 'quoteFulfillment',
        arguments: {
          address: {
            line1: addressDraft!.line1,
            district: addressDraft!.district,
            city: addressDraft!.city,
          },
          method: 'delivery',
          itemCodes: [...new Set(input.state.cart.items.map(({ itemCode }) => itemCode))],
        },
      }];
    }
    const toolCallsWithRequiredQuery = finalToolCalls.filter(
      (call) =>
        call.toolName !== 'previewOrder' ||
        finalEntities.orderConfirmed === true ||
        input.state.userConfirmedOrder === true,
    );
    const hasFoodEvidenceCall = toolCallsWithRequiredQuery.some((call) =>
      ['getModifierOptions', 'searchContentPolicy', 'answerAllergenQuestion'].includes(call.toolName),
    );
    const toolCallsWithoutRedundantSafetySearch =
      parsed.intent === 'safety' && hasFoodEvidenceCall
        ? toolCallsWithRequiredQuery.filter((call) => call.toolName !== 'searchMenu')
        : toolCallsWithRequiredQuery;
    return repairPlannerToolPolicy(input, {
      intent: parsed.intent,
      contextPolicy: unavailableCatalogClarification
        ? {
            ...parsed.contextPolicy,
            menuSearchResults: 'active',
            fulfillment: 'irrelevant',
          }
        : savedAddressDecision
          ? {
              ...parsed.contextPolicy,
              customer: 'active',
              fulfillment: 'active',
            }
          : parsed.contextPolicy,
      entities: finalEntities,
      pendingDecisions: pendingDecision,
      catalogSuggestion: normalizedCatalogSuggestion?.plan,
      savedAddressDecision,
      catalogSelections: requiresCatalogConfirmation ? [] : catalogSelections,
      toolCalls: toolCallsWithoutRedundantSafetySearch,
      responseClaims: parsed.responseClaims,
      directResponse:
        requiresCatalogConfirmation || acceptedCatalogSuggestion || savedAddressDecision?.decision === 'suggest'
          ? undefined
          : parsed.directResponse,
    });
  }
}
