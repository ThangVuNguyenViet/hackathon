import type { CurrentTurnResponseEvidence } from '../agent/modelPublicationProjection.js';
import {
  projectCollectionResult,
  projectMenuItem,
  projectMenuModifierOptions,
} from '../agent/modelPublicationStateProjection.js';
import type { MenuItem } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { canonicalJson, stateRevision } from '../graph/turnSupport.js';
import type {
  ToolName,
  ToolTraceEntry,
  VerifiedCollectionResult,
} from '../ordering/types.js';

export const CATALOG_MEDIA_INTENT_SCHEMA_VERSION =
  'kfc-catalog-media-intent-v1' as const;

export interface CatalogMediaIntentItem {
  key: string;
  imageUrl: string;
  title: string;
}

interface CatalogMediaIntentIdentity {
  schemaVersion: typeof CATALOG_MEDIA_INTENT_SCHEMA_VERSION;
  intentId: string;
  toolName: Extract<
    ToolName,
    'searchMenu' | 'getItemDetails' | 'getModifierOptions' | 'recommendAddOns'
  >;
  toolCallId: string;
  evidenceId: string;
  currentTurnRevision: string;
  activeVerifiedRevision: string;
}

export type CatalogMediaIntent = CatalogMediaIntentIdentity &
  (
    | {
        outcome: 'selected';
        media: CatalogMediaIntentItem[];
      }
    | {
        outcome: 'text_only';
        media?: never;
      }
  );

type CatalogMediaToolName = CatalogMediaIntentIdentity['toolName'];

export interface SelectCatalogMediaIntentInput {
  state: AgentGraphState;
  currentTurnToolTrace: readonly ToolTraceEntry[];
  currentTurnResponseEvidence: readonly CurrentTurnResponseEvidence[];
  citedEvidenceIds: readonly string[];
  authorityDigest: string;
  currentTurnRevision: string;
}

export async function selectCatalogMediaIntent(
  input: SelectCatalogMediaIntentInput,
): Promise<CatalogMediaIntent | undefined> {
  const citedEvidenceIds = new Set(input.citedEvidenceIds);
  for (
    let index = input.currentTurnToolTrace.length - 1;
    index >= 0;
    index -= 1
  ) {
    const trace = input.currentTurnToolTrace[index];
    if (!trace?.ok || !isCatalogMediaToolName(trace.toolName)) continue;
    const audit = trace.publicationEvidenceAudit;
    if (
      !audit ||
      audit.schemaVersion !== 'kfc-tool-trace-publication-audit-v2' ||
      audit.executionOutcome !== 'success' ||
      audit.toolName !== trace.toolName ||
      audit.authorityDigest !== input.authorityDigest ||
      audit.currentTurnRevision !== input.currentTurnRevision ||
      !citedEvidenceIds.has(audit.evidenceId)
    ) {
      continue;
    }
    const evidence = input.currentTurnResponseEvidence.find(
      (entry) =>
        entry.evidenceId === audit.evidenceId &&
        entry.digest === audit.evidenceDigest &&
        entry.toolCallId === audit.toolCallId &&
        entry.toolName === trace.toolName &&
        entry.executionOutcome === 'success' &&
        entry.authorityDigest === input.authorityDigest &&
        entry.currentTurnRevision === input.currentTurnRevision,
    );
    if (!evidence) continue;

    const selection = await activeSelectionFor({
      toolName: trace.toolName,
      arguments: trace.arguments,
      evidenceValue: evidence.value,
      state: input.state,
    });
    if (!selection) continue;
    const identity = {
      schemaVersion: CATALOG_MEDIA_INTENT_SCHEMA_VERSION,
      toolName: trace.toolName,
      toolCallId: audit.toolCallId,
      evidenceId: audit.evidenceId,
      currentTurnRevision: input.currentTurnRevision,
      activeVerifiedRevision: selection.activeVerifiedRevision,
    } as const;
    const media = selection.items
      .flatMap((entry, mediaIndex) => catalogMediaItem(entry, mediaIndex))
      .slice(0, 3);
    const outcome =
      selection.allowMedia && media.length > 0
        ? { outcome: 'selected' as const, media }
        : { outcome: 'text_only' as const };
    return {
      ...identity,
      intentId: await stateRevision({ ...identity, outcome }),
      ...outcome,
    };
  }
  return undefined;
}

async function activeSelectionFor(input: {
  toolName: CatalogMediaToolName;
  arguments: Record<string, unknown>;
  evidenceValue: unknown;
  state: AgentGraphState;
}): Promise<
  | {
      activeVerifiedRevision: string;
      items: MenuItem[];
      allowMedia: boolean;
    }
  | undefined
> {
  switch (input.toolName) {
    case 'searchMenu': {
      const active = activeCollection(input.state, 'searchMenu');
      if (
        !active ||
        !sameValue(
          projectCollectionResult('searchMenu', active.result),
          input.evidenceValue,
        )
      )
        return undefined;
      const allowMedia =
        active.result.scope.scope === 'filtered' &&
        input.arguments.purpose === 'recommend' &&
        !broadCatalogBrowseQuery(active.result.scope.query);
      return {
        activeVerifiedRevision: active.revision,
        items: active.result.items,
        allowMedia,
      };
    }
    case 'recommendAddOns': {
      const active = activeCollection(input.state, 'recommendAddOns');
      if (
        !active ||
        !sameValue(
          projectCollectionResult('recommendAddOns', active.result),
          input.evidenceValue,
        )
      )
        return undefined;
      return {
        activeVerifiedRevision: active.revision,
        items: active.result.items,
        allowMedia: true,
      };
    }
    case 'getItemDetails': {
      const detail = input.state.menuItemDetail;
      if (!detail || !sameValue(projectMenuItem(detail), input.evidenceValue))
        return undefined;
      return {
        activeVerifiedRevision: await stateRevision(projectMenuItem(detail)),
        items: [detail],
        allowMedia: true,
      };
    }
    case 'getModifierOptions': {
      const options = input.state.menuModifierOptions;
      if (
        !options ||
        !sameValue(projectMenuModifierOptions(options), input.evidenceValue)
      )
        return undefined;
      const parent = parentItem(input.state, options.itemCode);
      return {
        activeVerifiedRevision:
          input.state.activeMenuCollection?.revision ??
          (await stateRevision(projectMenuModifierOptions(options))),
        items: parent ? [parent] : [],
        allowMedia: true,
      };
    }
  }
}

function activeCollection(
  state: AgentGraphState,
  toolName: 'searchMenu' | 'recommendAddOns',
) {
  const key = state.activeCollectionKeys?.[toolName];
  const snapshot = key
    ? state.verifiedCollections?.[toolName]?.[key]
    : undefined;
  if (
    !snapshot ||
    state.activeMenuCollection?.key !== key ||
    !sameValue(snapshot, state.activeMenuCollection)
  ) {
    return undefined;
  }
  return snapshot as typeof snapshot & {
    result: VerifiedCollectionResult<MenuItem>;
  };
}

function parentItem(
  state: AgentGraphState,
  itemCode: string,
): MenuItem | undefined {
  if (state.menuItemDetail?.code === itemCode) return state.menuItemDetail;
  return state.activeMenuCollection?.result.items.find(
    (item) => item.code === itemCode,
  );
}

function catalogMediaItem(
  item: MenuItem,
  index: number,
): CatalogMediaIntentItem[] {
  const imageUrl = trustedKfcImageUrl(item.imageUrl);
  const code = nonEmptyString(item.code);
  const title = nonEmptyString(item.name);
  return imageUrl && code && title
    ? [{ key: `catalog:${code}:${index}`, imageUrl, title }]
    : [];
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isCatalogMediaToolName(value: unknown): value is CatalogMediaToolName {
  return (
    value === 'searchMenu' ||
    value === 'getItemDetails' ||
    value === 'getModifierOptions' ||
    value === 'recommendAddOns'
  );
}

function broadCatalogBrowseQuery(query: string): boolean {
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi');
  if (
    new Set([
      'combo',
      'mon',
      'thuc don',
      'ga',
      'burger',
      'do uong',
      'trang mieng',
    ]).has(normalized)
  ) {
    return true;
  }
  return /\bco\s+(?:combo|mon|ga|burger|do uong|trang mieng)\s+nao\b/u.test(
    normalized,
  );
}

export function trustedCatalogMedia(
  intent: CatalogMediaIntent | undefined,
): CatalogMediaIntentItem[] {
  if (intent?.outcome !== 'selected') return [];
  return intent.media.slice(0, 3).flatMap((item) => {
    const imageUrl = trustedKfcImageUrl(item.imageUrl);
    const key = nonEmptyString(item.key);
    const title = nonEmptyString(item.title);
    return imageUrl && key && title ? [{ key, imageUrl, title }] : [];
  });
}

export function catalogMediaIntentFromPersisted(
  value: unknown,
): CatalogMediaIntent | undefined {
  if (!isRecord(value)) return undefined;
  const toolName = value.toolName;
  if (
    value.schemaVersion !== CATALOG_MEDIA_INTENT_SCHEMA_VERSION ||
    !isCatalogMediaToolName(toolName) ||
    !hasNonEmptyStrings(value, [
      'intentId',
      'toolCallId',
      'evidenceId',
      'currentTurnRevision',
      'activeVerifiedRevision',
    ])
  ) {
    return undefined;
  }
  const identity: CatalogMediaIntentIdentity = {
    schemaVersion: CATALOG_MEDIA_INTENT_SCHEMA_VERSION,
    intentId: String(value.intentId),
    toolName,
    toolCallId: String(value.toolCallId),
    evidenceId: String(value.evidenceId),
    currentTurnRevision: String(value.currentTurnRevision),
    activeVerifiedRevision: String(value.activeVerifiedRevision),
  };
  if (value.outcome === 'text_only') {
    return { ...identity, outcome: 'text_only' };
  }
  if (
    value.outcome !== 'selected' ||
    !Array.isArray(value.media) ||
    value.media.length === 0 ||
    value.media.length > 3
  ) {
    return undefined;
  }
  const media = value.media.flatMap((item) => {
    if (!isRecord(item)) return [];
    const trusted = trustedCatalogMedia({
      ...identity,
      outcome: 'selected',
      media: [
        {
          key: String(item.key ?? ''),
          imageUrl: String(item.imageUrl ?? ''),
          title: String(item.title ?? ''),
        },
      ],
    });
    return trusted;
  });
  return media.length === value.media.length
    ? { ...identity, outcome: 'selected', media }
    : undefined;
}

export function trustedKfcImageUrl(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' &&
      url.hostname === 'static.kfcvietnam.com.vn'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptyStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => nonEmptyString(value[key]) !== undefined);
}
