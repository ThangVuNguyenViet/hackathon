export const deployedGitSha = '1'.repeat(40);
export const bridgeGitSha = '3'.repeat(40);
export const sanitySnapshotDigest = '2'.repeat(64);

export function completeLiveEnvironment() {
  return {
    ok: true,
    service: 'kfc-agent-backend',
    release: {
      gitSha: deployedGitSha,
      deploymentId: 'worker-deployment-1',
      builtAt: '2026-07-28T00:00:00.000Z',
      dirty: false,
    },
    checks: {
      observability: {
        ok: true,
        langsmith: {
          configured: true,
          project: 'kfc-live',
          endpoint: 'https://api.smith.langchain.com',
          samplingRate: 1,
        },
      },
    },
    proof: {
      versions: {
        agent: {
          candidateId: 'openai-gpt-4.1-mini',
          provider: 'openai',
          model: 'gpt-4.1-mini',
          profile: 'openai:gpt-4.1-mini:responses',
          transport: 'openai_responses',
        },
        recommendationShadow: {
          ok: true,
          required: false,
          configured: true,
          outputMode: 'learned_technical',
        },
        recommendationSanity: {
          authority: 'sanity',
          configured: true,
          reachable: true,
          snapshotDigest: sanitySnapshotDigest,
        },
      },
    },
  };
}

export function serverTrace(scenarioId: string, probeRunId: string) {
  return {
    authority: 'server_issued_agent_trace_context',
    scenarioId,
    probeRunId,
  };
}

export function completeToolTraceEntry(
  toolName:
    | 'recommendStarter'
    | 'recommendModifierUpsell'
    | 'recommendSmartCrossSell' = 'recommendStarter',
) {
  return {
    toolName,
    arguments: {},
    ok: true,
    resultSummary: 'recommended',
    provenance: [],
  };
}

export function completeNoRecommendationProof(
  sessionId: string,
  toolTrace: unknown[] = [],
) {
  return {
    schemaVersion: 1,
    artifactKind: 'kfc-simple-agent-proof',
    runtime: 'simple-model-tool-loop',
    complete: true,
    missing: [],
    sessionId,
    turns: proofTurns(),
    packState: packState(toolTrace),
    recommendations: {
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
      state: null,
      latestDecision: null,
      pendingAction: null,
      correlations: {
        orderFlowId: null,
        recommendationId: null,
        requestId: null,
        traceRef: null,
      },
      eventCounts: {},
      events: [],
    },
  };
}

export function completeRecommendationD1(input: {
  sessionId: string;
  recommendationId: string;
  orderFlowId: string;
  requestId?: string;
  traceRef?: string;
  toolTrace?: unknown[];
}) {
  const requestId = input.requestId ?? 'request-1';
  const traceRef = input.traceRef ?? 'trace-1';
  const event = {
    eventType: 'decision_completed',
    recommendationId: input.recommendationId,
    requestId,
  };
  const correlations = {
    sessionId: input.sessionId,
    orderFlowId: input.orderFlowId,
    recommendationId: input.recommendationId,
    requestId,
    traceRef,
  };
  const proofCorrelations = {
    orderFlowId: input.orderFlowId,
    recommendationId: input.recommendationId,
    requestId,
    traceRef,
  };
  return {
    proofEnvelope: {
      schemaVersion: 1,
      artifactKind: 'kfc-simple-agent-proof',
      runtime: 'simple-model-tool-loop',
      complete: true,
      missing: [],
      sessionId: input.sessionId,
      turns: proofTurns(),
      packState: packState(
        input.toolTrace ?? [completeToolTraceEntry()],
      ),
      recommendations: {
        schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
        state: {
          orderFlowId: input.orderFlowId,
          stage: 'smart_cross_sell_completed',
        },
        latestDecision: {
          recommendationId: input.recommendationId,
          requestId,
          traceRef,
        },
        pendingAction: null,
        correlations: proofCorrelations,
        eventCounts: { decision_completed: 1 },
        events: [event],
      },
    },
    recommendationInspection: {
      schemaVersion: 'kfc-recommendation-inspection-v1',
      recommendation: {
        response: {
          recommendationId: input.recommendationId,
          traceRef,
        },
        actionDigest: '8'.repeat(64),
        requestFingerprint: '9'.repeat(64),
        recordedAt: '2026-07-28T00:00:01.000Z',
      },
      technical: {
        shadowComparison: {
          status: 'succeeded',
          outputMode: 'learned_technical',
          modelRevision: 'hf-revision-1',
        },
      },
      state: {
        orderFlowId: input.orderFlowId,
        stage: 'smart_cross_sell_completed',
      },
      events: [event],
      correlations,
    },
    orderFlowState: {
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
      state: {
        orderFlowId: input.orderFlowId,
        stage: 'smart_cross_sell_completed',
      },
      latestDecision: {
        recommendationId: input.recommendationId,
        requestId,
        traceRef,
      },
      pendingAction: null,
      correlations,
      eventCounts: { decision_completed: 1 },
      events: [event],
    },
  };
}

function proofTurns() {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: { characterCount: 10, sha256: '4'.repeat(64) },
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: { characterCount: 10, sha256: '5'.repeat(64) },
    },
  ];
}

function packState(toolTrace: unknown[]) {
  return {
    envelopeVersion: 1,
    packRef: { packId: 'kfc-vietnam', version: '1' },
    schemaVersion: '1',
    state: { toolTrace },
    integrity: { algorithm: 'sha256', digest: '6'.repeat(64) },
  };
}
