import type { Channel } from '../domain/types.js';

export type ResponseProfile = 'genui' | 'social';

export function responseProfileForChannel(channel: Channel): ResponseProfile {
  switch (channel) {
    case 'kfc':
      return 'genui';
    case 'messenger':
    case 'zalo':
    case 'messenger_mock':
    case 'zalo_mock':
      return 'social';
    default:
      return assertNever(channel);
  }
}

export function resolveResponseProfile(input: {
  channel: Channel;
  responseProfile?: ResponseProfile;
}): ResponseProfile {
  const channelProfile = responseProfileForChannel(input.channel);
  const profile = input.responseProfile ?? channelProfile;
  if (
    input.channel !== 'kfc' &&
    input.channel !== 'messenger_mock' &&
    profile !== channelProfile
  ) {
    throw new Error(
      `response_profile_channel_mismatch:${input.channel}:${profile}`,
    );
  }
  return profile;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled response-profile channel: ${String(value)}`);
}
