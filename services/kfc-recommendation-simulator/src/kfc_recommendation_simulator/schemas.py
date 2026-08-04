from __future__ import annotations

import hashlib
import json

import pyarrow as pa

FEATURE_FIELDS = (
    ("featureSchemaVersion", pa.string(), False),
    ("recommendationType", pa.string(), False),
    ("storeId", pa.string(), False),
    ("fulfilmentMode", pa.string(), False),
    ("locale", pa.string(), False),
    ("localHour", pa.int8(), False),
    ("daypart", pa.string(), False),
    ("catalogRevision", pa.string(), False),
    ("cartSubtotalVnd", pa.int64(), False),
    ("cartLineCount", pa.int16(), False),
    ("cartDistinctCategoryCount", pa.int16(), False),
    ("candidateSellableItemId", pa.string(), False),
    ("candidateModifierOptionId", pa.string(), True),
    ("candidateCategoryId", pa.string(), False),
    ("candidatePriceImpactVnd", pa.int64(), False),
    ("candidateUnitPriceVnd", pa.int64(), False),
    ("candidateDiscountAmountVnd", pa.int64(), False),
    ("candidateDiscountActive", pa.bool_(), False),
    ("promotionActive", pa.bool_(), False),
    ("completedOrderCount", pa.int32(), False),
    ("priorItemOrderCount", pa.int32(), False),
    ("priorCategoryOrderCount", pa.int32(), False),
    ("historyRecencyDays", pa.float64(), True),
    ("localDemandCount", pa.int32(), True),
    ("modifierParentCartLineId", pa.string(), True),
    ("modifierParentSellableItemId", pa.string(), True),
    ("modifierGroupPath", pa.string(), True),
    ("modifierSelectionMode", pa.string(), True),
    ("modifierOptionAvailable", pa.bool_(), True),
    ("modifierOptionSafe", pa.bool_(), True),
    ("modifierPriceRatio", pa.float64(), True),
    ("remainingBudgetVnd", pa.int64(), True),
    ("basketAssociationCount", pa.int32(), True),
    ("basketComplementarityScore", pa.float64(), True),
    ("basketRedundancyCount", pa.int32(), True),
    ("basketCategoryDiversityCount", pa.int32(), True),
)


def _schema(*fields: tuple[str, pa.DataType, bool]) -> pa.Schema:
    return pa.schema(
        [pa.field(name, data_type, nullable) for name, data_type, nullable in fields]
    )


CATALOG_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("recordType", pa.string(), False),
    ("sellableItemId", pa.string(), False),
    ("modifierOptionId", pa.string(), True),
    ("categoryId", pa.string(), False),
    ("unitPriceVnd", pa.int64(), False),
    ("priceImpactVnd", pa.int64(), False),
    ("promotionActive", pa.bool_(), False),
    ("localDemandCount", pa.int32(), False),
    ("basketAssociationCount", pa.int32(), False),
    ("basketComplementarityScore", pa.float64(), False),
    ("coldCandidate", pa.bool_(), False),
)

POPULATION_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("customerId", pa.string(), False),
    ("returningCustomer", pa.bool_(), False),
    ("completedOrderCount", pa.int32(), False),
    ("coldCustomer", pa.bool_(), False),
)

SOURCE_JOURNEY_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("journeyId", pa.string(), False),
    ("opportunityId", pa.string(), False),
    ("startedAt", pa.string(), False),
    ("split", pa.string(), False),
    ("storeId", pa.string(), False),
    ("customerId", pa.string(), False),
    ("returningCustomer", pa.bool_(), False),
    ("fulfilmentMode", pa.string(), False),
    ("daypart", pa.string(), False),
    ("recommendationType", pa.string(), False),
    ("cartSubtotalVnd", pa.int64(), False),
    ("heldOutStore", pa.bool_(), False),
    ("coldCustomer", pa.bool_(), False),
    ("coldCandidate", pa.bool_(), False),
    ("drift", pa.bool_(), False),
    ("rush", pa.bool_(), False),
)

TRAINING_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("journeyId", pa.string(), False),
    ("opportunityId", pa.string(), False),
    ("split", pa.string(), False),
    ("loggingPolicy", pa.string(), False),
    ("candidateId", pa.string(), False),
    ("eligibility", pa.string(), False),
    ("priceImpactVnd", pa.int64(), False),
    *FEATURE_FIELDS,
    ("shown", pa.bool_(), False),
    ("exposurePropensity", pa.float64(), True),
    ("selected", pa.bool_(), True),
    ("selectedThroughCheckout", pa.bool_(), True),
)

OPPORTUNITY_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("journeyId", pa.string(), False),
    ("opportunityId", pa.string(), False),
    ("occurredAt", pa.string(), False),
    ("recommendationType", pa.string(), False),
    ("placement", pa.string(), False),
    ("status", pa.string(), False),
    ("emptyReason", pa.string(), True),
    ("assignedCondition", pa.string(), False),
    ("loggingPolicy", pa.string(), False),
    ("candidateCount", pa.int16(), False),
    ("shownCandidateId", pa.string(), True),
    ("renderedPosition", pa.int8(), True),
    ("exposurePropensity", pa.float64(), True),
    ("dismissed", pa.bool_(), False),
    ("selectedCandidateId", pa.string(), True),
    ("acceptedItemRemoved", pa.bool_(), False),
    ("cartMutation", pa.string(), False),
    ("checkout", pa.bool_(), False),
    ("abandonment", pa.bool_(), False),
    ("finalMerchandiseSubtotalVnd", pa.int64(), False),
)

EVALUATION_JOURNEY_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("journeyId", pa.string(), False),
    ("opportunityId", pa.string(), False),
    ("assignedCondition", pa.string(), False),
    ("pairedComparisonRef", pa.string(), False),
    ("terminalState", pa.string(), False),
    ("checkout", pa.bool_(), False),
    ("abandonment", pa.bool_(), False),
    ("finalMerchandiseSubtotalVnd", pa.int64(), False),
)

ORACLE_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("journeyId", pa.string(), False),
    ("opportunityId", pa.string(), False),
    ("pairedComparisonRef", pa.string(), False),
    ("condition", pa.string(), False),
    ("latentAffinity", pa.float64(), False),
    ("potentialSelection", pa.bool_(), False),
    ("terminalState", pa.string(), False),
    ("finalMerchandiseSubtotalVnd", pa.int64(), False),
)

ARRIVAL_SCHEMA = _schema(
    ("seed", pa.int32(), False),
    ("minute", pa.string(), False),
    ("daypart", pa.string(), False),
    ("rush", pa.bool_(), False),
    ("arrivals", pa.int32(), False),
)

SCORER_SHAPE_SCHEMA = _schema(
    ("recommendationType", pa.string(), False),
    ("candidateCount", pa.int16(), False),
    ("requestJson", pa.string(), False),
)

ARTIFACT_SCHEMAS = {
    "source/catalog.parquet": CATALOG_SCHEMA,
    "source/population.parquet": POPULATION_SCHEMA,
    "source/journeys.parquet": SOURCE_JOURNEY_SCHEMA,
    "model-visible/training-examples.parquet": TRAINING_SCHEMA,
    "evaluation/opportunities.parquet": OPPORTUNITY_SCHEMA,
    "evaluation/journeys.parquet": EVALUATION_JOURNEY_SCHEMA,
    "oracle/potential-outcomes.parquet": ORACLE_SCHEMA,
    "traffic/arrivals-per-minute.parquet": ARRIVAL_SCHEMA,
    "traffic/scorer-candidate-shapes.parquet": SCORER_SHAPE_SCHEMA,
}


def schema_digest(schema: pa.Schema) -> str:
    descriptor = [
        {"name": field.name, "type": str(field.type), "nullable": field.nullable}
        for field in schema
    ]
    encoded = json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()
