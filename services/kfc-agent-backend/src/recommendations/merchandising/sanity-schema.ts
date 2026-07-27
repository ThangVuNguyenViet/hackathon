interface SanityValidationRule {
  required(): SanityValidationRule;
  integer(): SanityValidationRule;
}

const stringArray = (name: string, title: string) => ({
  name,
  title,
  type: 'array',
  of: [{ type: 'string' }],
  initialValue: [],
});

export const recommendationPolicySanitySchema = {
  name: 'recommendationPolicy',
  title: 'Recommendation policy',
  type: 'document',
  fields: [
    { name: 'schemaVersion', type: 'string', readOnly: true },
    {
      name: 'policyId',
      type: 'string',
      validation: (rule: SanityValidationRule) => rule.required(),
    },
    {
      name: 'name',
      type: 'string',
      validation: (rule: SanityValidationRule) => rule.required(),
    },
    {
      name: 'description',
      type: 'text',
      validation: (rule: SanityValidationRule) => rule.required(),
    },
    {
      name: 'campaignId',
      type: 'string',
      validation: (rule: SanityValidationRule) => rule.required(),
    },
    {
      name: 'authoredReason',
      type: 'text',
      validation: (rule: SanityValidationRule) => rule.required(),
    },
    { name: 'enabled', type: 'boolean', initialValue: true },
    {
      name: 'priority',
      type: 'number',
      validation: (rule: SanityValidationRule) => rule.integer(),
    },
    {
      name: 'placement',
      type: 'string',
      options: {
        list: [
          'local_favorite',
          'for_you',
          'modifier_upsell',
          'smart_cross_sell',
        ],
      },
    },
    {
      name: 'action',
      type: 'string',
      options: {
        list: [
          'exclude_target',
          'boost_target',
          'pin_target',
          'replace_slate',
          'suppress_placement',
        ],
      },
    },
    stringArray('targetIds', 'Target IDs'),
    { name: 'environment', type: 'string' },
    stringArray('includedStoreIds', 'Included store IDs'),
    stringArray('excludedStoreIds', 'Excluded store IDs'),
    stringArray('fulfilmentModes', 'Fulfilment modes'),
    { name: 'minimumBasketSubtotalVnd', type: 'number' },
    { name: 'maximumBasketSubtotalVnd', type: 'number' },
    stringArray('requiredCartProductIds', 'Required cart product IDs'),
    stringArray('excludedCartProductIds', 'Excluded cart product IDs'),
    stringArray('requiredCartCategoryIds', 'Required cart category IDs'),
    stringArray('excludedCartCategoryIds', 'Excluded cart category IDs'),
    stringArray('verifiedCohorts', 'Verified cohorts'),
    { name: 'startsAt', type: 'datetime' },
    { name: 'endsAt', type: 'datetime' },
    { name: 'reasonCode', type: 'string' },
    {
      name: 'approvedText',
      type: 'object',
      fields: [
        { name: 'vi', type: 'string' },
        { name: 'en', type: 'string' },
      ],
    },
    { name: 'boostWeight', type: 'number' },
    { name: 'pinPosition', type: 'number' },
  ],
} as const;
