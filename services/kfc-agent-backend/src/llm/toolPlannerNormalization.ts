import { z } from 'zod';
import { parseToolArguments, toolNames } from '../ordering/toolCatalog.js';
import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { MenuPlanningContext, ToolCallRequest, ToolName } from '../ordering/types.js';
import type {
  CatalogSelectionPlan,
  CatalogSuggestionPlan,
  ToolPlannerInput,
  ToolPlannerOutput,
} from './toolPlanner.js';
import { expandCompactPlannerOutput } from './toolPlannerCompactOutput.js';

export const supportedResponseClaims = ['promotion', 'payment_success', 'allergen_certainty'] as const;
export const supportedResponseClaimSet = new Set<string>(supportedResponseClaims);

export const plannerOutputSchema = z.object({
  intent: z.enum(['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear']),
  contextPolicy: z
    .object({
      cart: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      order: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      fulfillment: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      promotion: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      menuSearchResults: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      payment: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      invoice: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      handoff: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      recentTurns: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      customer: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      membership: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      recentOrder: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
    })
    .default({}),
  entities: z.record(z.unknown()).default({}),
  foodContentEvidenceRequirement: z.enum(['required', 'not-required', 'unknown']).optional(),
  pendingDecisions: z
    .object({
      catalogSuggestion: z.enum(['accept', 'decline', 'defer', 'unrelated', 'unclear']).optional(),
      reorder: z.enum(['accept', 'decline', 'defer', 'unrelated', 'unclear']).optional(),
    })
    .strict()
    .optional(),
  catalogSuggestion: z.preprocess(
    (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
      const record = value as Record<string, unknown>;
      return typeof record.itemCode === 'string' && ['favorite', 'recent_order'].includes(String(record.source)) ? value : undefined;
    },
    z
      .object({
        itemCode: z.string().min(1),
        source: z.enum(['favorite', 'recent_order']),
        decision: z.enum(['suggest', 'accept']).default('suggest'),
      })
      .strict()
      .optional(),
  ),
  savedAddressDecision: z.preprocess(
    (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
      const record = value as Record<string, unknown>;
      return Number.isInteger(record.addressIndex) && ['suggest', 'accept'].includes(String(record.decision)) ? value : undefined;
    },
    z
      .object({
        addressIndex: z.number().int().nonnegative(),
        decision: z.enum(['suggest', 'accept']),
      })
      .strict()
      .optional(),
  ),
  catalogSelections: z
    .array(
      z
        .object({
          requestFragment: z.string().min(1),
          itemCode: z.string().min(1),
          quantity: z.number().int().positive(),
          replacesItemCodes: z.array(z.string().min(1)).default([]),
          modifierChoices: z
            .array(
              z
                .object({
                  groupId: z.string().min(1),
                  name: z.string().min(1),
                })
                .strict(),
            )
            .default([]),
        })
        .strict(),
    )
    .default([]),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        arguments: z.record(z.unknown()),
      }),
    )
    .default([]),
  responseClaims: z.preprocess(
    (value) => (Array.isArray(value) ? value.filter((claim) => typeof claim === 'string' && supportedResponseClaimSet.has(claim)) : value),
    z.array(z.enum(supportedResponseClaims)).default([]),
  ),
  directResponse: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

export const pendingDecisionValues = ['accept', 'decline', 'defer', 'unrelated', 'unclear'] as const;
export const optionalPendingDecisionSchema = z.preprocess(
  (value) => (pendingDecisionValues.includes(value as (typeof pendingDecisionValues)[number]) ? value : undefined),
  z.enum(pendingDecisionValues).optional(),
);
export const pendingDecisionSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return {
      catalogSuggestion: record.catalogSuggestion ?? record.pendingCatalogSuggestion,
      reorder: record.reorder ?? record.pendingReorder,
      savedAddress: record.savedAddress ?? record.pendingSavedAddress ?? record.savedAddressDecision ?? record.pendingSavedAddressDecision,
      savedAddressSubjectMatch: record.savedAddressSubjectMatch ?? record.savedAddressReference,
      foodContentEvidenceRequirement: record.foodContentEvidenceRequirement ?? record.foodEvidenceRequirement,
      selectionSource: record.selectionSource ?? record.customerSelectionSource,
    };
  },
  z.object({
    catalogSuggestion: optionalPendingDecisionSchema,
    reorder: optionalPendingDecisionSchema,
    savedAddress: optionalPendingDecisionSchema,
    savedAddressSubjectMatch: z.enum(['target', 'alternate', 'unknown', 'not-applicable']).optional(),
    foodContentEvidenceRequirement: z.enum(['required', 'not-required', 'unknown']).optional(),
    selectionSource: z.enum(['favorite', 'recent_order', 'other', 'unknown']).optional(),
  }),
);

export type PendingDecision = z.infer<typeof pendingDecisionSchema>;

export const savedAddressReferenceSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const rawAddressIndex = record.addressIndex ?? record.savedAddressIndex;
    return {
      decision: record.decision,
      addressIndex: typeof rawAddressIndex === 'string' && /^\d+$/.test(rawAddressIndex) ? Number(rawAddressIndex) : rawAddressIndex,
    };
  },
  z.object({
    decision: z.enum(['saved_address', 'not_saved_address', 'unclear']),
    addressIndex: z.number().int().nonnegative().nullable().optional(),
  }),
);

export interface ResponsesBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

export function extractText(body: ResponsesBody): string | undefined {
  if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) {
    return body.output_text.trim();
  }
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim().length > 0) {
        return content.text.trim();
      }
    }
  }
  return undefined;
}

export function normalizePlannerOutputEnvelope(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const output = { ...(value as Record<string, unknown>) };
  expandCompactPlannerOutput(output);
  if (Array.isArray(output.toolCalls)) {
    const actualToolCalls: unknown[] = [];
    for (const entry of output.toolCalls) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        actualToolCalls.push(entry);
        continue;
      }
      const call = entry as Record<string, unknown>;
      if (call.toolName === undefined && typeof call.n === 'string') call.toolName = call.n;
      if (call.arguments === undefined && typeof call.a === 'object' && call.a !== null && !Array.isArray(call.a)) {
        call.arguments = call.a;
      }
      const metadataKey = call.toolName;
      if (metadataKey === 'savedAddressDecision' || metadataKey === 'catalogSuggestion') {
        if (
          output[metadataKey] === undefined &&
          typeof call.arguments === 'object' &&
          call.arguments !== null &&
          !Array.isArray(call.arguments)
        ) {
          output[metadataKey] = call.arguments;
        }
        continue;
      }
      actualToolCalls.push(entry);
    }
    output.toolCalls = actualToolCalls;
  }
  if (typeof output.pendingDecisions === 'object' && output.pendingDecisions !== null && !Array.isArray(output.pendingDecisions)) {
    const allowed = new Set(['accept', 'decline', 'defer', 'unrelated', 'unclear']);
    const pendingDecisions = { ...(output.pendingDecisions as Record<string, unknown>) };
    for (const key of ['catalogSuggestion', 'reorder']) {
      if (pendingDecisions[key] !== undefined && !allowed.has(String(pendingDecisions[key]))) {
        delete pendingDecisions[key];
      }
    }
    if (Object.keys(pendingDecisions).length > 0) output.pendingDecisions = pendingDecisions;
    else delete output.pendingDecisions;
  }
  if (typeof output.entities !== 'object' || output.entities === null || Array.isArray(output.entities)) return output;
  const entities = { ...(output.entities as Record<string, unknown>) };
  for (const key of [
    'intent',
    'contextPolicy',
    'foodContentEvidenceRequirement',
    'catalogSuggestion',
    'savedAddressDecision',
    'catalogSelections',
    'toolCalls',
    'responseClaims',
    'directResponse',
  ]) {
    if (output[key] === undefined && entities[key] !== undefined) {
      output[key] = entities[key];
    }
    delete entities[key];
  }
  const savedAddressDecision = output.savedAddressDecision;
  if (
    typeof savedAddressDecision !== 'object' ||
    savedAddressDecision === null ||
    Array.isArray(savedAddressDecision) ||
    !Number.isInteger((savedAddressDecision as Record<string, unknown>).addressIndex) ||
    !['suggest', 'accept'].includes(String((savedAddressDecision as Record<string, unknown>).decision))
  ) {
    delete output.savedAddressDecision;
  }
  const catalogSuggestion = output.catalogSuggestion;
  if (
    typeof catalogSuggestion !== 'object' ||
    catalogSuggestion === null ||
    Array.isArray(catalogSuggestion) ||
    typeof (catalogSuggestion as Record<string, unknown>).itemCode !== 'string' ||
    !['favorite', 'recent_order'].includes(String((catalogSuggestion as Record<string, unknown>).source))
  ) {
    delete output.catalogSuggestion;
  }
  if (output.intent === undefined) {
    const proposedToolNames = Array.isArray(output.toolCalls)
      ? output.toolCalls.flatMap((entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).toolName === 'string'
            ? [String((entry as Record<string, unknown>).toolName)]
            : [],
        )
      : [];
    output.intent = proposedToolNames.some((name) => name === 'handoff')
      ? 'handoff'
      : proposedToolNames.some((name) => ['searchContentPolicy', 'answerAllergenQuestion'].includes(name))
        ? 'safety'
        : proposedToolNames.some((name) => ['listPaymentMethods', 'checkPaymentStatus', 'createPaymentLink'].includes(name))
          ? 'payment'
          : proposedToolNames.some((name) => name === 'getOrderStatus')
            ? 'order_status'
            : proposedToolNames.some((name) => ['searchPromotions', 'explainPromotion', 'validateVoucher'].includes(name))
              ? 'voucher'
              : proposedToolNames.length > 0
                ? 'ordering'
                : 'unclear';
  }
  output.entities = entities;
  return output;
}

export function isToolName(value: string): value is ToolName {
  return toolNames.includes(value as ToolName);
}

export function validateToolCalls(
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>,
  availableTools: ToolName[],
  priorPlanForReview?: ToolPlannerOutput,
): ToolCallRequest[] {
  const availableToolSet = new Set<string>(availableTools);
  const priorToolNames = new Set(priorPlanForReview?.toolCalls.map((call) => call.toolName) ?? []);

  return toolCalls.flatMap(({ toolName, arguments: args }) => {
    if (!isToolName(toolName)) {
      throw new Error(`OpenAI tool planner proposed unknown tool: ${toolName}`);
    }

    if (!availableToolSet.has(toolName)) {
      if (priorToolNames.has(toolName)) return [];
      throw new Error(`OpenAI tool planner proposed unavailable tool: ${toolName}`);
    }

    const parsedArguments = parseToolArguments(toolName, args);
    if (!parsedArguments.success) return [];

    return [
      {
        toolName,
        arguments: parsedArguments.data,
      } satisfies ToolCallRequest,
    ];
  });
}

export const plannerBooleanEntityKeys = [
  'smallTalk',
  'cartMutationRequested',
  'cartMutationConfirmed',
  'fulfillmentAccepted',
  'orderConfirmed',
  'asksClarification',
  'freshShoppingJourney',
  'reorderConfirmed',
  'useSavedAddress',
  'addressChangeRequested',
  'abnormalLargeOrder',
] as const;

export function normalizePlannerEntities(entities: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...entities };
  for (const protectedKey of ['catalogSuggestion', 'savedAddressDecision', 'fulfillmentRisk', 'unavailableItemCodes']) {
    delete normalized[protectedKey];
  }
  for (const key of plannerBooleanEntityKeys) {
    if (normalized[key] === 'true') normalized[key] = true;
    if (normalized[key] === 'false') normalized[key] = false;
  }
  return normalized;
}

export function addressFieldsEqual(
  left: { line1: string; district: string; city: string },
  right: { line1: string; district: string; city: string },
): boolean {
  return (['line1', 'district', 'city'] as const).every(
    (field) => normalizedReferenceTokens(left[field]).join(' ') === normalizedReferenceTokens(right[field]).join(' '),
  );
}

export function precedingAssistantPresentedSavedAddress(
  input: ToolPlannerInput,
  address: { line1: string; district: string; city: string },
): boolean {
  const precedingAssistant = [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant');
  if (!precedingAssistant) return false;

  const genUiAddress = precedingAssistant.metadata?.genUi?.data.address;
  if (typeof genUiAddress === 'object' && genUiAddress !== null) {
    const record = genUiAddress as Record<string, unknown>;
    if (
      typeof record.line1 === 'string' &&
      typeof record.district === 'string' &&
      typeof record.city === 'string' &&
      addressFieldsEqual(address, {
        line1: record.line1,
        district: record.district,
        city: record.city,
      })
    ) {
      return true;
    }
  }

  return [address.line1, address.district, address.city].every((field) => referencesCatalogName(precedingAssistant.text, field));
}

export function presentedSavedAddressIndex(input: ToolPlannerInput): number | undefined {
  if (input.state.address || input.state.fulfillment) return undefined;
  const index = (input.state.customerContext?.savedAddresses ?? []).findIndex((address) =>
    precedingAssistantPresentedSavedAddress(input, address),
  );
  return index >= 0 ? index : undefined;
}

export function normalizedReferenceTokens(value: string): string[] {
  return (
    value
      .toLocaleLowerCase('vi-VN')
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 1) ?? []
  );
}

export function referencesCatalogName(text: string, catalogName: string): boolean {
  const textTokens = new Set(normalizedReferenceTokens(text));
  const nameTokens = [...new Set(normalizedReferenceTokens(catalogName))];
  return nameTokens.length > 0 && nameTokens.every((token) => textTokens.has(token));
}

export function precedingAssistantReferencesCatalogName(input: ToolPlannerInput, catalogName: string): boolean {
  const precedingAssistantText =
    [...(input.consentTurns ?? input.recentTurns)].reverse().find((turn) => turn.role === 'assistant')?.text ?? '';
  return referencesCatalogName(precedingAssistantText, catalogName);
}

export function catalogCandidateMatchCount(candidate: MenuPlanningContext['candidates'][number], requestFragment: string): number {
  const requestTokens = [...new Set(normalizedReferenceTokens(requestFragment))].filter((token) => !/^\d+$/.test(token));
  const evidenceTokens = catalogCandidateEvidenceTokens(candidate);
  return requestTokens.filter((token) => evidenceTokens.has(token)).length;
}

const catalogSpecificityStopwords = new Set(['ga', 'mon', 'phan', 'kfc']);

export function catalogCandidateSpecificityScore(candidate: MenuPlanningContext['candidates'][number], requestFragment: string): number {
  const requestTokens = new Set(normalizedReferenceTokens(requestFragment));
  const unmatchedDistinctiveTokens = [...new Set(normalizedReferenceTokens(candidate.name))]
    .filter((token) => !catalogSpecificityStopwords.has(token))
    .filter((token) => !requestTokens.has(token));
  return catalogCandidateMatchCount(candidate, requestFragment) * 100 - unmatchedDistinctiveTokens.length;
}

export function catalogCandidateEvidenceTokens(candidate: MenuPlanningContext['candidates'][number]): Set<string> {
  return new Set(
    normalizedReferenceTokens(
      [
        candidate.name,
        candidate.category,
        candidate.description,
        ...(candidate.matchedSearchAliases ?? []),
        ...candidate.modifierGroups.flatMap((group) => [
          group.name,
          ...group.options.flatMap((option) => [option.name, ...(option.searchAliases ?? [])]),
        ]),
      ].join(' '),
    ),
  );
}

export function normalizeCatalogSuggestion(
  input: ToolPlannerInput,
  suggestion: CatalogSuggestionPlan | undefined,
):
  | {
      plan: CatalogSuggestionPlan;
      evidence: {
        itemCode: string;
        name: string;
        sources: Array<'favorite' | 'recent_order'>;
      };
    }
  | undefined {
  if (!suggestion) return undefined;
  const candidate = input.menuCatalogContext?.candidates.find((item) => item.code === suggestion.itemCode);
  if (!candidate?.verifiedForMutation || !candidate.available || !candidate.customerEvidenceSources?.includes(suggestion.source))
    return undefined;
  return {
    plan: suggestion,
    evidence: {
      itemCode: candidate.code,
      name: candidate.name,
      sources: candidate.customerEvidenceSources,
    },
  };
}

export const rejectedCatalogMutationTools = new Set<ToolName>([
  'updateCart',
  'previewCart',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
]);

export function withoutRejectedCatalogMutation(toolCalls: ToolCallRequest[]): ToolCallRequest[] {
  return toolCalls.filter((call) => !rejectedCatalogMutationTools.has(call.toolName));
}

export function normalizeCatalogSelectionCalls(
  input: ToolPlannerInput,
  selections: CatalogSelectionPlan[],
  toolCalls: ToolCallRequest[],
): {
  toolCalls: ToolCallRequest[];
  rejected: boolean;
  suggestedCustomerEvidenceItem?: {
    itemCode: string;
    name: string;
    sources: Array<'favorite' | 'recent_order'>;
  };
} {
  const proposedUpdates = toolCalls.filter((call) => call.toolName === 'updateCart');
  if (input.state.order && proposedUpdates.length > 0) {
    return {
      toolCalls: withoutRejectedCatalogMutation(toolCalls),
      rejected: true,
    };
  }
  if (input.planningProfile === 'catalog_ordering' && proposedUpdates.length > 0 && selections.length === 0) {
    return {
      toolCalls: withoutRejectedCatalogMutation(toolCalls),
      rejected: true,
    };
  }
  if (selections.length === 0) return { toolCalls, rejected: false };

  let suggestedCustomerEvidenceItem:
    | {
        itemCode: string;
        name: string;
        sources: Array<'favorite' | 'recent_order'>;
      }
    | undefined;
  try {
    const latestText = input.state.latestUserMessage.toLocaleLowerCase('vi-VN');
    const candidates = new Map(input.menuCatalogContext?.candidates.map((candidate) => [candidate.code, candidate]) ?? []);
    const comboProposal =
      input.state.comboConversionProposal ??
      (input.state.entities &&
      typeof input.state.entities.comboConversionProposal === 'object' &&
      input.state.entities.comboConversionProposal !== null
        ? (input.state.entities.comboConversionProposal as Record<string, unknown>)
        : undefined);
    const proposalSourceItemCodes =
      Array.isArray(comboProposal?.sourceItemCodes) && comboProposal.sourceItemCodes.every((code) => typeof code === 'string')
        ? (comboProposal.sourceItemCodes as string[])
        : [];
    const activeCartCodes = new Set([
      ...(input.state.cart?.items.map((item) => item.itemCode) ?? []),
      ...(input.menuCatalogContext?.candidates.filter((candidate) => candidate.activeCartItem).map((candidate) => candidate.code) ?? []),
      ...proposalSourceItemCodes,
    ]);
    const compiledAdditions = selections.map((selection): ToolCallRequest => {
      if (!latestText.includes(selection.requestFragment.toLocaleLowerCase('vi-VN'))) {
        throw new Error(`Catalog selection requestFragment is not present in the latest message: ${selection.requestFragment}`);
      }
      const candidate = candidates.get(selection.itemCode);
      if (!candidate?.verifiedForMutation || !candidate.available) {
        throw new Error(`Catalog selection is not verified for mutation: ${selection.itemCode}`);
      }
      if (candidate.fulfillmentAvailability?.available === false) {
        throw new Error(`Catalog selection is unavailable for the resolved fulfillment location: ${selection.itemCode}`);
      }
      if (
        (candidate.customerEvidenceSources?.length ?? 0) > 0 &&
        !activeCartCodes.has(candidate.code) &&
        !referencesCatalogName(input.state.latestUserMessage, candidate.name)
      ) {
        suggestedCustomerEvidenceItem = {
          itemCode: candidate.code,
          name: candidate.name,
          sources: candidate.customerEvidenceSources ?? [],
        };
        throw new Error(`Customer-evidence catalog selection requires explicit confirmation: ${selection.itemCode}`);
      }
      const hasDirectNamedCandidate = [...candidates.values()].some((entry) =>
        referencesCatalogName(selection.requestFragment, entry.name),
      );
      const isActiveCartModifierSelection = candidate.activeCartItem && selection.modifierChoices.length > 0;
      if (!isActiveCartModifierSelection && hasDirectNamedCandidate && !referencesCatalogName(selection.requestFragment, candidate.name)) {
        throw new Error(`Catalog selection broadens a directly named product: ${selection.itemCode}`);
      }
      const selectedMatchCount = catalogCandidateMatchCount(candidate, selection.requestFragment);
      const strongestMatchCount = Math.max(
        0,
        ...[...candidates.values()].map((entry) => catalogCandidateMatchCount(entry, selection.requestFragment)),
      );
      if (selectedMatchCount === 0 || selectedMatchCount < strongestMatchCount) {
        throw new Error(`Catalog selection is a weaker lexical match than visible menu evidence: ${selection.itemCode}`);
      }

      if (new Set(selection.modifierChoices.map((choice) => choice.groupId)).size !== selection.modifierChoices.length) {
        throw new Error(`Catalog modifier alias is ambiguous for ${selection.itemCode}`);
      }

      const modifiers = selection.modifierChoices.flatMap((choice) => {
        const group = candidate.modifierGroups.find((candidateGroup) => candidateGroup.groupId === choice.groupId);
        const option = group?.options.find(
          (candidateOption) => candidateOption.name.trim().toLocaleLowerCase('vi-VN') === choice.name.trim().toLocaleLowerCase('vi-VN'),
        );
        if (!option) {
          throw new Error(`Catalog modifier choice is not verified for ${selection.itemCode}: ${choice.groupId}/${choice.name}`);
        }
        return option.selectionBundle;
      });
      const uniqueModifiers = [...new Map(modifiers.map((modifier) => [`${modifier.groupId}:${modifier.modifierId}`, modifier])).values()];

      return {
        toolName: 'updateCart',
        arguments: {
          itemCode: selection.itemCode,
          quantity: selection.quantity,
          ...(uniqueModifiers.length > 0 ? { modifiers: uniqueModifiers } : {}),
        },
      };
    });

    const acceptsVerifiedComboProposal =
      selections.length === 1 &&
      proposalSourceItemCodes.length > 0 &&
      selections[0]?.itemCode === comboProposal?.itemCode &&
      selections[0]?.quantity === comboProposal?.quantity;
    const replacementCodes = [
      ...new Set([
        ...selections.flatMap((selection) => selection.replacesItemCodes),
        ...(acceptsVerifiedComboProposal ? proposalSourceItemCodes : []),
      ]),
    ];
    for (const replacementCode of replacementCodes) {
      if (!activeCartCodes.has(replacementCode)) {
        throw new Error(`Catalog replacement target is not in the active cart: ${replacementCode}`);
      }
    }
    const compiledRemovals = replacementCodes.map((itemCode): ToolCallRequest => ({
      toolName: 'updateCart',
      arguments: { itemCode, quantity: 0 },
    }));

    const nonCatalogCalls = toolCalls.filter(
      (call) => call.toolName !== 'updateCart' && !['searchMenu', 'getItemDetails', 'getModifierOptions'].includes(call.toolName),
    );
    return { toolCalls: [...nonCatalogCalls, ...compiledRemovals, ...compiledAdditions], rejected: false };
  } catch {
    // A model-authored mutation that cannot be compiled entirely from verified
    // catalog and cart evidence is rejected atomically. Read-only lookups and
    // independent tools remain available so the same turn can still recover.
    return {
      toolCalls: withoutRejectedCatalogMutation(toolCalls),
      rejected: true,
      ...(suggestedCustomerEvidenceItem ? { suggestedCustomerEvidenceItem } : {}),
    };
  }
}
