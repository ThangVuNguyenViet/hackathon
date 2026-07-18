import type { ToolPlannerInput } from './toolPlanner.js';
import { presentedSavedAddressIndex } from './toolPlannerNormalization.js';
import {
  activeCheckoutPlannerInstructions,
  catalogOrderingPlannerInstructions,
  compactPlannerMenuCatalogContext,
  compactPlannerState,
  compactPlannerTurns,
  plannerInstructions,
  planningPatterns,
  toolArgumentExamples,
} from './toolPlannerPrompts.js';

export function buildToolPlannerRequest(input: ToolPlannerInput): {
  instructions: string;
  input: string;
} {
  const compactProfile = input.planningProfile === 'active_checkout' || input.planningProfile === 'catalog_ordering';
  const activeToolArgumentExamples = compactProfile
    ? Object.fromEntries(input.availableTools.map((toolName) => [toolName, toolArgumentExamples[toolName]]))
    : toolArgumentExamples;
  const instructions = input.planningProfile === 'active_checkout'
    ? activeCheckoutPlannerInstructions
    : input.planningProfile === 'catalog_ordering'
      ? catalogOrderingPlannerInstructions
      : plannerInstructions;
  const requiredDecisions = {
    ...(input.state.pendingCatalogSuggestion
      ? {
          pendingCatalogSuggestion: {
            candidate: input.state.pendingCatalogSuggestion,
            rule: 'Classify the latest turn against this exact presented candidate. Semantic acceptance requires the same top-level catalogSuggestion with decision=accept, including on a mixed request; rejection or deferral must not accept it.',
          },
        }
      : {}),
    ...(presentedSavedAddressIndex(input) !== undefined
      ? {
          pendingSavedAddressConfirmation: {
            addressIndex: presentedSavedAddressIndex(input),
            candidate: input.state.customerContext?.savedAddresses[presentedSavedAddressIndex(input)!],
            rule: 'Classify the latest turn against this exact address confirmation. Semantic acceptance requires top-level savedAddressDecision with this addressIndex and decision=accept; do not copy the address into addressDraft.',
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
    ...(input.state.pendingReorder
      ? {
          pendingReorder: {
            orderId: input.state.pendingReorder.orderId,
            items: input.state.pendingReorder.cart.items.map(({ itemCode, name, quantity }) => ({
              itemCode,
              name,
              quantity,
            })),
            rule: 'Classify the latest turn against this exact pending separate-order confirmation. Always emit pendingDecisions.reorder. An affirmative answer to the immediately preceding confirmation is accept even when the customer restates that the submitted order must remain unchanged; never require a second confirmation. When accepted, emit pendingDecisions.reorder=accept, contextPolicy.recentOrder=active, and entities.reorderConfirmed=true. Otherwise do not emit a cart mutation for it.',
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
    foodContentEvidence: {
      rule: 'Always emit top-level foodContentEvidenceRequirement. Use required when answering would assert that food contains or excludes an ingredient, allergen, or safety-sensitive property not proved by a selectable modifier label; otherwise use not-required or unknown.',
    },
    privacySafeResponse: {
      rule: 'Requests for private employee contact details require a brief safe direct response. Do not call handoff unless the customer also semantically requests support or a person.',
    },
    handoffContinuation: {
      activeHandoffReasons: input.state.handoff?.reasons,
      rule: 'Do not call handoff again merely because an earlier turn created one. Repeat handoff only when the latest customer turn semantically requests new or continued human support.',
    },
    ...(input.semanticViolations
      ? {
          semanticReplan: {
            violationCodes: input.semanticViolations,
            rule: 'Correct the rejected plan using only supplied customer and verified commerce evidence. Do not repeat a rejected tool call unless every cited contract violation is resolved.',
          },
        }
      : {}),
  };
  const outputSchema = input.planningProfile === 'active_checkout'
    ? {
        i: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
        c: { '<only needed slice>': 'active' },
        e: {
          '<only true flags>': true,
          addressDraft: '<only customer-supplied or uniquely provider-resolved fields>',
        },
        f: 'required|not-required|unknown',
        p: {
          catalogSuggestion: 'accept|decline|defer|unrelated|unclear',
          reorder: 'accept|decline|defer|unrelated|unclear',
        },
        g: '<optional catalogSuggestion>',
        s: '<optional savedAddressDecision>',
        x: '<optional catalogSelections array>',
        t: [{ n: '<available tool name>', a: {} }],
        r: '<optional promotion|payment_success|allergen_certainty array>',
        d: '<optional only for clarification or tool-less/read-only response>',
      }
    : compactProfile
      ? {
        intent: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
        contextPolicy: { '<only needed slice>': 'active' },
        entities: {
          '<only true flags>': true,
          addressDraft: '<only customer-supplied or uniquely provider-resolved fields>',
        },
        foodContentEvidenceRequirement: 'required|not-required|unknown',
        pendingDecisions: {
          catalogSuggestion: 'accept|decline|defer|unrelated|unclear',
          reorder: 'accept|decline|defer|unrelated|unclear',
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
        }
      : {
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
          reorderConfirmed: input.state.pendingReorder
            ? 'true when the latest turn semantically accepts the exact pending separate-order confirmation; otherwise false'
            : false,
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
        foodContentEvidenceRequirement: 'required|not-required|unknown',
        pendingDecisions: {
          catalogSuggestion: 'accept|decline|defer|unrelated|unclear',
          reorder: 'accept|decline|defer|unrelated|unclear',
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
        toolCalls: [{
          toolName: 'searchMenu',
          arguments: { query: '<specific item/category text or omit for full menu>' },
        }],
        responseClaims: [],
        directResponse: 'model-written response for no-tool or read-only discovery plans',
      };

  return {
    instructions,
    input: JSON.stringify({
      locale: 'vi-VN',
      responseFormat: 'json',
      state: compactPlannerState(input.state),
      contextInventory: input.contextInventory,
      menuCatalogContext: compactPlannerMenuCatalogContext(input.menuCatalogContext),
      fulfillmentLocationContext: input.fulfillmentLocationContext,
      priorPlanForReview: input.priorPlanForReview,
      semanticViolations: input.semanticViolations,
      requiredDecisions,
      availableTools: input.availableTools,
      recentTurns: compactPlannerTurns(input.recentTurns),
      toolArgumentExamples: activeToolArgumentExamples,
      ...(compactProfile ? {} : { planningPatterns }),
      outputSchema,
    }),
  };
}
