import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ContextPolicyDirective } from '../graph/contextPolicy.js';
import { toolNames } from '../ordering/toolCatalog.js';
import type { FulfillmentPlanningContext, MenuPlanningContext, ToolCallRequest, ToolName } from '../ordering/types.js';

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

const supportedResponseClaims = ['promotion', 'payment_success', 'allergen_certainty'] as const;
const supportedResponseClaimSet = new Set<string>(supportedResponseClaims);

const plannerOutputSchema = z.object({
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
  catalogSuggestion: z.preprocess(
    (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
      const record = value as Record<string, unknown>;
      return typeof record.itemCode === 'string' && ['favorite', 'recent_order'].includes(String(record.source))
        ? value
        : undefined;
    },
    z.object({
      itemCode: z.string().min(1),
      source: z.enum(['favorite', 'recent_order']),
      decision: z.enum(['suggest', 'accept']).default('suggest'),
    }).strict().optional(),
  ),
  savedAddressDecision: z.preprocess(
    (value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
      const record = value as Record<string, unknown>;
      return Number.isInteger(record.addressIndex) && ['suggest', 'accept'].includes(String(record.decision))
        ? value
        : undefined;
    },
    z.object({
      addressIndex: z.number().int().nonnegative(),
      decision: z.enum(['suggest', 'accept']),
    }).strict().optional(),
  ),
  catalogSelections: z
    .array(
      z.object({
        requestFragment: z.string().min(1),
        itemCode: z.string().min(1),
        quantity: z.number().int().positive(),
        replacesItemCodes: z.array(z.string().min(1)).default([]),
        modifierChoices: z.array(z.object({
          groupId: z.string().min(1),
          name: z.string().min(1),
        }).strict()).default([]),
      }).strict(),
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
    (value) => Array.isArray(value)
      ? value.filter((claim) => typeof claim === 'string' && supportedResponseClaimSet.has(claim))
      : value,
    z.array(z.enum(supportedResponseClaims)).default([]),
  ),
  directResponse: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

interface ResponsesBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

function extractText(body: ResponsesBody): string | undefined {
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

function normalizePlannerOutputEnvelope(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const output = { ...(value as Record<string, unknown>) };
  if (typeof output.entities !== 'object' || output.entities === null || Array.isArray(output.entities)) return output;
  const entities = { ...(output.entities as Record<string, unknown>) };
  for (const key of [
    'intent',
    'contextPolicy',
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
  output.entities = entities;
  return output;
}

function isToolName(value: string): value is ToolName {
  return toolNames.includes(value as ToolName);
}

function validateToolCalls(
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>,
  availableTools: ToolName[],
): ToolCallRequest[] {
  const availableToolSet = new Set<string>(availableTools);

  return toolCalls.map(({ toolName, arguments: args }) => {
    if (!isToolName(toolName)) {
      throw new Error(`OpenAI tool planner proposed unknown tool: ${toolName}`);
    }

    if (!availableToolSet.has(toolName)) {
      throw new Error(`OpenAI tool planner proposed unavailable tool: ${toolName}`);
    }

    return {
      toolName,
      arguments: args,
    } satisfies ToolCallRequest;
  });
}

const plannerBooleanEntityKeys = [
  'smallTalk',
  'cartMutationRequested',
  'cartMutationConfirmed',
  'fulfillmentAccepted',
  'orderConfirmed',
  'asksClarification',
  'freshShoppingJourney',
  'reorderConfirmed',
  'useSavedAddress',
] as const;

function normalizePlannerEntities(entities: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...entities };
  for (const protectedKey of [
    'catalogSuggestion',
    'savedAddressDecision',
    'fulfillmentRisk',
    'unavailableItemCodes',
  ]) {
    delete normalized[protectedKey];
  }
  for (const key of plannerBooleanEntityKeys) {
    if (normalized[key] === 'true') normalized[key] = true;
    if (normalized[key] === 'false') normalized[key] = false;
  }
  return normalized;
}

function addressFieldsEqual(
  left: { line1: string; district: string; city: string },
  right: { line1: string; district: string; city: string },
): boolean {
  return (['line1', 'district', 'city'] as const).every((field) =>
    normalizedReferenceTokens(left[field]).join(' ') === normalizedReferenceTokens(right[field]).join(' '),
  );
}

function precedingAssistantPresentedSavedAddress(
  input: ToolPlannerInput,
  address: { line1: string; district: string; city: string },
): boolean {
  const precedingAssistant = [...(input.consentTurns ?? input.recentTurns)]
    .reverse()
    .find((turn) => turn.role === 'assistant');
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

  return [address.line1, address.district, address.city].every((field) =>
    referencesCatalogName(precedingAssistant.text, field),
  );
}

function normalizeSavedAddressDecision(
  input: ToolPlannerInput,
  proposed: SavedAddressDecisionPlan | undefined,
  entities: Record<string, unknown>,
): SavedAddressDecisionPlan | undefined {
  const savedAddresses = input.state.customerContext?.savedAddresses ?? [];
  let decision = proposed;
  if (!decision && entities.useSavedAddress === true && savedAddresses.length === 1) {
    decision = {
      addressIndex: 0,
      decision: precedingAssistantPresentedSavedAddress(input, savedAddresses[0]!) ? 'accept' : 'suggest',
    };
  }
  if (!decision) return undefined;

  const address = savedAddresses[decision.addressIndex];
  if (!address) return undefined;
  if (decision.decision === 'accept' && !precedingAssistantPresentedSavedAddress(input, address)) {
    return { ...decision, decision: 'suggest' };
  }
  return decision;
}

function normalizedReferenceTokens(value: string): string[] {
  return value
    .toLocaleLowerCase('vi-VN')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 1) ?? [];
}

function referencesCatalogName(text: string, catalogName: string): boolean {
  const textTokens = new Set(normalizedReferenceTokens(text));
  const nameTokens = [...new Set(normalizedReferenceTokens(catalogName))];
  return nameTokens.length > 0 && nameTokens.every((token) => textTokens.has(token));
}

function precedingAssistantReferencesCatalogName(input: ToolPlannerInput, catalogName: string): boolean {
  const precedingAssistantText = [...(input.consentTurns ?? input.recentTurns)]
    .reverse()
    .find((turn) => turn.role === 'assistant')?.text ?? '';
  return referencesCatalogName(precedingAssistantText, catalogName);
}

function catalogCandidateMatchCount(
  candidate: MenuPlanningContext['candidates'][number],
  requestFragment: string,
): number {
  const requestTokens = [...new Set(normalizedReferenceTokens(requestFragment))]
    .filter((token) => !/^\d+$/.test(token));
  const evidenceTokens = new Set(normalizedReferenceTokens([
    candidate.name,
    candidate.category,
    candidate.description,
    ...(candidate.matchedSearchAliases ?? []),
    ...candidate.modifierGroups.flatMap((group) => [
      group.name,
      ...group.options.flatMap((option) => [option.name, ...(option.searchAliases ?? [])]),
    ]),
  ].join(' ')));
  return requestTokens.filter((token) => evidenceTokens.has(token)).length;
}

function normalizeCatalogSuggestion(
  input: ToolPlannerInput,
  suggestion: CatalogSuggestionPlan | undefined,
): {
  plan: CatalogSuggestionPlan;
  evidence: {
    itemCode: string;
    name: string;
    sources: Array<'favorite' | 'recent_order'>;
  };
} | undefined {
  if (!suggestion) return undefined;
  const candidate = input.menuCatalogContext?.candidates.find((item) => item.code === suggestion.itemCode);
  if (
    !candidate?.verifiedForMutation ||
    !candidate.available ||
    !candidate.customerEvidenceSources?.includes(suggestion.source)
  ) return undefined;
  return {
    plan: suggestion,
    evidence: {
      itemCode: candidate.code,
      name: candidate.name,
      sources: candidate.customerEvidenceSources,
    },
  };
}

function recoverExplicitActiveCartModifierSelection(
  input: ToolPlannerInput,
  parsed: z.infer<typeof plannerOutputSchema>,
): CatalogSelectionPlan | undefined {
  if (parsed.entities.cartMutationConfirmed !== true) return undefined;

  const activeCandidates = input.menuCatalogContext?.candidates.filter(
    (candidate) => candidate.activeCartItem && candidate.available && candidate.verifiedForMutation,
  ) ?? [];
  if (activeCandidates.length !== 1) return undefined;
  const candidate = activeCandidates[0]!;
  if (parsed.catalogSelections.some((selection) => selection.itemCode !== candidate.code)) return undefined;
  const updatesDifferentItem = parsed.toolCalls.some((call) => {
    if (call.toolName !== 'updateCart') return false;
    if (typeof call.arguments.itemCode === 'string') return call.arguments.itemCode !== candidate.code;
    const changes = Array.isArray(call.arguments.changes) ? call.arguments.changes : [];
    return changes.some((change) =>
      typeof change === 'object' && change !== null &&
      typeof (change as Record<string, unknown>).itemCode === 'string' &&
      (change as Record<string, unknown>).itemCode !== candidate.code,
    );
  });
  if (updatesDifferentItem) return undefined;
  const cartItem = input.state.cart?.items.find((item) => item.itemCode === candidate.code);
  const activeQuantity = cartItem?.quantity ?? candidate.activeCartQuantity;
  if (!Number.isInteger(activeQuantity) || activeQuantity! <= 0) return undefined;
  const latestText = input.state.latestUserMessage.toLocaleLowerCase('vi-VN');

  const matchingChoices = candidate.modifierGroups.flatMap((group) =>
    group.options.flatMap((option) => {
      const matchedReference = (option.searchAliases ?? []).find((alias) =>
        latestText.includes(alias.toLocaleLowerCase('vi-VN')),
      ) ?? (latestText.includes(option.name.toLocaleLowerCase('vi-VN')) ? option.name : undefined);
      return matchedReference
        ? [{ groupId: group.groupId, name: option.name, requestFragment: matchedReference, default: option.default }]
        : [];
    }),
  );
  if (matchingChoices.length === 0) return undefined;
  const resolvedChoices = [...new Set(matchingChoices.map((choice) => choice.groupId))].flatMap((groupId) => {
    const groupChoices = matchingChoices.filter((choice) => choice.groupId === groupId);
    if (groupChoices.length === 1) return groupChoices;
    const nonDefaultChoices = groupChoices.filter((choice) => !choice.default);
    return nonDefaultChoices.length === 1 ? nonDefaultChoices : [];
  });
  if (resolvedChoices.length === 0) return undefined;
  if (new Set(resolvedChoices.map((choice) => choice.groupId)).size !== resolvedChoices.length) return undefined;

  return {
    requestFragment: resolvedChoices[0]!.requestFragment,
    itemCode: candidate.code,
    quantity: activeQuantity!,
    replacesItemCodes: [],
    modifierChoices: resolvedChoices.map(({ groupId, name }) => ({ groupId, name })),
  };
}

const rejectedCatalogMutationTools = new Set<ToolName>([
  'updateCart',
  'previewCart',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
]);

function withoutRejectedCatalogMutation(toolCalls: ToolCallRequest[]): ToolCallRequest[] {
  return toolCalls.filter((call) => !rejectedCatalogMutationTools.has(call.toolName));
}

function normalizeCatalogSelectionCalls(
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

  let suggestedCustomerEvidenceItem: {
    itemCode: string;
    name: string;
    sources: Array<'favorite' | 'recent_order'>;
  } | undefined;
  try {
    const latestText = input.state.latestUserMessage.toLocaleLowerCase('vi-VN');
    const candidates = new Map(input.menuCatalogContext?.candidates.map((candidate) => [candidate.code, candidate]) ?? []);
    const comboProposal = input.state.comboConversionProposal ?? (
      input.state.entities && typeof input.state.entities.comboConversionProposal === 'object' &&
      input.state.entities.comboConversionProposal !== null
        ? input.state.entities.comboConversionProposal as Record<string, unknown>
        : undefined
    );
    const proposalSourceItemCodes =
      Array.isArray(comboProposal?.sourceItemCodes) &&
      comboProposal.sourceItemCodes.every((code) => typeof code === 'string')
        ? comboProposal.sourceItemCodes as string[]
        : [];
    const activeCartCodes = new Set([
      ...(input.state.cart?.items.map((item) => item.itemCode) ?? []),
      ...(input.menuCatalogContext?.candidates
        .filter((candidate) => candidate.activeCartItem)
        .map((candidate) => candidate.code) ?? []),
      ...proposalSourceItemCodes,
    ]);
    const selectionCountByFragment = selections.reduce((counts, selection) => {
      const key = selection.requestFragment.toLocaleLowerCase('vi-VN');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
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
        !referencesCatalogName(input.state.latestUserMessage, candidate.name) &&
        !precedingAssistantReferencesCatalogName(input, candidate.name)
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
      if (
        !isActiveCartModifierSelection &&
        hasDirectNamedCandidate &&
        !referencesCatalogName(selection.requestFragment, candidate.name)
      ) {
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

      const requestedAmountMatch = selection.requestFragment.match(/(?:^|\s)(\d+)(?=\s|$)/);
      const requestedAmount = requestedAmountMatch ? Number(requestedAmountMatch[1]) : undefined;
      const compositionAmounts = candidate.unitComposition
        ? Object.values(candidate.unitComposition).filter((amount): amount is number => typeof amount === 'number' && amount > 0)
        : [];
      const compiledQuantity =
        requestedAmount !== undefined &&
        selectionCountByFragment.get(selection.requestFragment.toLocaleLowerCase('vi-VN')) === 1 &&
        compositionAmounts.length === 1 &&
        requestedAmount % compositionAmounts[0]! === 0
          ? requestedAmount / compositionAmounts[0]!
          : selection.quantity;

      const inferredModifierChoices = selection.modifierChoices.length > 0
        ? selection.modifierChoices
        : candidate.modifierGroups.flatMap((group) =>
            group.options
              .filter((option) =>
                (option.searchAliases ?? []).some((alias) =>
                  referencesCatalogName(selection.requestFragment, alias),
                ),
              )
              .map((option) => ({ groupId: group.groupId, name: option.name })),
          );
      if (new Set(inferredModifierChoices.map((choice) => choice.groupId)).size !== inferredModifierChoices.length) {
        throw new Error(`Catalog modifier alias is ambiguous for ${selection.itemCode}`);
      }

      const modifiers = inferredModifierChoices.flatMap((choice) => {
        const group = candidate.modifierGroups.find((candidateGroup) => candidateGroup.groupId === choice.groupId);
        const option = group?.options.find(
          (candidateOption) =>
            candidateOption.name.trim().toLocaleLowerCase('vi-VN') === choice.name.trim().toLocaleLowerCase('vi-VN'),
        );
        if (!option) {
          throw new Error(
            `Catalog modifier choice is not verified for ${selection.itemCode}: ${choice.groupId}/${choice.name}`,
          );
        }
        return option.selectionBundle;
      });
      const uniqueModifiers = [...new Map(
        modifiers.map((modifier) => [`${modifier.groupId}:${modifier.modifierId}`, modifier]),
      ).values()];

      return {
        toolName: 'updateCart',
        arguments: {
          itemCode: selection.itemCode,
          quantity: compiledQuantity,
          ...(uniqueModifiers.length > 0 ? { modifiers: uniqueModifiers } : {}),
        },
      };
    });

    for (const requestFragment of new Set(selections.map((selection) => selection.requestFragment))) {
      const related = selections
        .map((selection, index) => ({ selection, call: compiledAdditions[index]! }))
        .filter(({ selection }) => selection.requestFragment === requestFragment);
      if (related.length <= 1) continue;
      const requestedAmountMatch = requestFragment.match(/(?:^|\s)(\d+)(?=\s|$)/);
      const requestedAmount = requestedAmountMatch ? Number(requestedAmountMatch[1]) : undefined;
      const componentEntries = related.map(({ selection, call }) => {
        const candidate = candidates.get(selection.itemCode);
        const components = Object.entries(candidate?.unitComposition ?? {})
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0);
        return { components, quantity: call.arguments.quantity };
      });
      const componentKey = componentEntries[0]?.components.length === 1
        ? componentEntries[0].components[0]![0]
        : undefined;
      if (
        requestedAmount === undefined ||
        !componentKey ||
        componentEntries.some(({ components, quantity }) =>
          components.length !== 1 || components[0]![0] !== componentKey || typeof quantity !== 'number'
        )
      ) continue;
      const plannedAmount = componentEntries.reduce(
        (total, { components, quantity }) => total + components[0]![1] * (quantity as number),
        0,
      );
      if (plannedAmount !== requestedAmount) {
        throw new Error(`Catalog pack plan does not preserve requested component quantity for: ${requestFragment}`);
      }
    }

    const acceptsVerifiedComboProposal =
      selections.length === 1 &&
      proposalSourceItemCodes.length > 0 &&
      selections[0]?.itemCode === comboProposal?.itemCode &&
      selections[0]?.quantity === comboProposal?.quantity;
    const replacementCodes = [...new Set([
      ...selections.flatMap((selection) => selection.replacesItemCodes),
      ...(acceptsVerifiedComboProposal ? proposalSourceItemCodes : []),
    ])];
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

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function compactPlannerTurns(turns: ConversationTurn[]): Array<Pick<ConversationTurn, 'role' | 'text'>> {
  return turns.slice(-8).map(({ role, text }) => ({ role, text }));
}

function compactPlannerState(state: CommercePlannerState): Record<string, unknown> {
  return {
    latestUserMessage: state.latestUserMessage,
    intent: state.intent,
    userConfirmedOrder: state.userConfirmedOrder,
    ...(state.cart ? { cart: state.cart } : {}),
    ...(state.address ? { address: state.address } : {}),
    ...(state.addressDraft ? { addressDraft: state.addressDraft } : {}),
    ...(state.orderPreview ? { orderPreview: state.orderPreview } : {}),
    ...(state.order ? { order: state.order } : {}),
    ...(state.pendingReorder ? { pendingReorder: state.pendingReorder } : {}),
    ...(state.comboConversionProposal ? { comboConversionProposal: state.comboConversionProposal } : {}),
    ...(state.entities ? { entities: state.entities } : {}),
    ...(state.selectedModifiers ? { selectedModifiers: state.selectedModifiers } : {}),
    ...(state.fulfillment ? { fulfillment: state.fulfillment } : {}),
    ...(state.promotionContext ? { promotionContext: state.promotionContext } : {}),
    ...(state.customerContext ? { customerContext: state.customerContext } : {}),
    ...(state.paymentAttempt ? { paymentAttempt: state.paymentAttempt } : {}),
    ...(state.selectedPaymentMethod ? { selectedPaymentMethod: state.selectedPaymentMethod } : {}),
    ...(state.invoiceRequest ? { invoiceRequest: state.invoiceRequest } : {}),
    ...(state.handoff ? { handoff: state.handoff } : {}),
  };
}

function compactPlannerMenuCatalogContext(context: MenuPlanningContext | undefined) {
  if (!context) return undefined;
  return {
    query: context.query,
    exactQuantityPlans: context.exactQuantityPlans,
    requestedQuantityPlans: context.requestedQuantityPlans,
    candidates: context.candidates.map((candidate) => ({
      code: candidate.code,
      name: candidate.name,
      category: candidate.category,
      description: candidate.description,
      priceVnd: candidate.priceVnd,
      available: candidate.available,
      verifiedForMutation: candidate.verifiedForMutation,
      activeCartItem: candidate.activeCartItem,
      activeCartQuantity: candidate.activeCartQuantity,
      unitComposition: candidate.unitComposition,
      matchedSearchAliases: candidate.matchedSearchAliases,
      customerEvidenceSources: candidate.customerEvidenceSources,
      modifierChoices: candidate.modifierGroups.flatMap((group) =>
        group.options.map((option) => ({
          groupId: group.groupId,
          groupName: group.name,
          name: option.name,
          searchAliases: option.searchAliases,
          priceDeltaVnd: option.priceDeltaVnd,
          selectionBundle: option.selectionBundle,
        })),
      ),
      ...(candidate.fulfillmentAvailability
        ? {
            fulfillmentAvailability: {
              storeId: candidate.fulfillmentAvailability.storeId,
              disposition: candidate.fulfillmentAvailability.disposition,
              available: candidate.fulfillmentAvailability.available,
              reason: candidate.fulfillmentAvailability.reason,
            },
          }
        : {}),
    })),
  };
}

const toolArgumentExamples: Record<ToolName, Record<string, unknown>> = {
  searchMenu: {
    query: '<specific item/category text; omit for full menu discovery>',
  },
  getItemDetails: { code: '<verified_menu_item_code>' },
  getModifierOptions: { code: '<verified_menu_item_code>' },
  updateCart: {
    itemCode: '<verified_menu_item_code>',
    quantity: 1,
    modifiers: [{
      groupId: '<verified_modifier_group_id>',
      modifierId: '<verified_modifier_option_id>',
      quantity: '<verified_option_quantity_or_customer_quantity>',
    }],
  },
  previewCart: {},
  recommendAddOns: {},
  findStores: { city: '<customer-provided city>', district: '<customer-provided district>' },
  checkStoreAvailability: {
    storeId: '<verified_store_id>',
    itemCodes: ['<verified_menu_item_code>'],
    disposition: 'delivery',
  },
  quoteFulfillment: {
    address: {
      label: '<customer-provided address label>',
      line1: '<customer-provided building and street>',
      district: '<customer-provided district>',
      city: '<customer-provided or uniquely provider-resolved city>',
    },
    method: 'delivery',
    itemCodes: ['<verified_menu_item_code>'],
  },
  searchPromotions: {
    query: '<specific promotion text; omit for current active promotion discovery>',
  },
  explainPromotion: { offerId: 'promotion-offer-id' },
  validateVoucher: {
    voucherText: '<customer voucher text>',
    subtotalVnd: 250000,
  },
  getMembershipProfile: {},
  listMembershipRewards: { query: 'đổi quà thành viên' },
  listMembershipWallet: { status: 'active' },
  getMembershipPointHistory: { days: 30 },
  listMembershipTools: { sideEffect: 'voucher_acquisition' },
  listPaymentMethods: {
    query: '<payment method name or omit for all website checkout methods>',
  },
  acquireVoucher: { rewardId: 'reward-discount-10k', confirmed: false },
  redeemReward: {
    voucherId: 'wallet-new-member-25k',
    channel: 'kiosk',
    confirmed: false,
  },
  searchContentPolicy: {
    kind: 'allergen',
    query: '<specific safety/content text; omit for broad policy discovery>',
  },
  answerAllergenQuestion: {
    query: '<specific allergen question; omit for broad allergen evidence>',
  },
  previewOrder: {},
  placeOrder: {},
  getOrderStatus: { orderId: '<verified_order_id>' },
  createPaymentLink: { method: 'zalopay' },
  checkPaymentStatus: { orderId: '<verified_order_id>' },
  collectInvoice: {
    companyName: '<company_name>',
    taxCode: '<tax_code>',
    email: '<invoice_email>',
  },
  handoff: { reasons: ['customer_requested_human'] },
};

const plannerInstructions = [
  'You are a KFC Vietnam ordering tool planner. Return only JSON matching outputSchema.',
  'Keep JSON compact: omit false entity flags, irrelevant context-policy slices, empty arrays, and directResponse when tools are sufficient. Schema defaults supply omitted values.',
  'Choose tools for business facts and side effects; never invent catalog, address, fulfillment, order, payment, promotion, membership, or safety outcomes.',
  'Use planningPatterns as semantic guidance, not scripts. Adapt to the latest message, visible verified state, contextInventory, and menuCatalogContext.',
  'You may receive at most two passes in one turn. Do not repeat a successful current-turn tool call with the same arguments.',
  'contextInventory only reports whether hidden verified state exists; it never supplies commerce values. Activate every needed slice in contextPolicy. If a needed hidden slice is available, do not invent a replacement value.',
  'Return a short natural directResponse for tool-less turns and read-only discovery. When asking for missing information, set entities.asksClarification=true.',
  'For neutral greetings or small talk, set entities.smallTalk=true, use no tools, suppress commerce context, and respond naturally.',
  'For group or budget discovery without a concrete item or category, call searchMenu with no query. For broad best-seller discovery without a concrete item or category, call searchMenu with no query.',
  'Recommendation, budget/group recommendation turns, promotion discovery, and upsell requests must use verified discovery tools; do not answer with prose only. Do not mutate until the customer chooses or accepts a concrete option.',
  'menuCatalogContext is bounded read-only candidate evidence from the current menu API, never as a customer selection. Use only ids found in visible verified state or this context. Never infer catalog codes from examples. Never infer modifier ids from names or examples.',
  'menuCatalogContext candidates marked verifiedForMutation were loaded by the current turn from the fixture-backed menu API and may be used directly in updateCart. The cart API revalidates every id and modifier. Do not call searchMenu again for an explicit candidate already present there.',
  'customerEvidenceSources marks customer-profile context, not consent. source=favorite is authoritative for a profile-preference request; source=recent_order is reorder evidence only. A sole favorite is the match even when the latest text omits product words. Emit catalogSuggestion with decision=suggest and ask confirmation; do not substitute recent-order items or say the favorite is unknown. For a short acceptance after the preceding assistant offered that exact candidate, emit the same catalogSuggestion with decision=accept; the backend compiles the verified updateCart.',
  'When a menu candidate includes fulfillmentAvailability, add it only when available=true. Prefer a compatible available candidate over an unavailable one; if no compatible candidate is available, explain and ask for another choice.',
  'fulfillmentLocationContext is current-turn mocked fulfillment API evidence, not a default address. Use its district and city only when exactly one verifiedForQuote candidate matched customer-provided district evidence from the current query or active addressDraft. Never use it to replace line1 or a different typed address.',
  'Copy each address component supplied in the latest message into entities.addressDraft. Do not put generic labels or missing values there. The graph preserves this draft across the active checkout so a later turn can complete it.',
  'A reference to a saved, old, usual, or previous address is not address line1 and must never be copied into addressDraft. Emit savedAddressDecision with the exact zero-based customerContext.savedAddresses index. Use decision=suggest until that exact address has been presented by the preceding assistant; use decision=accept only for the customer response that accepts that presented candidate.',
  'For an explicit order, preserve every requested item amount exactly and include every updateCart call in this plan. updateCart.quantity is the number of catalog packs, not the number of pieces or drinks inside a pack. When unitComposition is present, calculate the pack quantity that yields the requested component amount; combine compatible pack sizes when needed. Use searchMenu only when the needed item is absent from menuCatalogContext. Cross-check the resulting component totals against the request before returning.',
  'A polite question-form request containing a concrete menu item and quantity is still an explicit selection. Emit its verified catalog selection and updateCart; a missing delivery detail blocks fulfillment only, not the independent cart update.',
  'When one turn combines an explicit menu-item selection with a saved-address reference, emit the verified catalog selection and updateCart in the same plan, and independently emit savedAddressDecision=suggest. Address confirmation blocks fulfillment tools only; it must not suppress the safe cart addition.',
  'Treat each separately requested list item as an independent cart line. Ingredients, drinks, or sides already included inside a combo never satisfy an additional standalone item that the customer also requested.',
  'When a short natural description maps to a reasonable compatible candidate, choose the best fit using verified name, description, price, portion, and modifier compatibility. Ask only when materially different candidates remain unresolved.',
  'menuCatalogContext exposes relevant nested menu options as flat modifierChoices. Use modifierChoices to identify dishes compatible with a preference even when the preference is absent from the product name.',
  'When selecting a modifierChoice, copy its selectionBundle into updateCart.modifiers; keep all entries. Modifier compatibility alone is not consent to a modifier unless the customer requested or accepted it.',
  'If the active cart has one item and the customer asks to change one of its configurable options, use that verified item code. Accepted add, remove, replace, upsize, or combo-conversion turns must include updateCart and a cart preview when useful.',
  'When the requested replacement is an available modifierChoice on an active cart item, update that same item with the exact modifier selectionBundle. Do not remove the parent item or add a standalone catalog item instead.',
  'A polite question-form request to change an active cart item is still an explicit cart action. When exactly one activeCartItem has an exact requested modifierChoice, set cartMutationConfirmed=true, emit catalogSelections for that active item and modifier, and do not ask clarification.',
  'For destructive or ambiguous cart edits, activate cart context and set entities.cartMutationConfirmed=true only when the target is unambiguous; otherwise ask for clarification without mutation.',
  'Set entities.freshShoppingJourney=true when a new food selection starts a journey separate from a completed order. Do not reuse completed-order cart, fulfillment, address, invoice, or payment state for it.',
  'A delivery address is complete only when line1 and district come from the customer, and city either comes from the customer or exactly one fulfillmentLocationContext candidate. Derive the label only from customer-provided building or street text. Otherwise ask for missing fields and do not quote, preview, or place.',
  'A missing or partial address blocks only fulfillment and order tools. Still execute any independent, explicit, fixture-verified menu or cart request in the same turn, then ask for the missing address fields.',
  'For an active cart with a complete typed or explicitly accepted saved address, call quoteFulfillment with verified cart item codes. Never substitute a saved, example, inferred, or default address.',
  'Order placement requires verified cart, confirmed fulfillment, and explicit confirmation. Set entities.orderConfirmed=true and include previewOrder then placeOrder in the confirmation plan.',
  'Collect an invoice only from complete company name, tax code, and email. Missing invoice fields require clarification; complete invoice details may be combined with an independently valid confirmed checkout.',
  'Payment availability requires listPaymentMethods. Never substitute an unsupported method. Create a link only after order creation for the uniquely selected supported method; a later method change replaces the old pending attempt.',
  'A payment-completion or failure claim requires checkPaymentStatus for the verified order. Reflect only the returned status.',
  'A supplied voucher code requires validateVoucher; broad promotion discovery uses searchPromotions. Claims require successful tool evidence.',
  'Order status, delivery status, cancellation, and post-order edits require getOrderStatus when a verified order id exists; do not ask the user for an order id when verified state already has one.',
  'Previous-order reorder requires explicit confirmation, recentOrder context, and verified item codes. Different-recipient or ambiguous reorder requests require clarification before mutation.',
  'Membership requests use getMembershipProfile before dependent reads. If the same turn explicitly adds a verified item, include updateCart as well.',
  'Allergen or ingredient-safety claims require content-policy tools. Modifier compatibility is ordering evidence, not allergen certainty.',
  'Use handoff only for explicit human requests, active complaints, persistent verified payment failure, safety escalation, or abnormal large orders; never for ordinary cart, loyalty, or reorder work.',
  'When the customer accepts replacing separate items with a verified combo, update the cart, retrieve modifier options when needed, and return a cart preview without re-adding removed items.',
].join(' ');

const catalogOrderingPlannerInstructions = [
  'You are a KFC Vietnam catalog-ordering tool planner. Return only JSON matching outputSchema.',
  'Keep JSON compact: omit false entity flags, irrelevant context-policy slices, empty arrays, and directResponse when tools are sufficient. Schema defaults supply omitted values.',
  'When priorPlanForReview is present, audit its clarification against the latest request and catalog evidence. Keep clarification only if no candidate satisfies a stated constraint or tied candidates differ on a stated constraint; otherwise return the corrected selection and updateCart plan.',
  'An incomplete or delivery-only addressDraft never suppresses independent explicit menu selections. Preserve supplied address fields, omit fulfillment tools until the address is complete, and still return every verified cart selection in the same plan.',
  'Use tools for every commerce fact or side effect. Never invent menu ids, modifier ids, quantities, availability, address fields, fees, promotions, payment, or order values.',
  'Use only availableTools and current fixture-backed menuCatalogContext evidence. A candidate is not selected merely because it appears in that context.',
  'customerEvidenceSources marks customer-profile context, not consent. source=favorite is authoritative for a profile-preference request; source=recent_order is reorder evidence only. A sole favorite is the match even when the latest text omits product words. Emit catalogSuggestion with decision=suggest, no updateCart, and ask confirmation; do not substitute recent-order items or say the favorite is unknown. For a short acceptance after the preceding assistant offered that exact candidate, emit the same catalogSuggestion with decision=accept; the backend compiles the verified updateCart.',
  'First divide the latest request into independent requested item phrases. Match each phrase independently; never use a descriptor belonging to one requested item to choose a different requested item.',
  'Treat product-type words in each requested phrase as required constraints. A standalone dish cannot satisfy a phrase requesting a bundle or combo, and an included component never consumes another independently requested line.',
  'For every explicit requested item phrase, preserve its exact requested amount and choose a candidate only when its name, description, unitComposition, and explicitly selected modifiers satisfy every descriptor in that same phrase. updateCart.quantity counts catalog packs. Use unitComposition and priceVnd to choose the lowest-total-price exact combination of compatible pack sizes, so the resulting piece or drink total equals the requested amount.',
  'When exactQuantityPlans contains a target and component matching a requested phrase, copy every listed itemCode and quantity for that phrase. These plans are mocked menu-API calculations and must not be recomputed or partially copied.',
  'matchedSearchAliases are provider-resolved menu or modifier aliases found verbatim in the current query. Treat them as equivalent catalog wording; when an alias belongs to a modifierChoice, select that exact modifierChoice.',
  'If a requested descriptor appears in a candidate modifierChoices name, that candidate supports the descriptor. Copy that modifierChoice selectionBundle exactly into updateCart.modifiers. Never search again or claim the descriptor is unavailable while one compatible available candidate and its modifierChoice are visible.',
  'Evaluate ambiguity only from constraints the customer actually stated. Extra included components, category, price, or serving size are not ambiguities unless the customer constrained them.',
  'When multiple available candidates satisfy every stated constraint for one requested phrase, you MUST choose the lowest priceVnd compatible candidate. Set asksClarification only when no candidate satisfies the phrase or tied candidates differ on a customer-stated constraint. Never ask the customer to distinguish candidates using constraints they did not state.',
  'Prefer the candidate whose name adds the fewest unmatched product-type tokens to the requested phrase. When one candidate name directly matches the requested item and another wraps it inside a broader product, select the direct item unless the customer requested the broader product.',
  'When exactly one available candidate satisfies every stated descriptor for an item phrase, select it with updateCart. Do not search or ask the customer to choose among unavailable candidates or candidates that fail a stated descriptor.',
  'For every explicit requested cart line, emit one catalogSelections entry and one updateCart call. requestFragment must be the exact contiguous item phrase from the latest message; itemCode and quantity must match that phrase.',
  'A polite question-form request containing a concrete menu item and quantity is still an explicit selection. Emit its verified catalog selection and updateCart; a missing delivery detail blocks fulfillment only, not the independent cart update.',
  'When one turn combines an explicit menu-item selection with a saved-address reference, emit the verified catalog selection and updateCart in the same plan, and independently emit savedAddressDecision=suggest. Address confirmation blocks fulfillment tools only; it must not suppress the safe cart addition.',
  'catalogSelections.modifierChoices is mandatory for every requested descriptor represented by a modifierChoices name rather than the candidate name or description. Copy its exact groupId and name. The backend compiles the verified selectionBundle.',
  'For an explicit replacement of active-cart items, put their exact visible item codes in catalogSelections.replacesItemCodes. Use an empty array for additions that replace nothing.',
  'A configurable-option change is not a parent-item replacement: when the requested option is a modifierChoice on an active item, select the active item with that modifierChoice and keep replacesItemCodes empty.',
  'A polite question-form request to change a selected cart option is still an explicit action when one exact activeCartItem modifierChoice matches; set cartMutationConfirmed=true and do not ask clarification.',
  'Emit one updateCart call for each separately requested cart line. Food or drinks included in a combo never replace an additional standalone line requested separately.',
  'When fulfillmentAvailability is present, add only candidates with available=true. Prefer a compatible available candidate; if no candidate satisfies the entire item phrase, ask a focused clarification and do not substitute a partial match.',
  'Open-ended menu, budget, group, recommendation, and upsell requests use discovery tools and do not mutate until the customer chooses a concrete option.',
  'Copy address fields from the latest message into entities.addressDraft. A provider candidate may supply only its uniquely matched canonical district or city; it never supplies line1 and is never a default address.',
  'A reference to a saved or previous address is not a typed address field. Emit savedAddressDecision with the verified zero-based saved-address index; suggest it first, and accept it only after the preceding assistant presented that exact candidate.',
  'A missing or partial address blocks fulfillment and order tools only. Complete independent verified cart work, then ask for the missing address fields.',
  'For a complete address and verified cart, quoteFulfillment uses exact cart item codes. Never place an order or create a payment link without confirmed fulfillment and explicit order confirmation.',
  'Return a short directResponse only for clarification or read-only discovery. Do not repeat a successful current-turn call with identical arguments.',
].join(' ');

const activeCheckoutPlannerInstructions = [
  'You are a KFC Vietnam checkout tool planner. Return only JSON matching outputSchema.',
  'Keep JSON compact: omit false entity flags, irrelevant context-policy slices, empty arrays, and directResponse when tools are sufficient. Schema defaults supply omitted values.',
  'When priorPlanForReview is present, audit it against the latest request and verified checkout state. In particular, if an older partial address draft exists but the latest turn supplies no address fields, decide from the latest request whether to keep that draft, suggest a verified saved address, or leave address intent unchanged; never silently mix those sources.',
  'Use tools for every commerce fact or side effect. Never invent menu, modifier, cart, address, store, availability, fee, payment, promotion, invoice, or order values.',
  'Use only availableTools. contextInventory reports hidden verified state; activate each needed slice in contextPolicy and never replace hidden values.',
  'menuCatalogContext is current fixture-backed menu API evidence. Use only verifiedForMutation ids and exact quantities. Relevant nested options are flattened as modifierChoices; copy a selected modifierChoice selectionBundle exactly.',
  'customerEvidenceSources marks customer-profile context, not consent. source=favorite is authoritative for a profile-preference request; source=recent_order is reorder evidence only. A sole favorite is the match even when the latest text omits product words. Emit catalogSuggestion with decision=suggest and ask confirmation. For a short acceptance after the preceding assistant offered that exact candidate, emit the same catalogSuggestion with decision=accept; the backend compiles the verified updateCart.',
  'Treat each separately requested list item as an independent cart line; contents included inside a combo never replace an additional standalone item requested by the customer.',
  'When fulfillmentAvailability is present, add only candidates with available=true. Prefer a compatible available candidate; ask for another choice if none is available.',
  'fulfillmentLocationContext is mocked provider evidence, never a default address. Use district/city only from exactly one verifiedForQuote candidate matched from the current query or active addressDraft.',
  'Copy only address fields actually present in the latest message into entities.addressDraft. line1 is the customer-provided building, number, street, ward, or other local-address text; when that text is present, copy it verbatim into addressDraft.line1 and quoteFulfillment.address.line1. Never create a generic label or replace line1. A partial address blocks fulfillment/order tools only, not independent verified cart work.',
  'A saved-address reference is not line1. Emit savedAddressDecision with the exact zero-based saved-address index; decision=suggest before confirmation and decision=accept only after the preceding assistant presented that exact address.',
  'For an active cart plus complete address, quoteFulfillment must use the exact verified cart codes. Missing line1, district, or uniquely verified city requires clarification.',
  'Explicit cart changes use updateCart. When catalogSelections are present, use replacesItemCodes for explicitly replaced active-cart lines; destructive or ambiguous targets require confirmation or clarification. A new food journey clears completed-order checkout state.',
  'When the requested replacement is an available modifierChoice on an active cart item, update that same item with the exact modifier choice and keep replacesItemCodes empty. Do not remove the parent item or substitute a standalone item.',
  'A polite question-form request to change an active cart item is still an explicit cart action. When exactly one activeCartItem has an exact requested modifierChoice, set cartMutationConfirmed=true, emit catalogSelections for that active item and modifier, and do not ask clarification.',
  'Order placement requires verified cart, successful fulfillment, and explicit current-turn confirmation. Set entities.orderConfirmed=true; use previewOrder then placeOrder. Create a payment link only for the uniquely selected supported method after order creation.',
  'When the same confirmation message supplies complete invoice fields, include collectInvoice with the exact companyName, taxCode, and email before previewOrder and placeOrder. Include createPaymentLink only when prior verified payment evidence identifies one supported selected method.',
  'Payment availability uses listPaymentMethods and never substitutes methods. Voucher codes use validateVoucher. Use collectInvoice only when companyName, taxCode, and email are all non-empty in the latest message; otherwise ask for the missing fields with no collectInvoice call. Allergen claims require content-policy tools.',
  'Use handoff only for an explicit human request, active complaint, verified persistent payment failure, safety escalation, or abnormal large order.',
  'Return a short directResponse only for clarification or read-only results. Do not repeat a successful current-turn call with identical arguments.',
].join(' ');

const planningPatterns = [
  {
    situation: 'social turn without a commerce request',
    toolSequence: [],
    entities: ['smallTalk'],
  },
  {
    situation: 'explicit item selection',
    toolSequence: ['updateCart directly from verified menuCatalogContext; otherwise searchMenu'],
    entities: ['cartMutationRequested'],
  },
  {
    situation: 'open-ended menu, budget, group, or recommendation discovery',
    toolSequence: ['searchMenu', 'optional recommendAddOns'],
    constraints: ['do not mutate until a concrete choice is accepted'],
  },
  {
    situation: 'preference represented by catalog modifier compatibility',
    toolSequence: ['searchMenu', 'getModifierOptions after item selection', 'updateCart after explicit modifier acceptance'],
    constraints: ['use only verified flat modifier ids and quantities'],
  },
  {
    situation: 'accepted upsell, replacement, removal, or size change',
    toolSequence: ['updateCart', 'previewCart'],
    context: ['cart', 'menuSearchResults'],
  },
  {
    situation: 'complete current-turn delivery address for an active cart',
    toolSequence: ['quoteFulfillment', 'optional checkStoreAvailability'],
    context: ['cart', 'fulfillment'],
    constraints: ['copy the address exactly; do not substitute saved or example values'],
  },
  {
    situation: 'missing or partial delivery address',
    toolSequence: ['complete independent verified menu/cart work; no fulfillment or order tools'],
    entities: ['asksClarification'],
    constraints: ['do not quote fulfillment, preview an order, or place an order'],
  },
  {
    situation: 'explicit order confirmation with verified cart and fulfillment',
    toolSequence: ['previewOrder', 'placeOrder', 'createPaymentLink only for a verified supported selected method'],
    entities: ['orderConfirmed'],
    context: ['cart', 'fulfillment', 'payment'],
  },
  {
    situation: 'complete invoice details supplied during checkout',
    toolSequence: ['collectInvoice', 'continue any independently valid confirmed checkout tools'],
  },
  {
    situation: 'payment-method availability',
    toolSequence: ['listPaymentMethods'],
    constraints: ['never create or substitute a link before order placement'],
  },
  {
    situation: 'customer reports payment completion or failure',
    toolSequence: ['checkPaymentStatus'],
    context: ['order', 'payment'],
    constraints: ['reflect only the returned status'],
  },
  {
    situation: 'voucher supplied versus broad promotion discovery',
    toolSequence: ['validateVoucher for a supplied code', 'searchPromotions for broad discovery'],
  },
  {
    situation: 'order status, delivery status, cancellation, or post-order edit',
    toolSequence: ['getOrderStatus', 'then only tools justified by verified status'],
    context: ['order', 'payment'],
  },
  {
    situation: 'explicitly confirmed previous-order reorder',
    toolSequence: ['updateCart with verified prior item codes', 'previewCart'],
    context: ['recentOrder', 'cart'],
    entities: ['reorderConfirmed'],
  },
  {
    situation: 'membership request with an item-selection request',
    toolSequence: ['updateCart for a verified selected item', 'getMembershipProfile', 'relevant membership reads'],
    context: ['membership', 'cart', 'menuSearchResults'],
  },
  {
    situation: 'allergen or ingredient-safety claim',
    toolSequence: ['searchContentPolicy', 'answerAllergenQuestion'],
    constraints: ['do not convert modifier compatibility into allergen certainty'],
  },
  {
    situation: 'explicit human request, active complaint, persistent verified payment failure, or abnormal large order',
    toolSequence: ['handoff when justified by verified state and intent'],
  },
] satisfies Array<{
  situation: string;
  toolSequence: string[];
  entities?: string[];
  context?: string[];
  constraints?: string[];
}>;

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

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);

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
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
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
    if (!response.ok) {
      const message = typeof body.error?.message === 'string' ? body.error.message : response.statusText;
      throw new Error(`OpenAI tool planning failed: ${message}`);
    }

    const text = extractText(body);
    if (!text) throw new Error('OpenAI tool planning returned no text');
    const parsed = plannerOutputSchema.parse(normalizePlannerOutputEnvelope(JSON.parse(text)));
    const recoveredActiveCartModifierSelection = recoverExplicitActiveCartModifierSelection(input, parsed);
    const catalogSelections = recoveredActiveCartModifierSelection
      ? [recoveredActiveCartModifierSelection]
      : parsed.catalogSelections;
    const validatedToolCalls = validateToolCalls(parsed.toolCalls, input.availableTools);
    const normalizedCatalogCalls = normalizeCatalogSelectionCalls(input, catalogSelections, validatedToolCalls);
    const normalizedCatalogSuggestion = catalogSelections.length === 0
      ? normalizeCatalogSuggestion(input, parsed.catalogSuggestion)
      : undefined;
    const acceptedCatalogSuggestion =
      normalizedCatalogSuggestion?.plan.decision === 'accept' &&
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
      delete normalizedEntities.addressText;
    }
    const normalizedToolCalls = acceptedCatalogSuggestion
      ? [
          ...withoutRejectedCatalogMutation(normalizedCatalogCalls.toolCalls),
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
