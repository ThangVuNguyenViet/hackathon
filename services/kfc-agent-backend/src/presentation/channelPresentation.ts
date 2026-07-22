import type { Channel } from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { AgentState } from '../agent/agentState.js';
import {
  resolveResponseProfile,
  responseProfileForChannel,
  type ResponseProfile,
} from './responseProfile.js';

export type ChannelPresentationMode = 'structured_companion' | 'standalone_text';

export interface ChannelCapabilities {
  presentationMode: ChannelPresentationMode;
  supportsGenUi: boolean;
  supportsCatalogMedia: boolean;
  requiresStandaloneText: boolean;
}
export type ChannelPresentationPlan =
  | {
      profile: 'genui';
      text: string;
      genUi?: KfcGenUiAttachment;
      media?: never;
    }
  | {
      profile: 'social';
      text: string;
      media?: ChannelPresentationMedia[];
      genUi?: never;
    };

export interface ChannelPresentationMedia {
  key: string;
  imageUrl: string;
  title: string;
}

export interface BuildChannelPresentationInput {
  channel: Channel;
  responseProfile?: ResponseProfile;
  graphResponseText: string;
  genUi?: KfcGenUiAttachment;
}

export interface BuildSocialPresentationInput {
  channel: Exclude<Channel, 'kfc'>;
  standaloneText: string;
  state: AgentState;
}

const structuredCompanionCapabilities: ChannelCapabilities = {
  presentationMode: 'structured_companion',
  supportsGenUi: true,
  supportsCatalogMedia: false,
  requiresStandaloneText: false,
};

const standaloneTextCapabilities: ChannelCapabilities = {
  presentationMode: 'standalone_text',
  supportsGenUi: false,
  supportsCatalogMedia: false,
  requiresStandaloneText: true,
};

const standaloneMediaCapabilities: ChannelCapabilities = {
  ...standaloneTextCapabilities,
  supportsCatalogMedia: true,
};

export function getChannelCapabilities(channel: Channel): ChannelCapabilities {
  switch (channel) {
    case 'kfc':
      return structuredCompanionCapabilities;
    case 'messenger':
    case 'zalo':
      return standaloneMediaCapabilities;
    case 'messenger_mock':
    case 'zalo_mock':
      return standaloneTextCapabilities;
    default:
      return assertNever(channel);
  }
}

export function textOnlyPresentation(text: string, channel: Channel = 'messenger'): ChannelPresentationPlan {
  const profile = responseProfileForChannel(channel);
  return profile === 'genui' ? { profile, text } : { profile, text };
}

export function buildChannelPresentation(input: BuildChannelPresentationInput): ChannelPresentationPlan {
  const profile = resolveResponseProfile(input);
  if (profile === 'social') {
    if (input.genUi) {
      throw new Error('Social presentation cannot consume a GenUI attachment');
    }
    return { profile, text: input.graphResponseText };
  }
  return {
    profile,
    text: input.graphResponseText,
    ...(input.genUi ? { genUi: input.genUi } : {}),
  };
}

export function buildSocialPresentation(input: BuildSocialPresentationInput): ChannelPresentationPlan {
  if (responseProfileForChannel(input.channel) !== 'social') {
    throw new Error('Social presenter received a non-social channel');
  }
  const media = getChannelCapabilities(input.channel).supportsCatalogMedia
    ? renderTrustedMediaFromState(input.state)
    : [];
  return {
    profile: 'social',
    text: input.standaloneText,
    ...(media.length > 0 ? { media } : {}),
  };
}

export function assertPresentationMatchesChannel(
  channel: Channel,
  presentation: ChannelPresentationPlan,
  expectedProfile: ResponseProfile = responseProfileForChannel(channel),
): void {
  const resolvedProfile = resolveResponseProfile({
    channel,
    responseProfile: expectedProfile,
  });
  if (presentation.profile !== resolvedProfile) {
    throw new Error(`Presentation profile mismatch: expected ${resolvedProfile}, got ${presentation.profile}`);
  }
  if (presentation.profile === 'social' && 'genUi' in presentation && presentation.genUi !== undefined) {
    throw new Error('Social presentation contains forbidden GenUI metadata');
  }
  if (presentation.profile === 'genui' && 'media' in presentation && presentation.media !== undefined) {
    throw new Error('GenUI presentation contains forbidden social media delivery data');
  }
}

function renderTrustedMediaFromState(state: AgentState): ChannelPresentationMedia[] {
  const candidates = [
    ...(state.menuItemDetail ? [state.menuItemDetail] : []),
    ...(state.menuSearchResults ?? []),
    ...(state.promotionOffers ?? []),
  ].map((item) => record(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  return candidates.flatMap((item, index) => {
    const imageUrl = trustedKfcImageUrl(item.imageUrl);
    const title = nonEmptyString(item.name) ?? nonEmptyString(item.offerName) ?? nonEmptyString(item.title) ?? nonEmptyString(item.campaign);
    if (!imageUrl || !title) return [];
    const entityId = nonEmptyString(item.code) ?? nonEmptyString(item.itemCode) ?? nonEmptyString(item.offerId) ?? nonEmptyString(item.id) ?? 'item';
    return [{ key: `social:${entityId}:${index}`, imageUrl, title }];
  });
}

function trustedKfcImageUrl(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === 'static.kfcvietnam.com.vn' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled channel presentation variant: ${String(value)}`);
}
