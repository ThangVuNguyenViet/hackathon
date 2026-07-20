import { describe, expect, it, vi } from 'vitest';
import {
  releaseStreamingRunObserver,
  streamingRunObserverKey,
  type StreamingRunObserver,
  type StreamingRunObservers,
} from '../../src/api/routeAgentRuntime.js';

function observer(runId: string): StreamingRunObserver {
  return {
    observe: vi.fn(),
    isCurrent: vi.fn(async () => true),
    commitFence: {
      kind: 'customer_run',
      runId,
      sessionAuthorityGeneration: 0,
    },
  };
}

describe('streaming run observer ownership', () => {
  it('scopes the same client message identity to its session', () => {
    expect(streamingRunObserverKey('kfc:customer-a', 'message-1'))
      .not.toBe(streamingRunObserverKey('kfc:customer-b', 'message-1'));
  });

  it('does not let an older completion delete a replacement observer', () => {
    const key = streamingRunObserverKey('kfc:customer-a', 'message-1');
    const older = observer('run-older');
    const replacement = observer('run-replacement');
    const observers: StreamingRunObservers = new Map([[key, replacement]]);

    releaseStreamingRunObserver(observers, key, older);
    expect(observers.get(key)).toBe(replacement);

    releaseStreamingRunObserver(observers, key, replacement);
    expect(observers.has(key)).toBe(false);
  });
});
