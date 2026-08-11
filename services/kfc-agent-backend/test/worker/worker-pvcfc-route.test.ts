import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

function env(database: FakeD1Database): WorkerEnv {
  return {
    DB: database,
    KFC_AGENT_PROVIDER: 'google',
    PVCFC_ASTRAFLOW_API_KEY: 'worker-pvcfc-key',
    PVCFC_ASTRAFLOW_BASE_URL: 'https://pvcfc-model.test/v1',
    PVCFC_ASTRAFLOW_MODEL: 'gpt-5.6-luna',
    PVCFC_PUBLIC_DATA_MODE: 'fixture',
    KFC_COMMERCE_MODE: 'fixture',
  };
}

function request(method = 'POST', path = '/chat/pvcfc/message') {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST'
      ? {
          body: JSON.stringify({
            sessionId: 'pvcfc:worker-route',
            customerId: 'worker-route',
            clientMessageId: 'worker-message-1',
            text: 'PVCFC co du lieu cong khai nao?',
            metadata: {
              businessId: 'kfc',
              customerCommand: { kind: 'cart_update' },
            },
          }),
        }
      : {}),
  });
}

function modelResponse(message: Record<string, unknown>, finishReason: string) {
  return new Response(
    JSON.stringify({
      id: crypto.randomUUID(),
      object: 'chat.completion',
      created: 1,
      model: 'gpt-5.6-luna',
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Worker PVCFC trusted route', () => {
  it('dispatches configured PVCFC traffic through the isolated LangChain pack', async () => {
    const database = new FakeD1Database();
    const fetchImpl = vi.fn(async () => {
      return fetchImpl.mock.calls.length === 1
        ? modelResponse(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'collections-1',
                  type: 'function',
                  function: {
                    name: 'listPvcfcCollections',
                    arguments: '{"limit":2}',
                  },
                },
              ],
            },
            'tool_calls',
          )
        : modelResponse(
            {
              role: 'assistant',
              content: 'Thong tin PVCFC da duoc kiem chung.',
            },
            'stop',
          );
    });
    vi.stubGlobal('fetch', fetchImpl);

    const response = await worker.fetch(request(), env(database));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agentRuntime: 'langchain-create-agent',
      status: 'completed',
      responseText: 'Thong tin PVCFC da duoc kiem chung.',
      presentation: {
        profile: 'text',
        text: 'Thong tin PVCFC da duoc kiem chung.',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(database.tables.agent_runs).toEqual([]);
    expect(database.tables.irreversible_operations).toEqual([]);
    expect(database.tables.conversation_turns).toHaveLength(2);
    expect(
      database.tables.conversation_events.map(({ source_type }) => source_type),
    ).not.toEqual(
      expect.arrayContaining([
        'graph:verified_state',
        'cart_changed',
        'confirmation_pause_created',
      ]),
    );
  });

  it('fails closed when the PVCFC model is not configured', async () => {
    const configured = env(new FakeD1Database());
    delete configured.PVCFC_ASTRAFLOW_API_KEY;

    const response = await worker.fetch(request(), configured);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      errorCode: 'pvcfc_agent_not_configured',
    });
  });

  it('keeps unsupported methods and paths outside the PVCFC handler', async () => {
    const database = new FakeD1Database();
    const [method, path] = await Promise.all([
      worker.fetch(request('GET'), env(database)),
      worker.fetch(request('POST', '/chat/pvcfc/unknown'), env(database)),
    ]);

    expect(method.status).toBe(404);
    expect(path.status).toBe(404);
  });
});
