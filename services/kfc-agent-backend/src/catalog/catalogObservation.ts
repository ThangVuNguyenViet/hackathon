import { z } from 'zod';
import type { ExternalCallContext } from '../clients/interfaces.js';

export type CommerceEnvironment = 'production' | 'sandbox';

const localizedTextSchema = z.array(z.object({
  lang: z.string().min(1),
  value: z.string(),
}).strict());

interface RawModifier {
  id: string;
  name: string;
  price: number;
  dflt?: string;
  qty?: number;
  posItemId: string;
  modgrps?: RawModifierGroup[];
}

interface RawModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  modifiers: RawModifier[];
}

const rawModifierSchema: z.ZodType<RawModifier, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  name: z.string().min(1),
  dname: localizedTextSchema.optional(),
  price: z.number().int().nonnegative(),
  dflt: z.enum(['Y', 'N']).optional(),
  qty: z.number().int().nonnegative().optional(),
  modgrps: z.array(rawModifierGroupSchema).nullish().transform((groups) => groups ?? undefined),
  imageName: localizedTextSchema.optional(),
  isCustomize: z.boolean().optional(),
  posItemId: z.string(),
}).strict());

const rawModifierGroupSchema: z.ZodType<RawModifierGroup, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  name: z.string().min(1),
  dname: localizedTextSchema.optional(),
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  modifiers: z.array(rawModifierSchema).min(1),
}).strict());

const rawItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  name: z.string().min(1),
  dname: localizedTextSchema.min(1),
  price: z.number().int().nonnegative(),
  strikePrice: z.number().int().nonnegative().nullish().transform((price) => price ?? undefined),
  modgrps: z.array(rawModifierGroupSchema).nullish().transform((groups) => groups ?? undefined),
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
  daysOfWeekAvailable: z.array(z.number().int().min(0).max(6)),
  description: localizedTextSchema,
  imageName: localizedTextSchema,
  isCustomize: z.boolean(),
  isQuickCombo: z.boolean().optional(),
  posItemId: z.string().min(1),
  url: z.string(),
}).strict();

const rawProductSchema = z.object({
  id: z.number().int(),
  dname: localizedTextSchema,
  description: localizedTextSchema,
  items: z.array(rawItemSchema).min(1),
}).strict();

interface RawCategory {
  categories?: RawCategory[];
  products?: z.infer<typeof rawProductSchema>[];
}

const rawCategorySchema: z.ZodType<RawCategory, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  dname: localizedTextSchema.optional(),
  description: localizedTextSchema.optional(),
  imageName: localizedTextSchema.optional(),
  skuid: z.string().optional(),
  url: z.string().optional(),
  isUpsellCategory: z.boolean().optional(),
  categories: z.array(rawCategorySchema).nullish().transform((categories) => categories ?? undefined),
  products: z.array(rawProductSchema).nullish().transform((products) => products ?? undefined),
}).strict());

const rawMenuSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  name: z.string().min(1),
  categories: z.array(rawCategorySchema).min(1),
}).strict();

export interface CatalogItemFact {
  itemCode: string;
  posItemId: string;
  productCode: string;
  category: string;
  categoryId: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
  isCustomize: boolean;
  isQuickCombo: boolean;
  modifierGroups: RawModifierGroup[];
}

export interface CatalogObservation {
  id: string;
  environment: CommerceEnvironment;
  sourceUrl: string;
  providerFingerprint: string;
  observedAt: string;
  expiresAt?: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  itemCount: number;
  modifierTreeCount: number;
  items: CatalogItemFact[];
}

export interface FetchCatalogObservationOptions {
  environment: CommerceEnvironment;
  sourceUrl: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  fallbackTtlSeconds?: number;
  externalCallContext?: ExternalCallContext;
}

function collectItems(categories: RawCategory[]): z.infer<typeof rawItemSchema>[] {
  return categories.flatMap((category) => [
    ...(category.products ?? []).flatMap((product) => product.items),
    ...collectItems(category.categories ?? []),
  ]);
}

function validateModifierGroups(
  groups: RawModifierGroup[],
  path: string,
  ancestors = new Set<string>(),
): void {
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (groupIds.has(group.id) || ancestors.has(group.id)) {
      throw new Error(`Duplicate modifier group ${path}/${group.id}`);
    }
    groupIds.add(group.id);
    if (group.max === 0 || group.min > group.max) throw new Error(`Invalid modifier bounds ${path}/${group.id}`);
    const modifierIds = new Set<string>();
    let defaultQuantity = 0;
    for (const modifier of group.modifiers) {
      if (modifierIds.has(modifier.id)) throw new Error(`Duplicate modifier ${path}/${group.id}/${modifier.id}`);
      modifierIds.add(modifier.id);
      if (modifier.dflt === 'Y') {
        if (!modifier.qty) throw new Error(`Invalid default modifier quantity ${path}/${group.id}/${modifier.id}`);
        defaultQuantity += modifier.qty;
      }
      validateModifierGroups(
        modifier.modgrps ?? [],
        `${path}/${group.id}/${modifier.id}`,
        new Set([...ancestors, group.id]),
      );
    }
    if (defaultQuantity > 0 && (defaultQuantity < group.min || defaultQuantity > group.max)) {
      throw new Error(`Default modifier cardinality mismatch ${path}/${group.id}`);
    }
  }
}

export function parseCatalogPayload(payload: unknown): CatalogItemFact[] {
  const parsed = rawMenuSchema.parse(payload);
  const validateCategories = (categories: RawCategory[], path: string): void => {
    for (const [index, category] of categories.entries()) {
      if ((category.categories?.length ?? 0) === 0 && (category.products?.length ?? 0) === 0) {
        throw new Error(`Empty catalog category ${path}/${index}`);
      }
      validateCategories(category.categories ?? [], `${path}/${index}`);
    }
  };
  validateCategories(parsed.categories, 'categories');
  const rawItems = collectItems(parsed.categories);
  if (rawItems.length === 0) throw new Error('Catalog contains no items');

  const itemCodes = new Set<string>();
  const localized = (values: Array<{ lang: string; value: string }>): string =>
    values.find((entry) => entry.lang === 'vn')?.value.trim() ?? values[0]?.value.trim() ?? '';
  return rawItems.map((item) => {
    if (itemCodes.has(item.id)) throw new Error(`Duplicate catalog item ${item.id}`);
    itemCodes.add(item.id);
    const modifierGroups = item.modgrps ?? [];
    validateModifierGroups(modifierGroups, item.id);
    const productCode = localized(item.imageName);
    return {
      itemCode: item.id,
      posItemId: item.posItemId,
      productCode,
      category: item.categoryName,
      categoryId: item.categoryId,
      name: localized(item.dname),
      description: localized(item.description),
      priceVnd: item.price,
      originalPriceVnd: item.strikePrice && item.strikePrice > item.price ? item.strikePrice : null,
      imageUrl: productCode ? `https://static.kfcvietnam.com.vn/images/items/lg/${productCode}.jpg` : '',
      isCustomize: item.isCustomize,
      isQuickCombo: item.isQuickCombo ?? false,
      modifierGroups,
    };
  });
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function expiryFrom(response: Response, observedAt: Date, fallbackTtlSeconds: number): string {
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1];
  return new Date(observedAt.getTime() + Number(maxAge ?? fallbackTtlSeconds) * 1000).toISOString();
}

export async function fetchCatalogObservation(
  options: FetchCatalogObservationOptions,
): Promise<CatalogObservation> {
  const fallbackTtlSeconds = options.fallbackTtlSeconds ?? 300;
  if (!Number.isInteger(fallbackTtlSeconds) || fallbackTtlSeconds < 30 || fallbackTtlSeconds > 3600) {
    throw new Error('Catalog fallback TTL must be between 30 and 3600 seconds');
  }
  let sourceUrl: string;
  try {
    const parsedUrl = new URL(options.sourceUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error();
    sourceUrl = parsedUrl.toString();
  } catch {
    throw new Error('Catalog provider URL must be HTTP or HTTPS');
  }
  if (options.externalCallContext?.signal.aborted) {
    const reason = options.externalCallContext.signal.reason;
    throw reason instanceof Error
      ? reason
      : new DOMException(
          'Catalog provider request was cancelled before dispatch',
          'AbortError',
        );
  }
  if (
    options.externalCallContext &&
    Date.now() >= options.externalCallContext.deadlineAt
  ) {
    throw new DOMException(
      'Catalog provider request was cancelled before dispatch',
      'AbortError',
    );
  }
  const response = await (options.fetchImpl ?? fetch)(sourceUrl, {
    headers: { accept: 'application/json' },
    ...(options.externalCallContext
      ? { signal: options.externalCallContext.signal }
      : {}),
  });
  if (!response.ok) throw new Error(`Catalog provider returned HTTP ${response.status}`);
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Catalog provider returned invalid JSON');
  }
  const parsedPayload = rawMenuSchema.parse(payload);
  const items = parseCatalogPayload(parsedPayload);
  const observedAt = options.now ?? new Date();
  const digest = await sha256(canonicalJson(parsedPayload));
  const providerFingerprint = await sha256(sourceUrl);
  const etag = response.headers.get('etag') ?? undefined;
  const lastModified = response.headers.get('last-modified') ?? undefined;
  const expiresAt = expiryFrom(response, observedAt, fallbackTtlSeconds);
  return {
    id: `${options.environment}:${providerFingerprint}:${etag ?? lastModified ?? digest}:${digest}`,
    environment: options.environment,
    sourceUrl,
    providerFingerprint,
    observedAt: observedAt.toISOString(),
    expiresAt,
    etag,
    lastModified,
    sha256: digest,
    itemCount: items.length,
    modifierTreeCount: items.filter((item) => item.modifierGroups.length > 0).length,
    items,
  };
}

export interface CatalogRevalidation {
  ok: boolean;
  changedItemCodes: string[];
}

export function revalidateCatalogPin(
  pinned: CatalogObservation,
  current: CatalogObservation,
  referencedItemCodes: string[],
): CatalogRevalidation {
  if (pinned.environment !== current.environment) {
    return { ok: false, changedItemCodes: [...new Set(referencedItemCodes)] };
  }
  if (pinned.providerFingerprint !== current.providerFingerprint) {
    return { ok: false, changedItemCodes: [...new Set(referencedItemCodes)] };
  }
  const pinnedByCode = new Map(pinned.items.map((item) => [item.itemCode, item]));
  const currentByCode = new Map(current.items.map((item) => [item.itemCode, item]));
  const changedItemCodes = [...new Set(referencedItemCodes)].filter((code) =>
    JSON.stringify(pinnedByCode.get(code)) !== JSON.stringify(currentByCode.get(code)),
  );
  return { ok: changedItemCodes.length === 0, changedItemCodes };
}
