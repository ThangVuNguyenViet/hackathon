import { z } from 'zod';
import { turnExpectationSchema } from '../scenarios/scenarioScript.js';
import {
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_INVENTORY_VERSION,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveQualityDatasetCase,
} from './liveQualityContracts.js';

const nonEmptyString = z.string().trim().min(1);
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length;

export const liveQualityDatasetCaseSchema = z.object({
  inputs: z.object({
    caseId: nonEmptyString,
    scenarioFile: z.string().regex(/^\d{2}-[^/]+\.json$/),
    scenario: z.object({
      id: z.string().regex(/^\d{2}-[a-z0-9-]+$/),
      title: nonEmptyString,
      channel: z.enum(['messenger_mock', 'zalo_mock', 'kfc']),
      goal: nonEmptyString,
      useCaseIds: z.array(z.string().regex(/^UC-\d{2}$/)).min(1)
        .refine(unique, 'use cases must be unique'),
      finalState: nonEmptyString,
      setup: z.object({
        requiresCustomerAccess: z.boolean(),
        seedPaidOrder: z.boolean(),
        seedPendingPayment: z.boolean(),
      }).strict(),
    }).strict(),
    turnIndex: z.number().int().positive(),
    mode: z.enum(['genui', 'text']),
    customerMessage: nonEmptyString,
  }).strict(),
  outputs: z.object({
    expectation: turnExpectationSchema,
  }).strict(),
  metadata: z.object({
    caseId: nonEmptyString,
    schemaVersion: z.literal(LIVE_QUALITY_SCHEMA_VERSION),
    inventoryVersion: z.literal(LIVE_QUALITY_INVENTORY_VERSION),
    sourcePath: z.literal(LIVE_QUALITY_SOURCE_PATH),
    datasetName: z.literal(LIVE_QUALITY_DATASET_NAME),
    managedBy: z.literal(LIVE_QUALITY_SYNC_OWNER),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  split: z.literal(LIVE_QUALITY_DATASET_SPLIT),
}).strict();

export function parseLiveQualityDatasetCase(value: unknown): LiveQualityDatasetCase {
  return liveQualityDatasetCaseSchema.parse(value) as LiveQualityDatasetCase;
}
