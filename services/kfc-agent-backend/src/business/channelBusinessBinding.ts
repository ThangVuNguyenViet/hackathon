export const BUSINESS_IDS = ['kfc', 'pvcfc'] as const;

export type BusinessId = (typeof BUSINESS_IDS)[number];

export type SocialChannel = 'messenger' | 'zalo';

export function requireConfiguredChannelBusinessId(input: {
  channel: SocialChannel;
  configuredValues: readonly (string | undefined)[];
  businessId: BusinessId | undefined;
}): BusinessId | undefined {
  const configured = input.configuredValues.some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  if (configured && input.businessId === undefined) {
    throw new Error(`${input.channel.toUpperCase()}_BUSINESS_ID is required`);
  }
  return input.businessId;
}
