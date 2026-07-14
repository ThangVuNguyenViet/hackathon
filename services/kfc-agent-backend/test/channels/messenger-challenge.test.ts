import { describe, expect, it } from 'vitest';
import { verifyMessengerChallenge } from '../../src/channels/messenger.js';

describe('Messenger verification challenge', () => {
  it('fails closed when the configured verify token is missing', () => {
    expect(verifyMessengerChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': '',
      'hub.challenge': 'challenge',
    }, '')).toEqual({ statusCode: 403, body: 'Forbidden' });
  });
});
