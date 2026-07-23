import type { AgentGraphState } from "../graph/state.js";
import type {
  ModifierSelectionInput,
  VerifiedCollectionSnapshot,
} from "./types.js";

export function activeMenuSnapshotContaining(
  state: AgentGraphState | undefined,
  itemCode: string,
): VerifiedCollectionSnapshot<{ code: string }> | undefined {
  for (const toolName of ["searchMenu", "recommendAddOns"] as const) {
    const key = state?.activeCollectionKeys?.[toolName];
    const snapshots = state?.verifiedCollections?.[toolName] as
      Record<
        string,
        VerifiedCollectionSnapshot<{ code: string }>
      > | undefined;
    const snapshot = key ? snapshots?.[key] : undefined;
    if (snapshot?.result.items.some((item) => item.code === itemCode)) {
      return snapshot;
    }
  }
  return undefined;
}

export function itemCodeIsVerified(
  state: AgentGraphState | undefined,
  itemCode: string,
): boolean {
  return Boolean(
    state?.cart?.items.some((item) => item.itemCode === itemCode) ||
      activeMenuSnapshotContaining(state, itemCode),
  );
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" &&
      Number.isInteger(number) &&
      number > 0
    ? number
    : undefined;
}

export function authoritativeModifiers(
  state: AgentGraphState | undefined,
  itemCode: string,
  selections: Array<{
    groupId: string;
    modifierId: string;
    quantity: number | null;
  }>,
): ModifierSelectionInput[] | undefined {
  if (selections.length === 0) return [];
  const tree = state?.menuModifierOptions;
  if (!tree || tree.itemCode !== itemCode) return undefined;

  type ModifierGroup = (typeof tree.modifierGroups)[number];
  const groups = new Map<string, ModifierGroup>();
  const visit = (nested: ModifierGroup[]): void => {
    for (const group of nested) {
      groups.set(group.groupId, group);
      for (const option of group.options) visit(option.modifierGroups);
    }
  };
  visit(tree.modifierGroups);

  const resolved: ModifierSelectionInput[] = [];
  for (const selection of selections) {
    const group = groups.get(selection.groupId);
    const option = group?.options.find(
      (candidate) => candidate.modifierId === selection.modifierId,
    );
    if (!group || !option) return undefined;
    const optionQuantity = positiveInteger(option.quantity);
    const groupMin = positiveInteger(group.min);
    const groupMax = positiveInteger(group.max);
    const quantity = selection.quantity ??
      optionQuantity ??
      (groupMin !== undefined && groupMin === groupMax
        ? groupMin
        : undefined);
    if (quantity === undefined) return undefined;
    resolved.push({
      groupId: group.groupId,
      groupName: group.name,
      modifierId: option.modifierId,
      modifierName: option.name,
      priceDeltaVnd: option.priceDeltaVnd,
      quantity,
    });
  }
  return resolved;
}
