import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  controlledRetryCanaryRequested,
  forceFirstBoundInvokeRetryableFailure,
} from './controlledRetryCanary.js';

describe('controlled retry canary model', () => {
  it('enables the injection only for an explicitly requested live diagnostic', () => {
    expect(controlledRetryCanaryRequested({
      forceFirstRetry: '1',
      liveRequested: true,
      qualificationRequested: false,
    })).toBe(true);
    expect(controlledRetryCanaryRequested({
      forceFirstRetry: undefined,
      liveRequested: true,
      qualificationRequested: false,
    })).toBe(false);
    expect(controlledRetryCanaryRequested({
      forceFirstRetry: '0',
      liveRequested: true,
      qualificationRequested: false,
    })).toBe(false);
  });

  it('rejects forced retry injection during full qualification', () => {
    expect(() => controlledRetryCanaryRequested({
      forceFirstRetry: '1',
      liveRequested: true,
      qualificationRequested: true,
    })).toThrow(
      'KFC_LIVE_FORCE_FIRST_RETRY is forbidden during live qualification',
    );
  });

  it('fails exactly the first bound invocation, then delegates later bindings', async () => {
    const delegate = fakeModel()
      .respond(new AIMessage('first delegated response'))
      .respond(new AIMessage('second delegated response'));
    const bindTools = vi.spyOn(delegate, 'bindTools');
    const model = forceFirstBoundInvokeRetryableFailure(delegate);
    const firstBinding = model.bindTools?.([]);

    expect(firstBinding).toBeDefined();
    await expect(
      firstBinding!.invoke([new HumanMessage('first request')]),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(delegate.callCount).toBe(0);

    await expect(
      firstBinding!.invoke([new HumanMessage('second request')]),
    ).resolves.toMatchObject({
      content: 'first delegated response',
    });

    const secondBinding = model.bindTools?.([]);
    expect(secondBinding).toBeDefined();
    await expect(
      secondBinding!.invoke([new HumanMessage('third request')]),
    ).resolves.toMatchObject({
      content: 'second delegated response',
    });
    expect(delegate.callCount).toBe(2);
    expect(bindTools).toHaveBeenCalledTimes(2);
  });
});
