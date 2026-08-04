import { z } from 'zod';

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const recommendationTypeSchema = z.enum([
  'local_favorite',
  'for_you',
  'modifier_upsell',
  'smart_cross_sell',
]);
const modelBindingSchema = z
  .object({
    bundleId: opaqueIdSchema,
    bundleDigest: sha256Schema,
    modelRevision: opaqueIdSchema,
    calibratorRevision: opaqueIdSchema,
    featureSchemaDigest: sha256Schema,
    thresholdRevision: opaqueIdSchema,
    composerContractDigest: sha256Schema,
    qualificationRunId: opaqueIdSchema,
    qualificationEvidenceDigest: sha256Schema,
  })
  .strict();
const featureValueSchema = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  z.null(),
]);

const scorerRequestSchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-scorer-v1'),
    requestId: opaqueIdSchema,
    recommendationType: recommendationTypeSchema,
    model: modelBindingSchema,
    candidates: z
      .array(
        z
          .object({
            candidateId: opaqueIdSchema,
            eligibility: z.literal('eligible'),
            priceImpactVnd: z.number().int().nonnegative(),
            features: z.record(z.string(), featureValueSchema),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const scorerResponseSchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-scorer-v1'),
    requestId: opaqueIdSchema,
    model: modelBindingSchema,
    scores: z.array(
      z
        .object({
          candidateId: opaqueIdSchema,
          selectionProbability: z.number().min(0).max(1),
          jointProbability: z.number().min(0).max(1),
          explanationValues: z.record(
            z.string(),
            z.number().finite().min(-1).max(1),
          ),
        })
        .strict()
        .superRefine((score, context) => {
          if (score.jointProbability > score.selectionProbability) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['jointProbability'],
              message: 'Joint probability cannot exceed selection probability',
            });
          }
        }),
    ),
  })
  .strict();

export function parseAutomaticScorerRequest(value: unknown) {
  return scorerRequestSchema.parse(value);
}

export function parseAutomaticScorerResponse(value: unknown) {
  return scorerResponseSchema.parse(value);
}
