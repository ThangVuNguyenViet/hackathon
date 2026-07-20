import { describe, expect, it } from 'vitest';
import {
  verifyRequiredAgentTracePublication,
  type PublishedAgentTraceRun,
  type RequiredAgentTracePublicationClient,
  type RequiredAgentTraceRunExpectation,
} from '../../src/observability/requiredAgentTracePublication.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const graphId = '00000000-0000-4000-8000-000000000002';
const modelId = '00000000-0000-4000-8000-000000000003';
const toolId = '00000000-0000-4000-8000-000000000004';
const approvalId = '00000000-0000-4000-8000-000000000005';
const stateId = '00000000-0000-4000-8000-000000000006';
const metadataDigest = 'a'.repeat(64);
const inputDigest = 'b'.repeat(64);
const outputDigest = 'c'.repeat(64);

function expectedRuns(): RequiredAgentTraceRunExpectation[] {
  return [
    {
      id: rootId,
      traceId: rootId,
      name: 'agent_turn',
      runType: 'chain',
      category: 'agent_loop',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
    {
      id: graphId,
      traceId: rootId,
      parentRunId: rootId,
      name: 'agent_graph_node',
      runType: 'chain',
      category: 'graph_node',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
    {
      id: modelId,
      traceId: rootId,
      parentRunId: rootId,
      name: 'agent_model',
      runType: 'llm',
      category: 'model',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
    {
      id: toolId,
      traceId: rootId,
      parentRunId: rootId,
      name: 'agent_tool',
      runType: 'tool',
      category: 'tool',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
    {
      id: approvalId,
      traceId: rootId,
      parentRunId: rootId,
      name: 'agent_approval',
      runType: 'chain',
      category: 'approval',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
    {
      id: stateId,
      traceId: rootId,
      parentRunId: rootId,
      name: 'state_update',
      runType: 'chain',
      category: 'verified_state',
      metadataDigest,
      inputDigest,
      outputDigest,
      completion: 'succeeded',
    },
  ];
}

function publishedRuns(
  expectations: readonly RequiredAgentTraceRunExpectation[] = expectedRuns(),
): PublishedAgentTraceRun[] {
  return expectations.map((run, index) => {
    const startTimeMs = 1_000 + index * 10;
    const durationMs =
      run.parentRunId === undefined
        ? 100
        : run.runType === 'llm'
          ? 30
          : run.runType === 'tool'
            ? 15
            : 10;
    return {
      ...run,
      startTimeMs,
      endTimeMs: startTimeMs + durationMs,
      ...(run.runType === 'llm'
        ? { usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 } }
        : {}),
    };
  });
}

function clientFor(runs: readonly PublishedAgentTraceRun[]): {
  client: RequiredAgentTracePublicationClient;
  queries: Array<{ projectName: string; runIds: readonly string[] }>;
} {
  const queries: Array<{ projectName: string; runIds: readonly string[] }> = [];
  return {
    queries,
    client: {
      async listRuns(query) {
        queries.push(query);
        return runs;
      },
    },
  };
}

function verificationInput(client: RequiredAgentTracePublicationClient) {
  return {
    target: {
      apiUrl: 'https://apac.api.smith.langchain.com' as const,
      projectName: 'private-apac-project',
    },
    flushSucceeded: true as const,
    mode: 'text' as const,
    expectedRuns: expectedRuns(),
    client,
  };
}

describe('required agent trace publication readback', () => {
  it('binds exact APAC project readback and derives aggregate latency and tokens', async () => {
    const { client, queries } = clientFor(publishedRuns());

    const result = await verifyRequiredAgentTracePublication(
      verificationInput(client),
    );

    expect(queries).toEqual([
      {
        projectName: 'private-apac-project',
        runIds: [rootId, graphId, modelId, toolId, approvalId, stateId],
      },
    ]);
    expect(result).toEqual({
      verified: true,
      flushVerified: true,
      readbackVerified: true,
      queryAttempts: 1,
      runIds: [rootId, graphId, modelId, toolId, approvalId, stateId],
      traceIds: [rootId],
      latency: { totalMs: 100, modelMs: 30, toolMs: 15 },
      usage: {
        status: 'reported',
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
      cost: { status: 'provider_did_not_report' },
    });
  });

  it.each([
    {
      label: 'missing evidence',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs.pop();
      },
    },
    {
      label: 'duplicate evidence',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs.push(structuredClone(runs[0]));
      },
    },
    {
      label: 'foreign evidence',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs.push({ ...structuredClone(runs[0]), id: crypto.randomUUID() });
      },
    },
    {
      label: 'hierarchy drift',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs[1] = { ...runs[1], parentRunId: crypto.randomUUID() };
      },
    },
    {
      label: 'digest drift',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs[2] = { ...runs[2], inputDigest: 'd'.repeat(64) };
      },
    },
    {
      label: 'incomplete run',
      mutate(runs: PublishedAgentTraceRun[]) {
        runs[0] = { ...runs[0], completion: 'running' };
      },
    },
  ])('fails closed for $label', async ({ mutate }) => {
    const runs = publishedRuns();
    mutate(runs);
    const { client } = clientFor(runs);

    await expect(
      verifyRequiredAgentTracePublication(verificationInput(client)),
    ).rejects.toThrow('agent_required_trace_publication_invalid');
  });

  it('rejects cross-trace parents and disconnected parent cycles', async () => {
    const secondRunIds = expectedRuns().map(
      (_, index) =>
        `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const secondRootId = secondRunIds[0];
    if (secondRootId === undefined) throw new Error('test_fixture_invalid');
    const secondTrace = expectedRuns().map((run, index) => {
      const id = secondRunIds[index];
      if (id === undefined) throw new Error('test_fixture_invalid');
      return {
        ...run,
        id,
        traceId: secondRootId,
        ...(run.parentRunId === undefined
          ? { parentRunId: undefined }
          : { parentRunId: secondRootId }),
      };
    });
    const expectations = [...expectedRuns(), ...secondTrace];
    const crossTrace = publishedRuns(expectations);
    crossTrace[1] = { ...crossTrace[1], parentRunId: secondRootId };
    const crossTraceClient = clientFor(crossTrace).client;

    await expect(
      verifyRequiredAgentTracePublication({
        ...verificationInput(crossTraceClient),
        expectedRuns: expectations.map((run, index) =>
          index === 1 ? { ...run, parentRunId: secondRootId } : run,
        ),
      }),
    ).rejects.toThrow('agent_required_trace_publication_invalid');

    const cycleExpectations = expectedRuns();
    cycleExpectations[1] = { ...cycleExpectations[1], parentRunId: approvalId };
    cycleExpectations[4] = { ...cycleExpectations[4], parentRunId: graphId };
    const cycleClient = clientFor(publishedRuns(cycleExpectations)).client;
    await expect(
      verifyRequiredAgentTracePublication({
        ...verificationInput(cycleClient),
        expectedRuns: cycleExpectations,
      }),
    ).rejects.toThrow('agent_required_trace_publication_invalid');
  });

  it('requires protected category coverage independently for every trace', async () => {
    const secondRootId = '30000000-0000-4000-8000-000000000001';
    const incompleteTrace: RequiredAgentTraceRunExpectation[] = [
      {
        ...expectedRuns()[0],
        id: secondRootId,
        traceId: secondRootId,
      },
    ];
    const expectations = [...expectedRuns(), ...incompleteTrace];
    const { client } = clientFor(publishedRuns(expectations));

    await expect(
      verifyRequiredAgentTracePublication({
        ...verificationInput(client),
        expectedRuns: expectations,
      }),
    ).rejects.toThrow('agent_required_trace_categories_invalid');
  });

  it('rejects zero-token reported usage that cannot enter the manifest', async () => {
    const runs = publishedRuns().map((run) =>
      run.runType === 'llm'
        ? {
            ...run,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          }
        : run,
    );
    const { client } = clientFor(runs);

    await expect(
      verifyRequiredAgentTracePublication(verificationInput(client)),
    ).rejects.toThrow('agent_required_trace_publication_invalid');
  });

  it('rejects aggregate latency outside immutable receipt bounds', async () => {
    const runs = publishedRuns();
    runs[0] = {
      ...runs[0],
      endTimeMs: runs[0].startTimeMs + 8 * 24 * 60 * 60 * 1_000,
    };
    const { client } = clientFor(runs);

    await expect(
      verifyRequiredAgentTracePublication(verificationInput(client)),
    ).rejects.toThrow('agent_required_trace_publication_invalid');
  });

  it('requires GenUI projection evidence for GenUI readback', async () => {
    const { client } = clientFor(publishedRuns());

    await expect(
      verifyRequiredAgentTracePublication({
        ...verificationInput(client),
        mode: 'genui',
      }),
    ).rejects.toThrow('agent_required_trace_categories_invalid');
  });

  it('rejects non-APAC targets and unverified flushes before readback', async () => {
    const { client } = clientFor(publishedRuns());
    const wrongRegion = verificationInput(client);

    await expect(
      verifyRequiredAgentTracePublication({
        ...wrongRegion,
        target: {
          ...wrongRegion.target,
          apiUrl: 'https://api.smith.langchain.com',
        },
      }),
    ).rejects.toThrow('agent_required_trace_target_invalid');

    await expect(
      verifyRequiredAgentTracePublication({
        ...verificationInput(client),
        flushSucceeded: false,
      }),
    ).rejects.toThrow('agent_required_trace_flush_unverified');
  });
});
