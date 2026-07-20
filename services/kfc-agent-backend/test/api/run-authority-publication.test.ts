import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

describe('KFC run authority publication', () => {
  it('does not publish or replay model prose after human ownership invalidates a direct run', async () => {
    const store = new MemoryStore();
    let releaseModel!: () => void;
    let markModelEntered!: () => void;
    const modelReleased = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const modelEntered = new Promise<void>((resolve) => {
      markModelEntered = resolve;
    });
    const leakedModelText = 'This stale model response must never be public.';
    const model = fakeModel();
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const generate = vi.spyOn(model, '_generate').mockImplementation(
      async (messages) => {
        markModelEntered();
        await modelReleased;
        return {
          generations: [{
            text: '',
            message: groundedResponseModelReply({
              customerText: leakedModelText,
            })(messages),
          }],
        };
      },
    );
    const server = buildServer({
      store,
      checkpointer: new MemorySaver(),
      ...testAgent(model),
    });
    const request = {
      sessionId: 'kfc:authority_race_customer',
      customerId: 'authority_race_customer',
      clientMessageId: 'authority_race_message',
      text: 'Cho mình xem thực đơn',
    };

    const responsePromise = server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: request,
    });
    const firstBoundary = await Promise.race([
      modelEntered.then(() => ({ kind: 'model_entered' as const })),
      responsePromise.then((response) => ({
        kind: 'response' as const,
        response,
      })),
    ]);
    if (firstBoundary.kind === 'response') {
      throw new Error(
        `direct run ended before model boundary: ` +
        `${firstBoundary.response.statusCode} ` +
        firstBoundary.response.body,
      );
    }
    const join = await server.inject({
      method: 'POST',
      url:
        '/dashboard/sessions/' +
        'kfc%3Aauthority_race_customer/human-join',
      payload: { agentId: 'agent_1' },
    });
    expect(join.statusCode).toBe(200);
    releaseModel();

    const response = await responsePromise;
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toEqual({
      errorCode: 'agent_run_superseded',
      sessionId: request.sessionId,
      suppressed: true,
    });
    expect(response.body).not.toContain(leakedModelText);
    expect(
      (await store.listTurns(request.sessionId))
        .filter(({ role }) => role === 'assistant'),
    ).toEqual([]);

    const retry = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: request,
    });
    expect(retry.body).not.toContain(leakedModelText);
    expect(generate).toHaveBeenCalledOnce();
  });

  it('emits no model text or GenUI after human ownership invalidates a streaming run', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    let releaseModel!: () => void;
    let markModelEntered!: () => void;
    const modelReleased = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const modelEntered = new Promise<void>((resolve) => {
      markModelEntered = resolve;
    });
    const leakedModelText = 'This stale stream text must never be emitted.';
    const model = fakeModel();
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const generate = vi.spyOn(model, '_generate').mockImplementation(
      async (messages) => {
        markModelEntered();
        await modelReleased;
        return {
          generations: [{
            text: '',
            message: groundedResponseModelReply({
              customerText: leakedModelText,
            })(messages),
          }],
        };
      },
    );
    const server = buildServer({
      store,
      checkpointer: new MemorySaver(),
      defer: (task) => deferred.push(task),
      customerRunPaceMs: 0,
      ...testAgent(model),
    });
    const sessionId = 'kfc:stream_authority_race_customer';

    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        sessionId,
        customerId: 'stream_authority_race_customer',
        clientMessageId: 'stream_authority_race_message',
        input: {
          kind: 'text',
          text: 'Cho mình xem thực đơn',
        },
      },
    });
    expect(started.statusCode).toBe(202);
    const execution = deferred.shift();
    if (!execution) throw new Error('stream execution was not deferred');
    const executionPromise = execution();
    await modelEntered;
    const join = await server.inject({
      method: 'POST',
      url:
        '/dashboard/sessions/' +
        'kfc%3Astream_authority_race_customer/human-join',
      payload: { agentId: 'agent_1' },
    });
    expect(join.statusCode).toBe(200);
    releaseModel();
    await executionPromise;

    const runId = started.json().runId as string;
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      status: 'superseded',
    });
    const eventTypes = (
      await store.listCustomerRunEvents(runId)
    ).map(({ type }) => type);
    expect(eventTypes).toContain('run_superseded');
    expect(eventTypes).not.toEqual(expect.arrayContaining([
      'genui_revision',
      'genui_snapshot',
      'text_started',
      'text_delta',
      'run_completed',
    ]));
    expect(
      (await store.listTurns(sessionId))
        .filter(({ role }) => role === 'assistant'),
    ).toEqual([]);
    expect(
      JSON.stringify(await store.listCustomerRunEvents(runId)),
    ).not.toContain(leakedModelText);
    expect(generate).toHaveBeenCalledOnce();
  });
});
