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

function assertNever(value: never): never {
  throw new Error(`Unhandled response-profile channel: ${String(value)}`);
}
