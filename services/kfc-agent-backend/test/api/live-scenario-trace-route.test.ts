import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

const adminToken = 'live-scenario-admin-token';
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('live scenario trace HTTP boundary', () => {
  it('requires admin authority and issues LangSmith correlation to the agent turn', async () => {
    const starts: Array<Omit<AgentTraceSpanInput, 'runType'>> = [];
    const span: AgentTraceSpan = {
      async startSpan() {
        return span;
      },
      async end() {},
      async fail() {},
    };
    const tracer: AgentTracer = {
      async startTurn(input) {
        starts.push(input);
        return span;
      },
      async flush() {},
    };
    const server = buildServer({
      demoAdminToken: adminToken,
      agent: configuredTestAgent(
        new FakeListChatModel({ responses: ['Xin chào!'] }),
      ),
      agentTracer: tracer,
    });
    servers.push(server);
    const payload = {
      request: {
        sessionId: 'kfc:live-trace-route',
        customerId: 'live-trace-route',
        clientMessageId: 'run-1:user:1',
        text: 'Giữ nguyên tin nhắn này.',
      },
      trace: {
        scenarioId: 'scenario-improvised',
        probeRunId: 'run-1',
      },
    };

    const unauthorized = await server.inject({
      method: 'POST',
      url: '/admin/live-scenarios/chat/kfc/message',
      payload,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(starts).toHaveLength(0);

    const response = await server.inject({
      method: 'POST',
      url: '/admin/live-scenarios/chat/kfc/message',
      headers: { 'x-kfc-demo-admin-token': adminToken },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.metadata).toMatchObject({
      scenarioId: 'scenario-improvised',
      probeRunId: 'run-1',
    });
  });

  it('rejects invalid trace correlation before invoking the agent', async () => {
    const server = buildServer({ demoAdminToken: adminToken });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/admin/live-scenarios/chat/kfc/message',
      headers: { 'x-kfc-demo-admin-token': adminToken },
      payload: {
        request: {
          sessionId: 'kfc:live-invalid-trace',
          customerId: 'live-invalid-trace',
          clientMessageId: 'run-1:user:1',
          text: 'Tin nhắn.',
        },
        trace: {
          scenarioId: 'scenario with spaces',
          probeRunId: 'run-1',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      errorCode: 'invalid_live_scenario_trace_envelope',
    });
  });
});
