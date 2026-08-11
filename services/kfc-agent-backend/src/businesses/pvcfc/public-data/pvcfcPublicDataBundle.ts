import { z } from 'zod';
import type {
  PvcfcCollectionAccess,
  PvcfcOrganizationSummary,
  PvcfcPublicRecord,
} from './pvcfcPublicDataProvider.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const capturedAtSchema = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'must be an ISO date or date-time',
  );

const provenanceSchema = z
  .object({
    sourceUrl: z.string().url(),
    sourceClassification: z.enum([
      'official_pvcfc_domain',
      'official_app_store',
      'official_linked_source',
    ]),
    retrievedAt: z.string().date(),
    contentSha256: sha256Schema,
  })
  .passthrough();

const recordSchema = z
  .object({
    id: z.string().trim().min(1),
    originRefs: z.array(z.string().trim().min(1)).min(1),
    provenance: provenanceSchema,
  })
  .passthrough();

const collectionSchema = z
  .object({
    name: z.string().trim().min(1),
    access: z.enum(['searchable', 'discovery_only']),
    count: z.number().int().nonnegative(),
    records: z.array(recordSchema),
  })
  .superRefine((collection, context) => {
    if (collection.count !== collection.records.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'count must equal records.length',
        path: ['count'],
      });
    }
    const ids = collection.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'record ids must be unique within a collection',
        path: ['records'],
      });
    }
  });

const bundleSchema = z
  .object({
    schemaVersion: z.literal('pvcfc_public_data_v2'),
    businessId: z.literal('pvcfc'),
    capturedAt: capturedAtSchema,
    revision: sha256Schema,
    organization: z
      .object({
        name: z.string().trim().min(1),
        sourceRecordId: z.string().trim().min(1),
      })
      .passthrough(),
    collections: z.array(collectionSchema).min(1),
  })
  .superRefine((bundle, context) => {
    const names = bundle.collections.map((collection) => collection.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'collection names must be unique',
        path: ['collections'],
      });
    }
  });

export interface PvcfcPublicDataCollection {
  readonly name: string;
  readonly access: PvcfcCollectionAccess;
  readonly count: number;
  readonly records: readonly PvcfcPublicRecord[];
}

export interface PvcfcPublicDataBundle {
  readonly schemaVersion: 'pvcfc_public_data_v2';
  readonly businessId: 'pvcfc';
  readonly capturedAt: string;
  readonly revision: string;
  readonly organization: PvcfcOrganizationSummary;
  readonly collections: readonly PvcfcPublicDataCollection[];
}

export function parsePvcfcPublicDataBundle(
  input: unknown,
): PvcfcPublicDataBundle {
  const result = bundleSchema.safeParse(input);
  if (result.success) return result.data as PvcfcPublicDataBundle;
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid PVCFC public data: ${details}`);
}
