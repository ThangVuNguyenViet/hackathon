const sourceCommitPattern = /^[a-f0-9]{40,64}$/u;

export interface LiveScenarioEvidenceCompletenessInput {
  environment: Record<string, unknown>;
  bridgeSource: { gitSha: string; dirty: boolean };
  scenarioSourceSha256: string;
  correlation: {
    sessionId: string;
    customerId: string;
    scenarioId: string;
    probeRunId: string;
  };
  timeline: Array<Record<string, unknown>>;
  d1: {
    proofEnvelope: Record<string, unknown>;
    recommendationInspection?: Record<string, unknown>;
    orderFlowState?: Record<string, unknown>;
  };
}

export function liveScenarioEvidenceMissing(
  input: LiveScenarioEvidenceCompletenessInput,
): string[] {
  const missing: string[] = [];
  const release = record(input.environment.release);
  if (
    !release ||
    typeof release.gitSha !== 'string' ||
    !sourceCommitPattern.test(release.gitSha)
  ) {
    missing.push('environment.release.gitSha');
  }
  if (!sourceCommitPattern.test(input.bridgeSource.gitSha)) {
    missing.push('source.bridge.gitSha');
  }
  if (!sha256Pattern.test(input.scenarioSourceSha256)) {
    missing.push('scenario.sourceSha256');
  }

  const checks = record(input.environment.checks);
  const observability = record(checks?.observability);
  const langsmith = record(observability?.langsmith);
  if (langsmith?.configured !== true) {
    missing.push('environment.checks.observability.langsmith.configured');
  }
  if (!nonEmptyString(langsmith?.project)) {
    missing.push('environment.checks.observability.langsmith.project');
  }
  if (!httpUrl(langsmith?.endpoint)) {
    missing.push('environment.checks.observability.langsmith.endpoint');
  }
  if (
    typeof langsmith?.samplingRate !== 'number' ||
    !Number.isFinite(langsmith.samplingRate) ||
    langsmith.samplingRate <= 0 ||
    langsmith.samplingRate > 1
  ) {
    missing.push('environment.checks.observability.langsmith.samplingRate');
  }

  const proof = record(input.environment.proof);
  const versions = record(proof?.versions);
  const agent = record(versions?.agent);
  if (
    !nonEmptyString(agent?.candidateId) ||
    !nonEmptyString(agent?.provider) ||
    !nonEmptyString(agent?.model) ||
    !nonEmptyString(agent?.profile) ||
    !nonEmptyString(agent?.transport)
  ) {
    missing.push('environment.proof.versions.agent');
  }
  const shadow = record(versions?.recommendationShadow);
  if (
    shadow?.ok !== true ||
    shadow.required !== false ||
    typeof shadow.configured !== 'boolean' ||
    (shadow.outputMode !== 'baseline' &&
      shadow.outputMode !== 'learned_technical')
  ) {
    missing.push('environment.proof.versions.recommendationShadow');
  }
  const sanity = record(versions?.recommendationSanity);
  if (
    sanity?.authority !== 'sanity' ||
    sanity.configured !== true ||
    sanity.reachable !== true ||
    !sha256Pattern.test(
      typeof sanity.snapshotDigest === 'string' ? sanity.snapshotDigest : '',
    )
  ) {
    missing.push('environment.proof.versions.recommendationSanity');
  }

  if (
    !nonEmptyString(input.correlation.customerId) ||
    input.correlation.sessionId !== `kfc:${input.correlation.customerId}`
  ) {
    missing.push('correlation.sessionId');
  }
  if (!opaqueCorrelationId(input.correlation.scenarioId)) {
    missing.push('correlation.scenarioId');
  }
  if (!opaqueCorrelationId(input.correlation.probeRunId)) {
    missing.push('correlation.probeRunId');
  }

  const userMessages = input.timeline.filter(
    (event) =>
      event.type === 'user_message' &&
      nonEmptyString(event.text) &&
      nonEmptyString(event.clientMessageId),
  );
  if (userMessages.length === 0) {
    missing.push('timeline.user_message');
  }
  const assistantMessages = input.timeline.filter(
    (event) =>
      event.type === 'assistant_message' &&
      typeof event.text === 'string' &&
      nonEmptyString(event.assistantTurnId),
  );
  if (assistantMessages.length === 0) {
    missing.push('timeline.assistant_message');
  } else {
    const renderedReferences = new Set<string>();
    let traceInvalid = false;
    let renderedReferencesInvalid = false;
    for (const event of assistantMessages) {
      const response = record(event.response);
      const trace = record(response?.liveScenarioTrace);
      if (
        trace?.authority !== 'server_issued_agent_trace_context' ||
        trace.scenarioId !== input.correlation.scenarioId ||
        trace.probeRunId !== input.correlation.probeRunId
      ) {
        traceInvalid = true;
      }
      const genUi = record(event.genUi);
      if (!genUi) continue;
      const actions = Array.isArray(genUi.actions) ? genUi.actions : [];
      const references = Array.isArray(event.renderedActionReferences)
        ? event.renderedActionReferences
        : [];
      const expected = actions.flatMap((action) => {
        const value = record(action);
        return nonEmptyString(value?.id) &&
          nonEmptyString(event.assistantTurnId) &&
          nonEmptyString(genUi.id)
          ? [
              actionReferenceKey({
                assistantTurnId: event.assistantTurnId,
                attachmentId: genUi.id,
                actionId: value.id,
              }),
            ]
          : [];
      });
      const actual = references.flatMap((reference) => {
        const value = record(reference);
        return nonEmptyString(value?.assistantTurnId) &&
          nonEmptyString(value.attachmentId) &&
          nonEmptyString(value.actionId)
          ? [
              actionReferenceKey({
                assistantTurnId: value.assistantTurnId,
                attachmentId: value.attachmentId,
                actionId: value.actionId,
              }),
            ]
          : [];
      });
      if (
        expected.length !== actions.length ||
        actual.length !== references.length ||
        expected.length !== actual.length ||
        expected.some((key) => !actual.includes(key))
      ) {
        renderedReferencesInvalid = true;
      }
      for (const key of actual) renderedReferences.add(key);
    }
    if (traceInvalid) {
      missing.push('timeline.assistant_message.liveScenarioTrace');
    }
    if (renderedReferencesInvalid) {
      missing.push('timeline.assistant_message.renderedActionReferences');
    }
    const invalidSubmittedAction = input.timeline.some((event) => {
      if (event.type !== 'action_submitted') return false;
      return (
        !nonEmptyString(event.assistantTurnId) ||
        !nonEmptyString(event.attachmentId) ||
        !nonEmptyString(event.actionId) ||
        !nonEmptyString(event.clientMessageId) ||
        !renderedReferences.has(
          actionReferenceKey({
            assistantTurnId: event.assistantTurnId,
            attachmentId: event.attachmentId,
            actionId: event.actionId,
          }),
        )
      );
    });
    if (invalidSubmittedAction) {
      missing.push('timeline.action_submitted.renderedReference');
    }
  }

  const proofEnvelope = input.d1.proofEnvelope;
  if (
    proofEnvelope.schemaVersion !== 1 ||
    proofEnvelope.artifactKind !== 'kfc-simple-agent-proof' ||
    proofEnvelope.runtime !== 'simple-model-tool-loop'
  ) {
    missing.push('d1.proofEnvelope.schema');
  }
  if (proofEnvelope.complete !== true) {
    missing.push('d1.proofEnvelope.complete');
  }
  if (
    !Array.isArray(proofEnvelope.missing) ||
    proofEnvelope.missing.length > 0
  ) {
    missing.push('d1.proofEnvelope.missing');
  }
  if (proofEnvelope.sessionId !== input.correlation.sessionId) {
    missing.push('d1.proofEnvelope.sessionId');
  }
  const proofTurns = Array.isArray(proofEnvelope.turns)
    ? proofEnvelope.turns
    : [];
  const validProofTurn = (role: 'user' | 'assistant'): boolean =>
    proofTurns.some((turn) => {
      const value = record(turn);
      const content = record(value?.content);
      return (
        value?.role === role &&
        nonEmptyString(value.id) &&
        typeof content?.characterCount === 'number' &&
        content.characterCount >= 0 &&
        sha256Pattern.test(
          typeof content.sha256 === 'string' ? content.sha256 : '',
        )
      );
    });
  if (!validProofTurn('user') || !validProofTurn('assistant')) {
    missing.push('d1.proofEnvelope.turns');
  }

  const packState = record(proofEnvelope.packState);
  const packRef = record(packState?.packRef);
  const packIntegrity = record(packState?.integrity);
  const packData = record(packState?.state);
  const validPackState =
    packState?.envelopeVersion === 1 &&
    nonEmptyString(packRef?.packId) &&
    nonEmptyString(packRef.version) &&
    nonEmptyString(packState.schemaVersion) &&
    packIntegrity?.algorithm === 'sha256' &&
    sha256Pattern.test(
      typeof packIntegrity.digest === 'string' ? packIntegrity.digest : '',
    ) &&
    packData !== undefined;
  if (!validPackState) {
    missing.push('d1.proofEnvelope.packState');
  } else if (
    !Array.isArray(packData.toolTrace) ||
    !packData.toolTrace.every(validToolTraceEntry)
  ) {
    missing.push('d1.proofEnvelope.packState.state.toolTrace');
  }

  const recommendations = record(proofEnvelope.recommendations);
  if (
    !recommendations ||
    recommendations.schemaVersion !==
      'kfc-recommendation-order-flow-inspection-v1'
  ) {
    missing.push('d1.proofEnvelope.recommendations');
  } else if (recommendations.state === null) {
    const correlations = record(recommendations.correlations);
    const eventCounts = record(recommendations.eventCounts);
    const noRecommendation =
      recommendations.latestDecision === null &&
      recommendations.pendingAction === null &&
      correlations?.orderFlowId === null &&
      correlations.recommendationId === null &&
      correlations.requestId === null &&
      correlations.traceRef === null &&
      eventCounts !== undefined &&
      Object.keys(eventCounts).length === 0 &&
      Array.isArray(recommendations.events) &&
      recommendations.events.length === 0 &&
      input.d1.recommendationInspection === undefined &&
      input.d1.orderFlowState === undefined;
    if (!noRecommendation) {
      missing.push('d1.proofEnvelope.recommendations.noRecommendation');
    }
  } else {
    const toolTrace = Array.isArray(packData?.toolTrace)
      ? packData.toolTrace
      : [];
    if (
      !toolTrace.some((entry) => {
        const value = record(entry);
        return (
          value !== undefined &&
          typeof value.toolName === 'string' &&
          recommendationToolNames.has(value.toolName)
        );
      }) &&
      !missing.includes('d1.proofEnvelope.packState.state.toolTrace')
    ) {
      missing.push('d1.proofEnvelope.packState.state.toolTrace');
    }
    const correlations = record(recommendations.correlations);
    const recommendationId = correlations?.recommendationId;
    const orderFlowId = correlations?.orderFlowId;
    const requestId = correlations?.requestId;
    const traceRef = correlations?.traceRef;
    const correlationsInvalid =
      !nonEmptyString(recommendationId) ||
      !nonEmptyString(orderFlowId) ||
      !nonEmptyString(requestId) ||
      !nonEmptyString(traceRef);
    if (correlationsInvalid) {
      missing.push('d1.proofEnvelope.recommendations.correlations');
    } else {
      const recommendationState = record(recommendations.state);
      const latestDecision = record(recommendations.latestDecision);
      if (
        recommendationState?.orderFlowId !== orderFlowId ||
        !nonEmptyString(recommendationState.stage) ||
        latestDecision?.recommendationId !== recommendationId ||
        latestDecision.requestId !== requestId ||
        latestDecision.traceRef !== traceRef
      ) {
        missing.push('d1.proofEnvelope.recommendations');
      }
    }
    const recommendationEvents = Array.isArray(recommendations.events)
      ? recommendations.events
      : [];
    const eventCounts = record(recommendations.eventCounts);
    if (
      !eventCounts ||
      recommendationEvents.length === 0 ||
      !recommendationEvents.some((event) => {
        const value = record(event);
        return (
          value?.eventType === 'decision_completed' &&
          value.recommendationId === recommendationId &&
          value.requestId === requestId
        );
      })
    ) {
      missing.push('d1.proofEnvelope.recommendations.events');
    }

    const inspection = record(input.d1.recommendationInspection);
    const inspectionRecommendation = record(inspection?.recommendation);
    const inspectionResponse = record(inspectionRecommendation?.response);
    const inspectionState = record(inspection?.state);
    if (
      !inspection ||
      inspection.schemaVersion !== 'kfc-recommendation-inspection-v1' ||
      !inspectionRecommendation ||
      !inspectionResponse ||
      !nonEmptyString(inspectionResponse.recommendationId) ||
      !nonEmptyString(inspectionResponse.traceRef) ||
      !sha256Pattern.test(
        typeof inspectionRecommendation.actionDigest === 'string'
          ? inspectionRecommendation.actionDigest
          : '',
      ) ||
      !sha256Pattern.test(
        typeof inspectionRecommendation.requestFingerprint === 'string'
          ? inspectionRecommendation.requestFingerprint
          : '',
      ) ||
      !isoTimestamp(inspectionRecommendation.recordedAt) ||
      !record(inspection.technical) ||
      !inspectionState ||
      !nonEmptyString(inspectionState.orderFlowId) ||
      !nonEmptyString(inspectionState.stage) ||
      !Array.isArray(inspection.events)
    ) {
      missing.push('d1.recommendationInspection');
    } else {
      if (
        !correlationsInvalid &&
        (inspectionResponse.recommendationId !== recommendationId ||
          inspectionResponse.traceRef !== traceRef ||
          inspectionState.orderFlowId !== orderFlowId)
      ) {
        missing.push('d1.recommendationInspection');
      }
      const inspectionTechnical = record(inspection.technical)!;
      const shadowComparison = record(inspectionTechnical.shadowComparison);
      const environmentShadow = record(versions?.recommendationShadow);
      const shadowStatus = shadowComparison?.status;
      const shadowModelRevision = shadowComparison?.modelRevision;
      const shadowBindingValid =
        shadowComparison?.outputMode === environmentShadow?.outputMode &&
        ['not_applicable', 'not_configured', 'failed', 'succeeded'].includes(
          typeof shadowStatus === 'string' ? shadowStatus : '',
        ) &&
        (shadowStatus === 'not_applicable' || shadowStatus === 'not_configured'
          ? shadowModelRevision === null
          : nonEmptyString(shadowModelRevision));
      if (!shadowBindingValid) {
        missing.push('d1.recommendationInspection.technical.shadowComparison');
      }
      if (
        !sameRecommendationCorrelations(record(inspection.correlations), {
          sessionId: input.correlation.sessionId,
          orderFlowId,
          recommendationId,
          requestId,
          traceRef,
        })
      ) {
        missing.push('d1.recommendationInspection.correlations');
      }
      if (
        !correlationsInvalid &&
        !inspection.events.some((event) => {
          const value = record(event);
          return (
            value?.eventType === 'decision_completed' &&
            value.recommendationId === recommendationId &&
            value.requestId === requestId
          );
        })
      ) {
        missing.push('d1.recommendationInspection.events');
      }
    }

    const orderFlowState = record(input.d1.orderFlowState);
    const finalState = record(orderFlowState?.state);
    const finalDecision = record(orderFlowState?.latestDecision);
    if (
      !orderFlowState ||
      orderFlowState.schemaVersion !==
        'kfc-recommendation-order-flow-inspection-v1' ||
      !finalState ||
      !nonEmptyString(finalState.orderFlowId) ||
      !nonEmptyString(finalState.stage) ||
      !finalDecision ||
      !nonEmptyString(finalDecision.recommendationId) ||
      !nonEmptyString(finalDecision.requestId) ||
      !nonEmptyString(finalDecision.traceRef)
    ) {
      missing.push('d1.orderFlowState');
    } else {
      if (
        !correlationsInvalid &&
        (finalState.orderFlowId !== orderFlowId ||
          finalDecision.recommendationId !== recommendationId ||
          finalDecision.requestId !== requestId ||
          finalDecision.traceRef !== traceRef)
      ) {
        missing.push('d1.orderFlowState');
      }
      if (
        !sameRecommendationCorrelations(record(orderFlowState.correlations), {
          sessionId: input.correlation.sessionId,
          orderFlowId,
          recommendationId,
          requestId,
          traceRef,
        })
      ) {
        missing.push('d1.orderFlowState.correlations');
      }
      const orderFlowEvents = Array.isArray(orderFlowState.events)
        ? orderFlowState.events
        : [];
      if (
        !record(orderFlowState.eventCounts) ||
        orderFlowEvents.length === 0 ||
        !orderFlowEvents.some((event) => {
          const value = record(event);
          return (
            value?.eventType === 'decision_completed' &&
            value.recommendationId === recommendationId &&
            value.requestId === requestId
          );
        })
      ) {
        missing.push('d1.orderFlowState.events');
      }
    }
  }
  return missing;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const opaqueCorrelationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const recommendationToolNames = new Set([
  'recommendStarter',
  'recommendModifierUpsell',
  'recommendSmartCrossSell',
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function validToolTraceEntry(value: unknown): boolean {
  const entry = record(value);
  return (
    entry !== undefined &&
    nonEmptyString(entry.toolName) &&
    record(entry.arguments) !== undefined &&
    typeof entry.ok === 'boolean' &&
    typeof entry.resultSummary === 'string' &&
    Array.isArray(entry.provenance)
  );
}

function opaqueCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && opaqueCorrelationIdPattern.test(value);
}

function actionReferenceKey(input: {
  assistantTurnId: string;
  attachmentId: string;
  actionId: string;
}): string {
  return JSON.stringify([
    input.assistantTurnId,
    input.attachmentId,
    input.actionId,
  ]);
}

function sameRecommendationCorrelations(
  actual: Record<string, unknown> | undefined,
  expected: {
    sessionId: string;
    orderFlowId: unknown;
    recommendationId: unknown;
    requestId: unknown;
    traceRef: unknown;
  },
): boolean {
  return (
    actual?.sessionId === expected.sessionId &&
    actual.orderFlowId === expected.orderFlowId &&
    actual.recommendationId === expected.recommendationId &&
    actual.requestId === expected.requestId &&
    actual.traceRef === expected.traceRef
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
