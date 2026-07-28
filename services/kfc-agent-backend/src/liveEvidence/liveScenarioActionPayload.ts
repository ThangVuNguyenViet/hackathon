import { z } from 'zod';
import {
  kfcCartDraftPayloadSchema,
  kfcModifierDraftPayloadSchema,
  kfcSmartMenuBatchPayloadSchema,
} from '../api/routeHandlerContracts.js';
import { deliveryAddressUpdateSchema } from '../domain/customerCommand.js';

const itemSelectionSchema = z
  .object({
    itemCode: z.string().trim().min(1).max(128),
    quantity: z.number().int().min(1).max(99),
  })
  .strict();

const clientGeneratedActionIds = new Set([
  'add_item',
  'add_items',
  'apply_modifiers',
  'continue_to_fulfillment',
  'submit_address',
  'update_cart',
]);

export function liveScenarioActionPayloadMatchesRenderedAttachment(input: {
  attachment: unknown;
  actionId: string;
  payload?: Record<string, unknown>;
}): boolean {
  if (!isRecord(input.attachment) || input.attachment.status !== 'active') {
    return false;
  }
  const actions = Array.isArray(input.attachment.actions)
    ? input.attachment.actions
    : [];
  const matchingActions = actions.filter(
    (candidate) => isRecord(candidate) && candidate.id === input.actionId,
  );
  if (matchingActions.length !== 1 || !isRecord(matchingActions[0])) {
    return false;
  }
  const actionSpec = matchingActions[0];
  if (input.attachment.widgetKind === 'recommendationOffer') {
    return (
      (input.actionId === 'recommendation_dismiss' ||
        input.actionId.startsWith('recommendation_select:')) &&
      input.payload === undefined
    );
  }
  if (!clientGeneratedActionIds.has(input.actionId)) {
    return input.payload === undefined;
  }
  if (
    input.payload === undefined ||
    !containsExactBindings(input.payload, actionSpec.payload)
  ) {
    return false;
  }
  const data = isRecord(input.attachment.data) ? input.attachment.data : {};
  switch (input.actionId) {
    case 'add_items': {
      if (input.attachment.widgetKind !== 'smartMenuPicker') return false;
      const parsed = kfcSmartMenuBatchPayloadSchema.safeParse(input.payload);
      const allowedCodes = uniqueStringField(data.items, 'code');
      return (
        parsed.success &&
        allowedCodes !== undefined &&
        parsed.data.items.every(({ itemCode }) => allowedCodes.has(itemCode))
      );
    }
    case 'add_item': {
      if (input.attachment.widgetKind !== 'productDetailCard') return false;
      const parsed = itemSelectionSchema.safeParse(input.payload);
      const allowedCodes = uniqueStringField(data.items, 'code');
      return (
        parsed.success &&
        allowedCodes?.size === 1 &&
        allowedCodes.has(parsed.data.itemCode)
      );
    }
    case 'update_cart':
    case 'continue_to_fulfillment': {
      if (input.attachment.widgetKind !== 'cartBuilder') return false;
      const parsed = kfcCartDraftPayloadSchema.safeParse(input.payload);
      const cart = isRecord(data.cart) ? data.cart : {};
      const allowedCodes = uniqueStringField(cart.items, 'itemCode');
      return (
        parsed.success &&
        allowedCodes !== undefined &&
        parsed.data.items.length === allowedCodes.size &&
        parsed.data.items.every(({ itemCode }) => allowedCodes.has(itemCode)) &&
        (input.actionId !== 'continue_to_fulfillment' ||
          parsed.data.items.some(({ quantity }) => quantity > 0))
      );
    }
    case 'apply_modifiers': {
      if (input.attachment.widgetKind !== 'modifierPicker') return false;
      const parsed = kfcModifierDraftPayloadSchema.safeParse(input.payload);
      const tree = isRecord(data.modifierTree) ? data.modifierTree : {};
      return parsed.success && modifierDraftMatchesTree(parsed.data, tree);
    }
    case 'submit_address':
      return (
        input.attachment.widgetKind === 'addressFulfillmentCheck' &&
        isRecord(data.addressDraft) &&
        deliveryAddressUpdateSchema.safeParse(input.payload).success
      );
  }
  return false;
}

function containsExactBindings(
  candidate: Record<string, unknown>,
  required: unknown,
): boolean {
  if (required === undefined) return true;
  if (!isRecord(required)) return false;
  return Object.entries(required).every(
    ([key, value]) =>
      Object.hasOwn(candidate, key) &&
      canonicalJson(candidate[key]) === canonicalJson(value),
  );
}

function uniqueStringField(
  value: unknown,
  field: string,
): Set<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate[field] !== 'string' ||
      values.has(candidate[field])
    ) {
      return undefined;
    }
    values.add(candidate[field]);
  }
  return values;
}

function modifierDraftMatchesTree(
  draft: z.infer<typeof kfcModifierDraftPayloadSchema>,
  tree: Record<string, unknown>,
): boolean {
  if (draft.itemCode !== tree.itemCode) return false;
  const selections = new Map(
    draft.selections.map((selection) => [
      selection.groupId,
      selection.modifierId,
    ]),
  );
  const visitedGroups = new Set<string>();
  const visitGroups = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    for (const rawGroup of value) {
      if (!isRecord(rawGroup) || typeof rawGroup.groupId !== 'string') {
        return false;
      }
      if (visitedGroups.has(rawGroup.groupId)) return false;
      visitedGroups.add(rawGroup.groupId);
      const min =
        typeof rawGroup.min === 'number' && Number.isInteger(rawGroup.min)
          ? rawGroup.min
          : 0;
      if (min > 1) return false;
      const modifierId = selections.get(rawGroup.groupId);
      if (modifierId === undefined) {
        if (min > 0) return false;
        continue;
      }
      if (!Array.isArray(rawGroup.options)) return false;
      const matches = rawGroup.options.filter(
        (option) => isRecord(option) && option.modifierId === modifierId,
      );
      if (matches.length !== 1 || !isRecord(matches[0])) return false;
      if (matches[0].modifierGroups !== undefined) {
        if (!visitGroups(matches[0].modifierGroups)) return false;
      }
    }
    return true;
  };
  return (
    visitGroups(tree.modifierGroups) &&
    draft.selections.every(({ groupId }) => visitedGroups.has(groupId))
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
