import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';

describe('dashboard session authority transitions', () => {
  it('uses exact idempotent authority transitions without the compatibility setter', async () => {
    const store = new MemoryStore();
    const compatibilitySetter =
      vi.spyOn(store, 'setSessionControl');
    const server = buildServer({ store });
    const sessionId = 'kfc:dashboard_authority_customer';
    const encodedSessionId = encodeURIComponent(sessionId);

    const join = await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/human-join`,
      payload: { agentId: 'agent_1' },
    });
    const repeatedJoin = await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/human-join`,
      payload: { agentId: 'agent_1' },
    });
    const resume = await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/resume-ai`,
      payload: { agentId: 'agent_1' },
    });
    const repeatedResume = await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/resume-ai`,
      payload: { agentId: 'agent_1' },
    });

    expect(join.statusCode).toBe(200);
    expect(join.json()).toMatchObject({
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
      sessionAuthorityGeneration: 1,
    });
    expect(repeatedJoin.statusCode).toBe(200);
    expect(repeatedJoin.json()).toMatchObject({
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
      sessionAuthorityGeneration: 1,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 3,
    });
    expect(repeatedResume.statusCode).toBe(200);
    expect(repeatedResume.json()).toMatchObject({
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 3,
      recoveryQueued: false,
    });
    expect(compatibilitySetter).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict without mutating stale authority', async () => {
    const store = new MemoryStore();
    const transition =
      store.transitionSessionAuthority.bind(store);
    vi.spyOn(store, 'transitionSessionAuthority')
      .mockImplementationOnce(async () => ({
        status: 'stale',
        control: await store.getSessionControl(
          'kfc:dashboard_stale_customer',
        ),
      }))
      .mockImplementation(transition);
    const server = buildServer({ store });
    const url =
      '/dashboard/sessions/' +
      'kfc%3Adashboard_stale_customer/human-join';

    const stale = await server.inject({
      method: 'POST',
      url,
      payload: { agentId: 'agent_1' },
    });
    const retry = await server.inject({
      method: 'POST',
      url,
      payload: { agentId: 'agent_1' },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      errorCode: 'session_authority_conflict',
      control: {
        agentMode: 'ai_active',
        sessionAuthorityGeneration: 0,
      },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      agentMode: 'human_paused',
      sessionAuthorityGeneration: 1,
    });
  });

  it('never opens AI authority when a human rejoins during resume cleanup', async () => {
    const store = new MemoryStore();
    const server = buildServer({ store });
    const sessionId = 'kfc:dashboard_resume_race_customer';
    const encodedSessionId = encodeURIComponent(sessionId);
    await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/human-join`,
      payload: { agentId: 'agent_1' },
    });
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: {
        handoff: { reason: 'customer_requested' },
      },
    });
    const appendEvent = store.appendEvent.bind(store);
    let rejoined = false;
    vi.spyOn(store, 'appendEvent').mockImplementation(
      async (candidateSessionId, sourceType, payload) => {
        if (
          !rejoined &&
          candidateSessionId === sessionId &&
          sourceType === 'graph:verified_state' &&
          typeof payload.verifiedState === 'object' &&
          payload.verifiedState !== null &&
          !Object.hasOwn(payload.verifiedState, 'handoff')
        ) {
          rejoined = true;
          const current = await store.getSessionControl(sessionId);
          const transition = await store.transitionSessionAuthority({
            sessionId,
            expectedGeneration:
              current.sessionAuthorityGeneration,
            agentMode: 'human_paused',
            assignedAgentId: 'agent_2',
          });
          expect(transition.status).toBe('transitioned');
        }
        return appendEvent(candidateSessionId, sourceType, payload);
      },
    );

    const resume = await server.inject({
      method: 'POST',
      url: `/dashboard/sessions/${encodedSessionId}/resume-ai`,
      payload: { agentId: 'agent_1' },
    });

    expect(resume.statusCode).toBe(409);
    expect(resume.json()).toMatchObject({
      errorCode: 'session_authority_conflict',
      control: {
        agentMode: 'human_paused',
        assignedAgentId: 'agent_2',
      },
    });
    await expect(store.getSessionControl(sessionId)).resolves.toMatchObject({
      agentMode: 'human_paused',
      assignedAgentId: 'agent_2',
    });
  });
});
