import { describe, expect, it } from 'vitest';
import {
  modelPresentationContext,
  resolveModelPresentationContext,
} from '../../src/agent/agentPresentationContext.js';

describe('model presentation context', () => {
  it.each([
    ['kfc', undefined, 'structured_companion'],
    ['messenger', undefined, 'standalone_text'],
    ['kfc', 'social', 'standalone_text'],
  ] as const)(
    'resolves %s with explicit profile %s to %s',
    (channel, responseProfile, presentationMode) => {
      const input = responseProfile
        ? { channel, responseProfile }
        : { channel };
      expect(resolveModelPresentationContext(input)).toEqual({
        schemaVersion: 'kfc-model-presentation-context-v1',
        presentationMode,
      });
    },
  );

  it('allows a controlled Messenger fixture to request structured companion output', () => {
    expect(resolveModelPresentationContext({
      channel: 'messenger_mock',
      responseProfile: 'genui',
    })).toEqual({
      schemaVersion: 'kfc-model-presentation-context-v1',
      presentationMode: 'structured_companion',
    });
  });

  it.each(['messenger', 'zalo', 'zalo_mock'] as const)(
    'rejects a GenUI override for social channel %s',
    (channel) => {
      expect(() => resolveModelPresentationContext({
        channel,
        responseProfile: 'genui',
      })).toThrow(
        `response_profile_channel_mismatch:${channel}:genui`,
      );
    },
  );

  it('serializes only the typed mode contract, not channel identity', () => {
    const context = modelPresentationContext({
      channel: 'kfc',
      responseProfile: 'social',
    });
    expect(context).toBe(
      '{"schemaVersion":"kfc-model-presentation-context-v1",' +
      '"presentationMode":"standalone_text"}',
    );
    expect(context).not.toContain('"channel"');
  });
});
