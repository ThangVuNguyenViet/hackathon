import { describe, expect, it } from 'vitest';
import {
  liveScenarioEvidenceMissing,
  type LiveScenarioEvidenceCompletenessInput,
} from '../../src/liveEvidence/liveScenarioEvidenceCompleteness.js';

const sha = (value: string): string => value.repeat(64).slice(0, 64);

function completeEvidence(): LiveScenarioEvidenceCompletenessInput {
  return {
    environment: {
      ok: true,
      service: 'kfc-agent-backend',
      release: {
        gitSha: '1'.repeat(40),
        deploymentId: 'deployment-1',
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
            snapshotDigest: sha('2'),
          },
        },
      },
    },
    bridgeSource: { gitSha: '3'.repeat(40), dirty: false },
    scenarioSourceSha256: sha('4'),
    correlation: {
      sessionId: 'kfc:live-complete',
      customerId: 'live-complete',
      scenarioId: 'scenario-complete',
      probeRunId: 'run-complete',
    },
    timeline: [
      {
        type: 'user_message',
        text: 'Improvised customer turn.',
        clientMessageId: 'run-complete:user:1',
      },
      {
        type: 'assistant_message',
        text: 'Improvised assistant turn.',
        assistantTurnId: 'assistant-1',
        renderedActionReferences: [],
        response: {
          responseText: 'Improvised assistant turn.',
          assistantTurnId: 'assistant-1',
          liveScenarioTrace: {
            authority: 'server_issued_agent_trace_context',
            scenarioId: 'scenario-complete',
            probeRunId: 'run-complete',
          },
        },
      },
    ],
    d1: {
      proofEnvelope: {
        schemaVersion: 1,
        artifactKind: 'kfc-simple-agent-proof',
        runtime: 'simple-model-tool-loop',
        complete: true,
        missing: [],
        sessionId: 'kfc:live-complete',
        turns: [
          {
            id: 'user-1',
            role: 'user',
            content: { characterCount: 25, sha256: sha('5') },
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: { characterCount: 26, sha256: sha('6') },
          },
        ],
        packState: {
          envelopeVersion: 1,
          packRef: { packId: 'kfc-vietnam', version: '1' },
          schemaVersion: '1',
          state: { toolTrace: [] },
          integrity: { algorithm: 'sha256', digest: sha('7') },
        },
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
      },
    },
  };
}

function completeRecommendationEvidence(): LiveScenarioEvidenceCompletenessInput {
  const input = completeEvidence();
  const packState = input.d1.proofEnvelope.packState as Record<
    string,
    unknown
  >;
  const state = packState.state as Record<string, unknown>;
  state.toolTrace = [
    {
      toolName: 'recommendStarter',
      arguments: {},
      ok: true,
      resultSummary: 'recommended',
      provenance: [],
    },
  ];
  input.d1.proofEnvelope.recommendations = {
    schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
    state: { orderFlowId: 'order-flow-1', stage: 'smart_cross_sell_completed' },
    latestDecision: {
      recommendationId: 'recommendation-1',
      requestId: 'request-1',
      traceRef: 'trace-1',
    },
    pendingAction: null,
    correlations: {
      orderFlowId: 'order-flow-1',
      recommendationId: 'recommendation-1',
      requestId: 'request-1',
      traceRef: 'trace-1',
    },
    eventCounts: { decision_completed: 1 },
    events: [
      {
        eventType: 'decision_completed',
        recommendationId: 'recommendation-1',
        requestId: 'request-1',
      },
    ],
  };
  input.d1.recommendationInspection = {
    schemaVersion: 'kfc-recommendation-inspection-v1',
    recommendation: {
      response: {
        recommendationId: 'recommendation-1',
        traceRef: 'trace-1',
      },
      actionDigest: sha('8'),
      requestFingerprint: sha('9'),
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
      orderFlowId: 'order-flow-1',
      stage: 'smart_cross_sell_completed',
    },
    events: [
      {
        eventType: 'decision_completed',
        recommendationId: 'recommendation-1',
        requestId: 'request-1',
      },
    ],
    correlations: {
      sessionId: 'kfc:live-complete',
      orderFlowId: 'order-flow-1',
      recommendationId: 'recommendation-1',
      requestId: 'request-1',
      traceRef: 'trace-1',
    },
  };
  input.d1.orderFlowState = {
    schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
    state: {
      orderFlowId: 'order-flow-1',
      stage: 'smart_cross_sell_completed',
    },
    latestDecision: {
      recommendationId: 'recommendation-1',
      requestId: 'request-1',
      traceRef: 'trace-1',
    },
    pendingAction: null,
    correlations: {
      sessionId: 'kfc:live-complete',
      orderFlowId: 'order-flow-1',
      recommendationId: 'recommendation-1',
      requestId: 'request-1',
      traceRef: 'trace-1',
    },
    eventCounts: { decision_completed: 1 },
    events: [
      {
        eventType: 'decision_completed',
        recommendationId: 'recommendation-1',
        requestId: 'request-1',
      },
    ],
  };
  return input;
}

describe('live scenario evidence completeness', () => {
  it('accepts an explicit bounded no-recommendation evidence envelope', () => {
    expect(liveScenarioEvidenceMissing(completeEvidence())).toEqual([]);
  });

  it.each([
    {
      label: 'deployed source commit',
      missing: 'environment.release.gitSha',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete (input.environment.release as Record<string, unknown>).gitSha;
      },
    },
    {
      label: 'bridge source commit',
      missing: 'source.bridge.gitSha',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.bridgeSource.gitSha = 'not-a-commit';
      },
    },
    {
      label: 'scenario source digest',
      missing: 'scenario.sourceSha256',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.scenarioSourceSha256 = 'not-a-digest';
      },
    },
    {
      label: 'LangSmith enablement',
      missing: 'environment.checks.observability.langsmith.configured',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const checks = input.environment.checks as Record<string, unknown>;
        const observability = checks.observability as Record<string, unknown>;
        const langsmith = observability.langsmith as Record<string, unknown>;
        langsmith.configured = false;
      },
    },
    {
      label: 'LangSmith query project',
      missing: 'environment.checks.observability.langsmith.project',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const checks = input.environment.checks as Record<string, unknown>;
        const observability = checks.observability as Record<string, unknown>;
        const langsmith = observability.langsmith as Record<string, unknown>;
        delete langsmith.project;
      },
    },
    {
      label: 'LangSmith query endpoint',
      missing: 'environment.checks.observability.langsmith.endpoint',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const checks = input.environment.checks as Record<string, unknown>;
        const observability = checks.observability as Record<string, unknown>;
        const langsmith = observability.langsmith as Record<string, unknown>;
        langsmith.endpoint = 'not-a-url';
      },
    },
    {
      label: 'LangSmith sampling',
      missing: 'environment.checks.observability.langsmith.samplingRate',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const checks = input.environment.checks as Record<string, unknown>;
        const observability = checks.observability as Record<string, unknown>;
        const langsmith = observability.langsmith as Record<string, unknown>;
        langsmith.samplingRate = 0;
      },
    },
    {
      label: 'agent binding',
      missing: 'environment.proof.versions.agent',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const proof = input.environment.proof as Record<string, unknown>;
        const versions = proof.versions as Record<string, unknown>;
        versions.agent = { candidateId: 'openai-gpt-4.1-mini' };
      },
    },
    {
      label: 'shadow binding',
      missing: 'environment.proof.versions.recommendationShadow',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const proof = input.environment.proof as Record<string, unknown>;
        const versions = proof.versions as Record<string, unknown>;
        delete versions.recommendationShadow;
      },
    },
    {
      label: 'Sanity binding',
      missing: 'environment.proof.versions.recommendationSanity',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const proof = input.environment.proof as Record<string, unknown>;
        const versions = proof.versions as Record<string, unknown>;
        const sanity = versions.recommendationSanity as Record<string, unknown>;
        sanity.reachable = false;
      },
    },
  ])('reports exactly the missing $label', ({ missing, mutate }) => {
    const input = completeEvidence();
    mutate(input);

    expect(liveScenarioEvidenceMissing(input)).toEqual([missing]);
  });

  it.each([
    {
      label: 'session correlation',
      missing: 'correlation.sessionId',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.correlation.sessionId = 'kfc:a-different-customer';
        input.d1.proofEnvelope.sessionId = 'kfc:a-different-customer';
      },
    },
    {
      label: 'scenario correlation',
      missing: 'correlation.scenarioId',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.correlation.scenarioId = '';
        const assistant = input.timeline.find(
          (event) => event.type === 'assistant_message',
        )!;
        const response = assistant.response as Record<string, unknown>;
        const trace = response.liveScenarioTrace as Record<string, unknown>;
        trace.scenarioId = '';
      },
    },
    {
      label: 'probe correlation',
      missing: 'correlation.probeRunId',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.correlation.probeRunId = '';
        const assistant = input.timeline.find(
          (event) => event.type === 'assistant_message',
        )!;
        const response = assistant.response as Record<string, unknown>;
        const trace = response.liveScenarioTrace as Record<string, unknown>;
        trace.probeRunId = '';
      },
    },
    {
      label: 'customer transcript',
      missing: 'timeline.user_message',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.timeline = input.timeline.filter(
          (event) => event.type !== 'user_message',
        );
      },
    },
    {
      label: 'assistant transcript',
      missing: 'timeline.assistant_message',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.timeline = input.timeline.filter(
          (event) => event.type !== 'assistant_message',
        );
      },
    },
    {
      label: 'server-issued LangSmith correlation',
      missing: 'timeline.assistant_message.liveScenarioTrace',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const assistant = input.timeline.find(
          (event) => event.type === 'assistant_message',
        )!;
        const response = assistant.response as Record<string, unknown>;
        delete response.liveScenarioTrace;
      },
    },
    {
      label: 'rendered action references',
      missing: 'timeline.assistant_message.renderedActionReferences',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const assistant = input.timeline.find(
          (event) => event.type === 'assistant_message',
        )!;
        assistant.genUi = {
          id: 'attachment-1',
          actions: [{ id: 'recommendation_select:action-1' }],
        };
        assistant.renderedActionReferences = [];
      },
    },
    {
      label: 'submitted action reference',
      missing: 'timeline.action_submitted.renderedReference',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.timeline.push({
          type: 'action_submitted',
          assistantTurnId: 'assistant-1',
          attachmentId: 'unobserved-attachment',
          actionId: 'unobserved-action',
          clientMessageId: 'run-complete:action:2',
        });
      },
    },
  ])('reports exactly the missing $label', ({ missing, mutate }) => {
    const input = completeEvidence();
    mutate(input);

    expect(liveScenarioEvidenceMissing(input)).toEqual([missing]);
  });

  it.each([
    {
      label: 'proof schema',
      missing: 'd1.proofEnvelope.schema',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete input.d1.proofEnvelope.artifactKind;
      },
    },
    {
      label: 'proof missing list',
      missing: 'd1.proofEnvelope.missing',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.d1.proofEnvelope.missing = ['pack_state'];
      },
    },
    {
      label: 'proof session',
      missing: 'd1.proofEnvelope.sessionId',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.d1.proofEnvelope.sessionId = 'kfc:another-session';
      },
    },
    {
      label: 'durable transcript turns',
      missing: 'd1.proofEnvelope.turns',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        input.d1.proofEnvelope.turns = [];
      },
    },
    {
      label: 'pack state envelope',
      missing: 'd1.proofEnvelope.packState',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete input.d1.proofEnvelope.packState;
      },
    },
    {
      label: 'tool-call trace',
      missing: 'd1.proofEnvelope.packState.state.toolTrace',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const packState = input.d1.proofEnvelope
          .packState as Record<string, unknown>;
        const state = packState.state as Record<string, unknown>;
        delete state.toolTrace;
      },
    },
    {
      label: 'malformed tool-call trace',
      missing: 'd1.proofEnvelope.packState.state.toolTrace',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const packState = input.d1.proofEnvelope
          .packState as Record<string, unknown>;
        const state = packState.state as Record<string, unknown>;
        state.toolTrace = [{}];
      },
    },
    {
      label: 'recommendation projection',
      missing: 'd1.proofEnvelope.recommendations',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete input.d1.proofEnvelope.recommendations;
      },
    },
    {
      label: 'bounded no-recommendation evidence',
      missing: 'd1.proofEnvelope.recommendations.noRecommendation',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const recommendations = input.d1.proofEnvelope
          .recommendations as Record<string, unknown>;
        recommendations.events = [{ eventType: 'decision_completed' }];
      },
    },
  ])('reports exactly the missing $label', ({ missing, mutate }) => {
    const input = completeEvidence();
    mutate(input);

    expect(liveScenarioEvidenceMissing(input)).toEqual([missing]);
  });

  it('accepts complete correlated recommendation evidence', () => {
    expect(
      liveScenarioEvidenceMissing(completeRecommendationEvidence()),
    ).toEqual([]);
  });

  it('rejects an active recommendation without recommendation tool-call evidence', () => {
    const input = completeRecommendationEvidence();
    const packState = input.d1.proofEnvelope.packState as Record<
      string,
      unknown
    >;
    const state = packState.state as Record<string, unknown>;
    state.toolTrace = [];

    expect(
      liveScenarioEvidenceMissing(input),
    ).toContain('d1.proofEnvelope.packState.state.toolTrace');
  });

  it.each([
    {
      label: 'recommendation decision projection',
      missing: 'd1.proofEnvelope.recommendations',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const recommendations = input.d1.proofEnvelope
          .recommendations as Record<string, unknown>;
        recommendations.latestDecision = {};
      },
    },
    {
      label: 'recommendation correlations',
      missing: 'd1.proofEnvelope.recommendations.correlations',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const recommendations = input.d1.proofEnvelope
          .recommendations as Record<string, unknown>;
        const correlations = recommendations.correlations as Record<
          string,
          unknown
        >;
        delete correlations.traceRef;
        const inspection = input.d1
          .recommendationInspection as Record<string, unknown>;
        delete (
          inspection.correlations as Record<string, unknown>
        ).traceRef;
        const orderFlow = input.d1.orderFlowState as Record<string, unknown>;
        delete (
          orderFlow.correlations as Record<string, unknown>
        ).traceRef;
      },
    },
    {
      label: 'recommendation events',
      missing: 'd1.proofEnvelope.recommendations.events',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const recommendations = input.d1.proofEnvelope
          .recommendations as Record<string, unknown>;
        recommendations.events = [];
      },
    },
    {
      label: 'recommendation inspection',
      missing: 'd1.recommendationInspection',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete input.d1.recommendationInspection;
      },
    },
    {
      label: 'recommendation inspection payload',
      missing: 'd1.recommendationInspection',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const inspection = input.d1
          .recommendationInspection as Record<string, unknown>;
        inspection.recommendation = {};
      },
    },
    {
      label: 'recommendation inspection events',
      missing: 'd1.recommendationInspection.events',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const inspection = input.d1
          .recommendationInspection as Record<string, unknown>;
        inspection.events = [];
      },
    },
    {
      label: 'shadow/model inspection binding',
      missing: 'd1.recommendationInspection.technical.shadowComparison',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const inspection = input.d1
          .recommendationInspection as Record<string, unknown>;
        const technical = inspection.technical as Record<string, unknown>;
        delete technical.shadowComparison;
      },
    },
    {
      label: 'recommendation inspection correlations',
      missing: 'd1.recommendationInspection.correlations',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const inspection = input.d1
          .recommendationInspection as Record<string, unknown>;
        const correlations = inspection.correlations as Record<
          string,
          unknown
        >;
        correlations.recommendationId = 'another-recommendation';
      },
    },
    {
      label: 'final order-flow state',
      missing: 'd1.orderFlowState',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        delete input.d1.orderFlowState;
      },
    },
    {
      label: 'malformed final order-flow state',
      missing: 'd1.orderFlowState',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const orderFlow = input.d1.orderFlowState as Record<string, unknown>;
        orderFlow.state = {};
      },
    },
    {
      label: 'order-flow correlations',
      missing: 'd1.orderFlowState.correlations',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const orderFlow = input.d1.orderFlowState as Record<string, unknown>;
        const correlations = orderFlow.correlations as Record<string, unknown>;
        correlations.orderFlowId = 'another-order-flow';
      },
    },
    {
      label: 'order-flow events',
      missing: 'd1.orderFlowState.events',
      mutate(input: LiveScenarioEvidenceCompletenessInput) {
        const orderFlow = input.d1.orderFlowState as Record<string, unknown>;
        orderFlow.events = [];
      },
    },
  ])('reports exactly the missing $label', ({ missing, mutate }) => {
    const input = completeRecommendationEvidence();
    mutate(input);

    expect(liveScenarioEvidenceMissing(input)).toEqual([missing]);
  });
});
