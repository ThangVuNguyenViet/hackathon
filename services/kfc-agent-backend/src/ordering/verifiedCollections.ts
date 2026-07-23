import type { MenuItem } from '../domain/types.js';
import { digestCommerceAction } from './approvalReceipt.js';
import type {
  CollectionScope,
  CollectionToolName,
  VerifiedCollectionResult,
  VerifiedCollectionSnapshot,
  VerifiedCollectionStore,
} from './types.js';

export function normalizedCollectionScope(scope: CollectionScope): CollectionScope {
  if (scope.scope === 'all') return scope;
  return {
    scope: 'filtered',
    query: scope.query.trim().normalize('NFKC').toLocaleLowerCase('vi-VN'),
  };
}

export function verifiedCollectionKey(scope: CollectionScope): string {
  const normalized = normalizedCollectionScope(scope);
  return normalized.scope === 'all'
    ? 'all'
    : `filtered:${encodeURIComponent(normalized.query)}`;
}

export async function buildVerifiedCollectionSnapshot<Item>(input: {
  items: Item[];
  scope: CollectionScope;
  providerRevision: string;
  total?: number;
  complete?: boolean;
  cursor?: string;
}): Promise<VerifiedCollectionSnapshot<Item>> {
  const scope = normalizedCollectionScope(input.scope);
  const result: VerifiedCollectionResult<Item> = {
    items: input.items,
    total: input.total ?? input.items.length,
    returned: input.items.length,
    complete: input.complete ?? input.cursor === undefined,
    scope,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
  const key = verifiedCollectionKey(scope);
  return {
    key,
    revision: await digestCommerceAction({ key, result }),
    providerRevision: input.providerRevision,
    result,
  };
}

export function replaceVerifiedCollection(
  store: VerifiedCollectionStore | undefined,
  toolName: CollectionToolName,
  snapshot: VerifiedCollectionSnapshot<unknown>,
): VerifiedCollectionStore {
  return {
    ...(store ?? {}),
    [toolName]: {
      ...((store?.[toolName] as Record<string, VerifiedCollectionSnapshot<unknown>> | undefined) ?? {}),
      [snapshot.key]: snapshot,
    },
  };
}

export function latestVerifiedCollection<Item>(
  store: VerifiedCollectionStore | undefined,
  toolName: CollectionToolName,
  scope: CollectionScope,
): VerifiedCollectionSnapshot<Item> | undefined {
  return (store?.[toolName] as Record<string, VerifiedCollectionSnapshot<Item>> | undefined)?.[
    verifiedCollectionKey(scope)
  ];
}

export interface CompleteMenuTextProjection {
  chunks: string[];
  itemCodes: string[];
  complete: boolean;
}

/**
 * Structural transport projection only. The agent owns surrounding prose.
 */
export function projectVerifiedMenuCollectionToText(
  collection: VerifiedCollectionResult<MenuItem>,
  maxChunkCharacters = 1_800,
): CompleteMenuTextProjection {
  if (!Number.isInteger(maxChunkCharacters) || maxChunkCharacters < 200) {
    throw new Error('Menu text projection chunk size must be an integer of at least 200 characters');
  }
  const chunks: string[] = [];
  let current = '';
  let currentCategory: string | undefined;

  for (const item of collection.items) {
    const categoryLine = item.category === currentCategory ? '' : `${item.category}\n`;
    const itemLine = `${item.name} | ${new Intl.NumberFormat('vi-VN').format(item.priceVnd)} VND | ${item.code}\n`;
    const next = `${categoryLine}${itemLine}`;
    if (current.length > 0 && current.length + next.length > maxChunkCharacters) {
      chunks.push(current.trimEnd());
      current = '';
      currentCategory = undefined;
    }
    if (item.category !== currentCategory) {
      current += `${item.category}\n`;
      currentCategory = item.category;
    }
    current += itemLine;
  }
  if (current.length > 0) chunks.push(current.trimEnd());

  return {
    chunks,
    itemCodes: collection.items.map((item) => item.code),
    complete: collection.complete && collection.returned === collection.total,
  };
}
