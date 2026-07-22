import type { Channel } from '../domain/types.js';
import type {
  ChannelPresentationMode,
} from '../presentation/channelPresentation.js';
import {
  resolveResponseProfile,
  type ResponseProfile,
} from '../presentation/responseProfile.js';

export const MODEL_PRESENTATION_CONTEXT_SCHEMA_VERSION =
  'kfc-model-presentation-context-v1' as const;
export const MODEL_PRESENTATION_CONTEXT_INSTRUCTION =
  'Use the typed presentation context: structured_companion may rely on ' +
  'the verified companion surface, while standalone_text must be ' +
  'self-contained using only verified evidence.';

export interface ModelPresentationContext {
  schemaVersion: typeof MODEL_PRESENTATION_CONTEXT_SCHEMA_VERSION;
  presentationMode: ChannelPresentationMode;
}

export interface ModelPresentationContextInput {
  channel: Channel;
  responseProfile?: ResponseProfile;
}

export function resolveModelPresentationContext(
  input: ModelPresentationContextInput,
): ModelPresentationContext {
  const profile = resolveResponseProfile(input);
  return {
    schemaVersion: MODEL_PRESENTATION_CONTEXT_SCHEMA_VERSION,
    presentationMode:
      profile === 'genui'
        ? 'structured_companion'
        : 'standalone_text',
  };
}

export function modelPresentationContext(
  input: ModelPresentationContextInput,
): string {
  return JSON.stringify(resolveModelPresentationContext(input));
}
