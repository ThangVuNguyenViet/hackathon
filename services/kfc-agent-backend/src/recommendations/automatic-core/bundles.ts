import { z } from 'zod';
import { AUTOMATIC_FEATURE_SCHEMA_DIGEST } from './features.js';
import type {
  AutomaticModelBinding,
  AutomaticQualifiedBundlePort,
  AutomaticQualifiedRecommendationBundle,
  AutomaticRecommendationType,
} from './types.js';

const opaqueIdSchema = z.string().trim().min(1).max(256);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const modelSchema = z
  .object({
    modelRevision: opaqueIdSchema,
    calibratorRevision: opaqueIdSchema,
    featureSchemaDigest: sha256Schema,
    thresholdRevision: opaqueIdSchema,
    minimumJointProbability: z.number().finite().min(0).max(1),
  })
  .strict();
const bundleSchema = z
  .object({
    schemaVersion: z.literal('kfc-qualified-automatic-bundle-v1'),
    bundleId: opaqueIdSchema,
    bundleDigest: sha256Schema,
    composerContractDigest: sha256Schema,
    qualificationRunId: opaqueIdSchema,
    qualificationEvidenceDigest: sha256Schema,
    models: z
      .object({
        local_favorite: modelSchema,
        for_you: modelSchema,
        modifier_upsell: modelSchema,
        smart_cross_sell: modelSchema,
      })
      .strict(),
  })
  .strict();

export async function resolveQualifiedAutomaticRecommendationBundle(
  port: AutomaticQualifiedBundlePort,
): Promise<AutomaticQualifiedRecommendationBundle | null> {
  const parsed = bundleSchema.safeParse(await port.readQualifiedBundle());
  if (!parsed.success) {
    return null;
  }
  if (
    Object.values(parsed.data.models).some(
      ({ featureSchemaDigest }) =>
        featureSchemaDigest !== AUTOMATIC_FEATURE_SCHEMA_DIGEST,
    )
  ) {
    return null;
  }
  return parsed.data;
}

export function automaticModelBinding(
  bundle: AutomaticQualifiedRecommendationBundle,
  recommendationType: AutomaticRecommendationType,
): AutomaticModelBinding {
  const model = bundle.models[recommendationType];
  return {
    bundleId: bundle.bundleId,
    bundleDigest: bundle.bundleDigest,
    modelRevision: model.modelRevision,
    calibratorRevision: model.calibratorRevision,
    featureSchemaDigest: model.featureSchemaDigest,
    thresholdRevision: model.thresholdRevision,
    composerContractDigest: bundle.composerContractDigest,
    qualificationRunId: bundle.qualificationRunId,
    qualificationEvidenceDigest: bundle.qualificationEvidenceDigest,
  };
}
