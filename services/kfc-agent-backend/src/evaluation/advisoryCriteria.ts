import type { LiveScenarioAdvisoryMetadata } from './liveQualityContracts.js';

const advisoryCriteria = {
  groupBudgetRecommendation: {
    id: 'advisory.02.group-budget-recommendation',
    description:
      'Recommend verified food and drink choices for the stated group size and budget without premature cart mutation.',
  },
  completeMenuDiscovery: {
    id: 'advisory.02.complete-menu-discovery',
    description:
      'Return deterministic complete-menu collection evidence when the customer asks to see the whole menu.',
  },
  valueConsentArithmetic: {
    id: 'advisory.02.value-consent-arithmetic',
    description:
      'Explain the verified 146,000₫ saving and preserve explicit consent before combo conversion and drink upsizing.',
  },
  unavailableItemBoundary: {
    id: 'advisory.03.unavailable-item-boundary',
    description:
      'Report Burger Tôm as unavailable from catalog evidence while keeping delivery coverage explicitly unresolved until an address lookup.',
  },
  ordinaryDietaryPreference: {
    id: 'advisory.06.ordinary-dietary-preference',
    description:
      'Treat non-spicy and no-added-cheese wording as an ordinary preference grounded in menu and modifier evidence, without medical safety claims.',
  },
  personalizationConfirmation: {
    id: 'advisory.07.personalization-confirmation',
    description:
      'Present recent-order and favorite-item candidates from authenticated evidence and require confirmation before mutation.',
  },
  verifiedComparison: {
    id: 'advisory.10.verified-comparison',
    description:
      'Compare both requested combos using verified composition and exact 79,000₫ versus 85,000₫ pricing with a 6,000₫ delta.',
  },
  nonSpicyRecommendation: {
    id: 'advisory.10.non-spicy-recommendation',
    description:
      'Recommend only supported non-spicy customization while disclosing uncertainty about the pepper-lime chicken and avoiding unsupported health, portion, nutrition, or spice claims.',
  },
  preferenceEvidence: {
    id: 'advisory.11.preference-evidence',
    description:
      'Ground the ordinary non-spicy and no-added-cheese preferences in the exact item, modifier group, and modifier relationships.',
  },
  allergenSafetyBoundary: {
    id: 'advisory.11.allergen-safety-boundary',
    description:
      'State that item-level milk safety is not verified, never equate omitted optional cheese with milk-free safety, and direct the customer to official allergen information or restaurant staff.',
  },
} as const;

export const ADVISORY_SCENARIO_CATALOG = {
  '02-tu-van-combo-va-upsell.json': {
    role: 'core',
    phaseEndTurnIndex: 9,
    judgmentPolicy: 'warning',
    criteria: [
      advisoryCriteria.groupBudgetRecommendation,
      advisoryCriteria.completeMenuDiscovery,
      advisoryCriteria.valueConsentArithmetic,
    ],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json': {
    role: 'core',
    phaseEndTurnIndex: 1,
    judgmentPolicy: 'warning',
    criteria: [advisoryCriteria.unavailableItemBoundary],
  },
  '06-ngon-ngu-tu-nhien-va-an-toan.json': {
    role: 'supporting',
    phaseEndTurnIndex: 3,
    judgmentPolicy: 'evidence_only',
    criteria: [advisoryCriteria.ordinaryDietaryPreference],
  },
  '07-ca-nhan-hoa-va-loyalty.json': {
    role: 'supporting',
    phaseEndTurnIndex: 3,
    judgmentPolicy: 'evidence_only',
    criteria: [advisoryCriteria.personalizationConfirmation],
  },
  '10-so-sanh-mon-va-giai-thich.json': {
    role: 'core',
    phaseEndTurnIndex: 3,
    judgmentPolicy: 'warning',
    criteria: [
      advisoryCriteria.verifiedComparison,
      advisoryCriteria.nonSpicyRecommendation,
    ],
  },
  '11-khau-vi-va-di-ung.json': {
    role: 'core',
    phaseEndTurnIndex: 3,
    judgmentPolicy: 'warning',
    criteria: [
      advisoryCriteria.preferenceEvidence,
      advisoryCriteria.allergenSafetyBoundary,
    ],
  },
} as const satisfies Record<string, LiveScenarioAdvisoryMetadata>;

export const ADVISORY_CRITERION_IDS = Object.values(
  ADVISORY_SCENARIO_CATALOG,
).flatMap((scenario) => scenario.criteria.map((criterion) => criterion.id));
