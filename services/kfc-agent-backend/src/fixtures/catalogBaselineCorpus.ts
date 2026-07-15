import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseCatalogPayload, sha256 } from '../catalog/catalogObservation.js';
import {
  generatedMenuItemSchema,
  generatedMenuModifierSchema,
  type GeneratedModifierGroup,
} from './schema.js';

const baselineMetadataSchema = z.object({
  id: z.string().min(1),
  capturedAt: z.string().datetime(),
  itemCount: z.number().int().positive(),
  modifierTreeCount: z.number().int().nonnegative(),
});

const catalogBaselineManifestSchema = z.object({
  schemaVersion: z.literal(1),
  observations: z.array(z.discriminatedUnion('format', [
    baselineMetadataSchema.extend({
      format: z.literal('generated_pair'),
      itemSourcePath: z.string().min(1),
      itemSha256: z.string().regex(/^[a-f0-9]{64}$/),
      modifierSourcePath: z.string().min(1),
      modifierSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    baselineMetadataSchema.extend({
      format: z.literal('raw_api'),
      sourcePath: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ])).min(1),
});

function validateGeneratedModifierGroups(
  groups: GeneratedModifierGroup[],
  path: string,
  ancestors = new Set<string>(),
  expectedDepth = 0,
): void {
  const siblingGroups = new Set<string>();
  for (const group of groups) {
    if (siblingGroups.has(group.groupId) || ancestors.has(group.groupId)) {
      throw new Error(`Duplicate or cyclic modifier group ${path}/${group.groupId}`);
    }
    siblingGroups.add(group.groupId);
    if (group.depth !== expectedDepth) throw new Error(`Invalid modifier depth ${path}/${group.groupId}`);
    if (typeof group.min === 'number' && typeof group.max === 'number' && group.min > group.max) {
      throw new Error(`Invalid modifier bounds ${path}/${group.groupId}`);
    }
    const modifierIds = new Set<string>();
    let defaultQuantity = 0;
    for (const option of group.options) {
      if (modifierIds.has(option.modifierId)) {
        throw new Error(`Duplicate modifier ${path}/${group.groupId}/${option.modifierId}`);
      }
      modifierIds.add(option.modifierId);
      if (option.default) {
        if (typeof option.quantity !== 'number' || option.quantity <= 0) {
          throw new Error(`Invalid default modifier quantity ${path}/${group.groupId}/${option.modifierId}`);
        }
        defaultQuantity += option.quantity;
      }
      validateGeneratedModifierGroups(
        option.modifierGroups,
        `${path}/${group.groupId}/${option.modifierId}`,
        new Set([...ancestors, group.groupId]),
        expectedDepth + 1,
      );
    }
    if (
      defaultQuantity > 0 &&
      ((typeof group.min === 'number' && defaultQuantity < group.min) ||
        (typeof group.max === 'number' && defaultQuantity > group.max))
    ) {
      throw new Error(`Default modifier cardinality mismatch ${path}/${group.groupId}`);
    }
  }
}

export type CatalogBaselineManifest = z.infer<typeof catalogBaselineManifestSchema>;

export async function loadCatalogBaselineManifest(repoRoot: string): Promise<CatalogBaselineManifest> {
  const path = join(repoRoot, 'services/kfc-agent-backend/fixtures/catalog-baselines/manifest.json');
  return catalogBaselineManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function validateCatalogBaselineCorpus(repoRoot: string): Promise<CatalogBaselineManifest> {
  const manifest = await loadCatalogBaselineManifest(repoRoot);
  const ids = new Set<string>();
  for (const observation of manifest.observations) {
    if (ids.has(observation.id)) throw new Error(`Duplicate catalog baseline ${observation.id}`);
    ids.add(observation.id);
    if (observation.format === 'raw_api') {
      const raw = await readFile(join(repoRoot, observation.sourcePath), 'utf8');
      if (await sha256(raw) !== observation.sha256) {
        throw new Error(`Catalog baseline hash mismatch for ${observation.id}`);
      }
      const items = parseCatalogPayload(JSON.parse(raw) as unknown);
      if (
        items.length !== observation.itemCount ||
        items.filter((item) => item.modifierGroups.length > 0).length !== observation.modifierTreeCount
      ) {
        throw new Error(`Catalog baseline count mismatch for ${observation.id}`);
      }
      continue;
    }
    const itemRaw = await readFile(join(repoRoot, observation.itemSourcePath), 'utf8');
    const modifierRaw = await readFile(join(repoRoot, observation.modifierSourcePath), 'utf8');
    if (await sha256(itemRaw) !== observation.itemSha256) {
      throw new Error(`Catalog baseline item hash mismatch for ${observation.id}`);
    }
    if (await sha256(modifierRaw) !== observation.modifierSha256) {
      throw new Error(`Catalog baseline modifier hash mismatch for ${observation.id}`);
    }
    const items = generatedMenuItemSchema.array().parse(JSON.parse(itemRaw) as unknown);
    const modifiers = generatedMenuModifierSchema.array().parse(JSON.parse(modifierRaw) as unknown);
    if (items.length !== observation.itemCount) {
      throw new Error(`Catalog baseline item count mismatch for ${observation.id}`);
    }
    if (modifiers.length !== observation.modifierTreeCount) {
      throw new Error(`Catalog baseline modifier count mismatch for ${observation.id}`);
    }
    const itemById = new Map(items.map((item) => [item.itemId, item]));
    const itemIds = new Set(itemById.keys());
    if (itemIds.size !== items.length) throw new Error(`Duplicate item in catalog baseline ${observation.id}`);
    if (modifiers.some((modifier) => !itemIds.has(modifier.itemId))) {
      throw new Error(`Orphan modifier tree in catalog baseline ${observation.id}`);
    }
    const modifierItemIds = new Set<string>();
    for (const modifier of modifiers) {
      if (modifierItemIds.has(modifier.itemId)) {
        throw new Error(`Duplicate modifier tree in catalog baseline ${observation.id}`);
      }
      modifierItemIds.add(modifier.itemId);
      const parent = itemById.get(modifier.itemId)!;
      if (modifier.itemCode !== parent.code || modifier.itemId !== parent.itemId) {
        throw new Error(`Modifier tree parent mismatch in catalog baseline ${observation.id}`);
      }
      validateGeneratedModifierGroups(modifier.modifierGroups, modifier.itemId);
    }
  }
  return manifest;
}
