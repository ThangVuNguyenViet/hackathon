import { z } from 'zod';
import type { MenuItem } from '../domain/types.js';

export const generatedMenuItemSchema = z.object({
  code: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  priceVnd: z.number().int().nonnegative(),
  originalPriceVnd: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url(),
  available: z.boolean(),
  provenance: z.object({
    sourceFile: z.string(),
    okfConceptId: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedFixturesSchema = z.object({
  menuItems: z.array(generatedMenuItemSchema),
});

export type GeneratedMenuItem = z.infer<typeof generatedMenuItemSchema> & MenuItem;
export type GeneratedFixtures = z.infer<typeof generatedFixturesSchema>;
