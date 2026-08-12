import { fakeModel } from '@langchain/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  LangSmithAgentTracer,
} from '../../src/observability/langsmithAgentTracer.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { testAgent } from '../fixtures/testAgent.js';

interface CapturedTurn {
  name: string;
  metadata?: Record<string, unknown>;
}

function transportedAgentTurn(
  requestBodies: string[],
): { id: string; metadata: Record<string, unknown> } | undefined {
  for (const body of requestBodies) {
    const value: unknown = JSON.parse(body);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('name' in value) ||
      value.name !== 'kfc_langchain_turn' ||
      !('extra' in value) ||
      typeof value.extra !== 'object' ||
      value.extra === null ||
      Array.isArray(value.extra) ||
      !('metadata' in value.extra) ||
      typeof value.extra.metadata !== 'object' ||
      value.extra.metadata === null ||
      Array.isArray(value.extra.metadata) ||
      !('id' in value) ||
      typeof value.id !== 'string'
    ) {
      continue;
    }
    return {
      id: value.id,
      metadata: value.extra.metadata as Record<string, unknown>,
    };
  }
  return undefined;
}

function captureTracer(turns: CapturedTurn[]): AgentTracer {
  const span: AgentTraceSpan = {
    async startSpan() {
      return span;
    },
    async end() {},
    async fail() {},
  };
  return {
    async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>) {
      turns.push({ name: input.name, metadata: input.metadata });
      return span;
    },
    async flush() {},
  };
}

describe('public trace correlation authority', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('does not promote synchronous request metadata into trace correlation', async () => {
    const sentinel = 'PRIVATE ADDRESS SENTINEL correlation injection';
    const turns: CapturedTurn[] = [];
    const server = buildServer({
      agentTracer: captureTracer(turns),
      ...testAgent(
        fakeModel().respond(groundedResponseModelReply({
          customerText: 'How can I help?',
        })),
      ),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:trace_authority_sync',
        customerId: 'trace_authority_sync',
        clientMessageId: 'trace_authority_sync_message',
        text: 'Hello',
        metadata: {
          scenarioId: sentinel,
          probeRunId: sentinel,
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const agentTurn = turns.find(
      ({ name }) => name === 'kfc_langchain_turn',
    );
    expect(agentTurn?.metadata).toMatchObject({
      scenarioId: 'live-agent',
      probeRunId: null,
    });
    expect(JSON.stringify(turns)).not.toContain(sentinel);
  });

  it('does not promote streaming start metadata into trace correlation', async () => {
    const sentinel = 'PRIVATE ADDRESS SENTINEL streaming injection';
    const deferred: Array<() => Promise<void>> = [];
    const requestBodies: string[] = [];
    const priorTracing = process.env.LANGSMITH_TRACING;
    process.env.LANGSMITH_TRACING = 'true';
    const tracer = new LangSmithAgentTracer({
      projectName: 'trace-correlation-authority-test',
      apiKey: 'test-api-key',
      apiUrl: 'https://langsmith.invalid',
      autoBatchTracing: false,
      fetchImplementation: async (_input, init) => {
        if (init?.body !== undefined && init.body !== null) {
          requestBodies.push(await new Response(init.body).text());
        }
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const server = buildServer({
      agentTracer: tracer,
      defer: (task) => deferred.push(task),
      ...testAgent(
        fakeModel().respond(groundedResponseModelReply({
          customerText: 'How can I help?',
        })),
      ),
    });
    servers.push(server);

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/chat/kfc/runs',
        payload: {
          schemaVersion: 1,
          sessionId: 'kfc:trace_authority_stream',
          customerId: 'trace_authority_stream',
          clientMessageId: 'trace_authority_stream_message',
          metadata: {
            scenarioId: sentinel,
            probeRunId: sentinel,
          },
          input: {
            kind: 'text',
            text: 'Hello',
          },
        },
      });

      expect(response.statusCode, response.body).toBe(202);
      expect(deferred).toHaveLength(1);
      await deferred[0]!();
      await tracer.flush();
    } finally {
      if (priorTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = priorTracing;
      }
    }

    expect(requestBodies.length).toBeGreaterThan(0);
    expect(requestBodies.join('\n')).not.toContain(sentinel);
    const applicationTurn = transportedAgentTurn(requestBodies);
    expect(applicationTurn?.metadata).toMatchObject({
      scenarioId: 'live-agent',
      probeRunId: null,
    });
    const transported = requestBodies.join('\n');
    expect(transported).toContain(`"trace_id":"${applicationTurn?.id}"`);
    expect(transported).toContain(
      `"parent_run_id":"${applicationTurn?.id}"`,
    );
    expect(transported).toContain('"run_type":"llm"');
  });
});
