import { describe, expect, it, vi } from 'vitest';
import { isRecord } from '../../src/api/routeHandlerContracts.js';
import { reserveKfcSynchronousRequest } from '../../src/api/synchronousRequestReservation.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('KFC synchronous request reservation', () => {
  it('exposes the exact operation-lease owner as the turn run guard', async () => {
    const store = new MemoryStore();
    const reservation = await reserveKfcSynchronousRequest({
      store,
      sessionId: 'kfc:reservation-owner',
      clientMessageId: 'message-1',
      bindingFingerprint: 'binding-1',
    });
    if (reservation.status !== 'ready') {
      throw new Error('expected a new request reservation');
    }

    expect(reservation.fence.runGuard.commitFence).toMatchObject({
      kind: 'operation_lease',
      operation: 'kfc_synchronous_request',
      bindingFingerprint: 'binding-1',
      attempt: 1,
      sessionAuthorityGeneration: 0,
    });
    await expect(
      reservation.fence.runGuard.isCurrent(),
    ).resolves.toBe(true);

    await reservation.fence.fail('test owner released');
    await expect(
      reservation.fence.runGuard.isCurrent(),
    ).resolves.toBe(false);
  });

  it('stores an approval pointer and projects its token only after completion', async () => {
    const store = new MemoryStore();
    const complete = vi.spyOn(
      store,
      'completeIrreversibleOperation',
    );
    let projection = 0;
    const reserve = () =>
      reserveKfcSynchronousRequest({
        store,
        sessionId: 'kfc:reservation-approval',
        clientMessageId: 'message-approval',
        bindingFingerprint: 'binding-approval',
        projectResponse: async (response) => {
          projection += 1;
          if (!isRecord(response.body)) {
            throw new Error('expected object response body');
          }
          const body = response.body;
          if (!isRecord(body.pause)) {
            throw new Error('expected approval pause pointer');
          }
          const pause = body.pause;
          return {
            ...response,
            body: {
              ...body,
              pause: {
                ...pause,
                approvalCapability: `transient-${projection}`,
              },
            },
          };
        },
      });
    const first = await reserve();
    if (first.status !== 'ready') {
      throw new Error('expected a new request reservation');
    }
    const pointer = {
      capability: 'placeOrder',
      requestId: '00000000-0000-4000-8000-000000000001',
      expiresAt: '2026-07-20T00:10:00.000Z',
    };

    await expect(first.fence.complete({
      status: 200,
      body: { responseText: 'Approval required.', pause: pointer },
    })).resolves.toEqual({
      completedByOwner: true,
      response: {
        status: 200,
        body: {
          responseText: 'Approval required.',
          pause: {
            ...pointer,
            approvalCapability: 'transient-1',
          },
        },
      },
    });
    const durableResult = complete.mock.calls[0]?.[2];
    expect(durableResult).toEqual({
      status: 200,
      body: {
        responseText: 'Approval required.',
        pause: pointer,
      },
    });
    expect(JSON.stringify(durableResult)).not.toContain(
      'approvalCapability',
    );

    const replay = await reserve();
    expect(replay).toEqual({
      status: 'response',
      response: {
        status: 200,
        body: {
          responseText: 'Approval required.',
          replayed: true,
          pause: {
            ...pointer,
            approvalCapability: 'transient-2',
          },
        },
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('never exposes an old-generation response after ownership changes', async () => {
    const store = new MemoryStore();
    const input = {
      store,
      sessionId: 'kfc:reservation-authority-change',
      clientMessageId: 'message-authority-change',
      bindingFingerprint: 'binding-authority-change',
    };
    const first = await reserveKfcSynchronousRequest(input);
    if (first.status !== 'ready') {
      throw new Error('expected a new request reservation');
    }
    await expect(first.fence.complete({
      status: 200,
      body: { responseText: 'stale model prose' },
    })).resolves.toMatchObject({
      completedByOwner: true,
      response: { status: 200 },
    });
    await store.transitionSessionAuthority({
      sessionId: input.sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });

    const paused = await reserveKfcSynchronousRequest(input);
    expect(paused).toEqual({
      status: 'response',
      response: {
        status: 409,
        body: {
          errorCode: 'agent_run_superseded',
          sessionId: input.sessionId,
          suppressed: true,
        },
      },
    });
    expect(JSON.stringify(paused)).not.toContain('stale model prose');

    await store.transitionSessionAuthority({
      sessionId: input.sessionId,
      expectedGeneration: 1,
      agentMode: 'ai_active',
      assignedAgentId: null,
    });
    const resumed = await reserveKfcSynchronousRequest(input);
    expect(resumed).toEqual(paused);
    expect(JSON.stringify(resumed)).not.toContain('stale model prose');
  });

  it('never identifies a stale completion as the current owner', async () => {
    const store = new MemoryStore();
    const reservation = await reserveKfcSynchronousRequest({
      store,
      sessionId: 'kfc:reservation-stale-completion',
      clientMessageId: 'message-stale-completion',
      bindingFingerprint: 'binding-stale-completion',
    });
    if (reservation.status !== 'ready') {
      throw new Error('expected a new request reservation');
    }
    await store.transitionSessionAuthority({
      sessionId: 'kfc:reservation-stale-completion',
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });

    await expect(reservation.fence.complete({
      status: 200,
      body: { responseText: 'must not be presented as current' },
    })).resolves.toEqual({
      completedByOwner: false,
      response: {
        status: 409,
        body: { errorCode: 'kfc_request_in_progress' },
      },
    });
  });
});
