import { DashboardEventBus } from '../dashboard/eventBus.js';
import { dashboardSessionTarget } from '../dashboard/sessionVisibility.js';
import type {
  Channel,
  ConversationTurnMetadata,
  MonitorSessionIntelligence,
} from '../domain/types.js';
import {
  agentTraceProbeRunId,
  type AgentTraceContext,
} from '../agent/agentTraceContext.js';
import type { AgentState } from '../agent/agentState.js';
import { stateRevision } from '../agent/turnSupport.js';
import { buildVerifiedStateSnapshot } from '../agent/verifiedState.js';
import {
  calculateMonitorSessionIntelligence,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
} from '../monitor/sessionIntelligence.js';
import type {
  ConversationStore,
  IrreversibleOperationInput,
  SessionControl,
} from '../persistence/memoryStore.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import type { RouteOptions } from './routeHandlerContracts.js';
import { dashboardEventId } from './routeHandlerSupport.js';

interface MonitorAgentTurnOutput {
  state: AgentState;
  assistantTurnId?: string | null;
}

type MonitorRuntimeOptions = Pick<
  RouteOptions,
  'agentTracer' | 'defer' | 'monitorJudge'
>;

interface DurableMonitorEvidence {
  revision: string;
  customerTurnCount: number;
  latestTurnId: string | null;
  control: SessionControl;
}

interface DurableMonitorRefinementLease {
  operation: IrreversibleOperationInput;
  owner: {
    attempt: number;
    leaseToken: string;
    sessionAuthorityGeneration: number;
  };
}

const monitorRefinementDeadlineMs = 25_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function privacySafeMonitorTraceInputs(input: {
  state: AgentState;
  dashboardEvents: ReturnType<DashboardEventBus['getEvents']>;
  customerTurnCount: number;
}): Promise<Record<string, unknown>> {
  const verifiedState = buildVerifiedStateSnapshot(input.state);
  return {
    customerTurnCount: input.customerTurnCount,
    verifiedStateDigest: await stateRevision(verifiedState),
    state: {
      cartItemCount: verifiedState.cart?.items.length ?? 0,
      cartQuantityTotal:
        verifiedState.cart?.items.reduce(
          (total, item) => total + item.quantity,
          0,
        ) ?? 0,
      addressPresent: verifiedState.address !== undefined,
      addressDraftPresent: verifiedState.addressDraft !== undefined,
      fulfillmentPresent: verifiedState.fulfillment !== undefined,
      orderPreviewPresent: verifiedState.orderPreview !== undefined,
      orderPresent: verifiedState.order !== undefined,
      paymentAttemptPresent: verifiedState.paymentAttempt !== undefined,
      handoffPresent: verifiedState.handoff !== undefined,
      pendingSavedAddressRefPresent:
        verifiedState.pendingSavedAddressRef !== undefined,
      escalationReasonCount: input.state.escalationReasons.length,
      toolNames: verifiedState.toolTrace?.map((entry) => entry.toolName) ?? [],
    },
    dashboardEvents: input.dashboardEvents.map((event) => ({
      type: event.type,
      createdAt: event.createdAt,
    })),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createRouteMonitorRuntime(input: {
  options: MonitorRuntimeOptions;
  store: ConversationStore;
  dashboard: DashboardEventBus;
}) {
  const { options, store, dashboard } = input;
  const pendingMonitorRefinements = new Map<string, string>();

  function monitorProfileIdentity(): Record<string, string> {
    const identity = options.monitorJudge?.identity;
    return identity
      ? {
          provider: identity.provider,
          model: identity.model,
          profile: identity.profile,
        }
      : {
          provider: 'custom',
          model: 'custom',
          profile: 'custom-monitor-judge',
        };
  }

  async function reserveDurableMonitorRefinement(input: {
    sessionId: string;
    evidenceRevision: string;
    state: AgentState;
    dashboardEvents: ReturnType<DashboardEventBus['getEvents']>;
    customerTurnCount: number;
    humanJoined?: boolean;
    aiResumed?: boolean;
  }): Promise<DurableMonitorRefinementLease | null> {
    if (
      !store.reserveIrreversibleOperation ||
      !store.completeIrreversibleOperation ||
      !store.failIrreversibleOperation
    ) {
      throw new Error('monitor_durable_operation_lease_unavailable');
    }
    // These legacy-named methods implement the repository's generic durable,
    // exact-owner operation lease. The monitor uses that established atomic
    // boundary for cross-isolate cost coalescing; it is not a commerce side
    // effect.
    const evidenceDigest = await sha256Hex(
      JSON.stringify({
        evidenceRevision: input.evidenceRevision,
        state: input.state,
        dashboardEvents: input.dashboardEvents.map((event) => ({
          id: event.id,
          type: event.type,
          createdAt: event.createdAt,
        })),
        customerTurnCount: input.customerTurnCount,
        humanJoined: input.humanJoined ?? false,
        aiResumed: input.aiResumed ?? false,
      }),
    );
    const bindingFingerprint = await sha256Hex(
      JSON.stringify({
        schemaVersion: 1,
        evidenceRevision: input.evidenceRevision,
        evidenceDigest,
        monitorProfile: monitorProfileIdentity(),
      }),
    );
    const requestDigest = await sha256Hex(
      JSON.stringify({
        sessionId: input.sessionId,
        bindingFingerprint,
      }),
    );
    const operation: IrreversibleOperationInput = {
      requestId: `monitor_refinement:${requestDigest}`,
      sessionId: input.sessionId,
      operation: 'monitor_refinement',
      bindingFingerprint,
    };
    const reservation = await store.reserveIrreversibleOperation(operation);
    return reservation.status === 'reserved'
      ? {
          operation,
          owner: {
            attempt: reservation.attempt,
            leaseToken: reservation.leaseToken,
            sessionAuthorityGeneration: reservation.sessionAuthorityGeneration,
          },
        }
      : null;
  }

  async function resolveMonitorWithinDeadline(
    input: Parameters<typeof resolveMonitorSessionIntelligence>[0],
  ): Promise<MonitorSessionIntelligence> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        resolveMonitorSessionIntelligence(input),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Monitor refinement exceeded ${monitorRefinementDeadlineMs}ms`,
                ),
              ),
            monitorRefinementDeadlineMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function completeDurableMonitorRefinement(
    lease: DurableMonitorRefinementLease,
    outcome: 'ready' | 'discarded_stale',
  ): Promise<boolean> {
    const completionMarker = crypto.randomUUID();
    const completion = await store.completeIrreversibleOperation!(
      lease.operation,
      lease.owner,
      {
        outcome,
        attempt: lease.owner.attempt,
        completionMarker,
      },
    );
    return (
      completion.status === 'completed' &&
      completion.result.attempt === lease.owner.attempt &&
      completion.result.completionMarker === completionMarker
    );
  }

  async function failDurableMonitorRefinement(
    lease: DurableMonitorRefinementLease,
    error: unknown,
  ): Promise<void> {
    await store.failIrreversibleOperation!(
      lease.operation,
      lease.owner,
      error instanceof Error ? error.message : String(error),
    );
  }

  async function captureDurableMonitorEvidence(
    sessionId: string,
  ): Promise<DurableMonitorEvidence> {
    const [turns, events, control] = await Promise.all([
      store.listTurns(sessionId),
      store.listEvents(sessionId),
      store.getSessionControl(sessionId),
    ]);
    const latestTurn = turns.at(-1);
    const authoritativeEvents = events.filter(
      (event) => event.sourceType !== 'llm:monitor_judge_failed',
    );
    const latestEvent = authoritativeEvents.at(-1);
    const customerTurnCount = countCustomerTurns(turns);
    return {
      customerTurnCount,
      latestTurnId: latestTurn?.id ?? null,
      control,
      revision: JSON.stringify({
        customerTurnCount,
        turnCount: turns.length,
        latestTurnId: latestTurn?.id ?? null,
        latestTurnCreatedAt: latestTurn?.createdAt ?? null,
        eventCount: authoritativeEvents.length,
        latestEventId: latestEvent?.id ?? null,
        agentMode: control.agentMode,
        assignedAgentId: control.assignedAgentId,
        sessionAuthorityGeneration: control.sessionAuthorityGeneration,
      }),
    };
  }

  function beginMonitorRefinement(
    sessionId: string,
    revision: string,
  ): boolean {
    if (pendingMonitorRefinements.get(sessionId) === revision) return false;
    pendingMonitorRefinements.set(sessionId, revision);
    return true;
  }

  function finishMonitorRefinement(sessionId: string, revision: string): void {
    if (pendingMonitorRefinements.get(sessionId) === revision) {
      pendingMonitorRefinements.delete(sessionId);
    }
  }

  async function monitorRefinementIsCurrent(
    sessionId: string,
    revision: string,
  ): Promise<boolean> {
    return (
      revision === (await captureDurableMonitorEvidence(sessionId)).revision
    );
  }

  async function recordMonitorFailure(
    sessionId: string,
    error: unknown,
    fallbackMessage: string,
  ): Promise<void> {
    await store.appendEvent(sessionId, 'llm:monitor_judge_failed', {
      message: error instanceof Error ? error.message : fallbackMessage,
    });
  }

  function scheduleMonitorRefinement(
    sessionId: string,
    task: () => Promise<void>,
    onScheduleFailure?: () => void,
  ): void {
    try {
      if (options.defer) options.defer(task);
      else void task();
    } catch (error) {
      onScheduleFailure?.();
      void recordMonitorFailure(
        sessionId,
        error,
        'Monitor judge scheduling failed',
      ).catch(() => undefined);
    }
  }

  function deferAiMonitorRefinement(input: {
    sessionId: string;
    clientMessageId?: string | null;
    output: MonitorAgentTurnOutput;
    /** Server-issued trace authority. Public metadata is deliberately ignored. */
    traceContext?: AgentTraceContext;
    metadata?: ConversationTurnMetadata;
  }): void {
    if (!options.monitorJudge) return;
    // Start the durable reads before handing the task to waitUntil/defer so the
    // revision represents the request that scheduled this refinement, not a
    // later request handled by another Worker isolate.
    const durableEvidencePromise = captureDurableMonitorEvidence(
      input.sessionId,
    );
    const refineMonitor = async () => {
      let monitorTrace;
      let evidenceRevision: string | undefined;
      let durableLease: DurableMonitorRefinementLease | undefined;
      try {
        const durableEvidence = await durableEvidencePromise;
        if (
          durableEvidence.control.agentMode !== 'ai_active' ||
          (input.output.assistantTurnId &&
            durableEvidence.latestTurnId !== input.output.assistantTurnId)
        ) {
          return;
        }
        const monitorStateInput = {
          state: input.output.state,
          dashboardEvents: dashboard.getEvents(input.sessionId),
          customerTurnCount: durableEvidence.customerTurnCount,
        };
        evidenceRevision = durableEvidence.revision;
        if (!beginMonitorRefinement(input.sessionId, evidenceRevision)) {
          evidenceRevision = undefined;
          return;
        }
        const probeRunId = agentTraceProbeRunId(input.traceContext);
        monitorTrace = await options.agentTracer?.startTurn({
          name: 'post_turn_monitor',
          inputs: await privacySafeMonitorTraceInputs(monitorStateInput),
          metadata: {
            sessionId: input.sessionId,
            clientMessageId: input.clientMessageId ?? null,
            assistantTurnId: input.output.assistantTurnId ?? null,
            ...(probeRunId ? { probeRunId } : {}),
          },
          tags: ['kfc-post-turn-monitor'],
        });
        durableLease =
          (await reserveDurableMonitorRefinement({
            sessionId: input.sessionId,
            evidenceRevision,
            ...monitorStateInput,
          })) ?? undefined;
        if (!durableLease) {
          await monitorTrace?.end({ coalesced: true });
          return;
        }
        const sessionIntelligence = await resolveMonitorWithinDeadline({
          ...monitorStateInput,
          judge: options.monitorJudge,
        });
        if (sessionIntelligence.source !== 'ai_monitor_judge') {
          const fallbackError = new Error(
            sessionIntelligence.fallbackReason ??
              'Monitor judge returned runtime fallback',
          );
          await failDurableMonitorRefinement(durableLease, fallbackError);
          durableLease = undefined;
          if (
            await monitorRefinementIsCurrent(input.sessionId, evidenceRevision)
          ) {
            dashboard.emitEvent({
              id: dashboardEventId(
                input.sessionId,
                'session_intelligence_updated',
              ),
              sessionId: input.sessionId,
              type: 'session_intelligence_updated',
              payload: { sessionIntelligence },
              createdAt: new Date().toISOString(),
            });
          }
          await recordMonitorFailure(
            input.sessionId,
            fallbackError,
            'Monitor judge returned runtime fallback',
          );
          await monitorTrace?.end({ sessionIntelligence });
          return;
        }
        if (
          !(await monitorRefinementIsCurrent(input.sessionId, evidenceRevision))
        ) {
          await completeDurableMonitorRefinement(
            durableLease,
            'discarded_stale',
          );
          durableLease = undefined;
          await monitorTrace?.end({ discardedAsStale: true });
          return;
        }
        const ownsCompletion = await completeDurableMonitorRefinement(
          durableLease,
          'ready',
        );
        durableLease = undefined;
        if (
          !ownsCompletion ||
          !(await monitorRefinementIsCurrent(input.sessionId, evidenceRevision))
        ) {
          await monitorTrace?.end({
            discardedAsStale: true,
            lostLease: !ownsCompletion,
          });
          return;
        }
        dashboard.emitEvent({
          id: dashboardEventId(input.sessionId, 'session_intelligence_updated'),
          sessionId: input.sessionId,
          type: 'session_intelligence_updated',
          payload: { sessionIntelligence },
          createdAt: new Date().toISOString(),
        });
        await monitorTrace?.end({ sessionIntelligence });
      } catch (error) {
        if (durableLease) {
          await failDurableMonitorRefinement(durableLease, error).catch(
            () => undefined,
          );
        }
        await monitorTrace?.fail(error);
        await recordMonitorFailure(
          input.sessionId,
          error,
          'Unknown monitor judge failure',
        );
      } finally {
        if (evidenceRevision) {
          finishMonitorRefinement(input.sessionId, evidenceRevision);
        }
      }
    };
    scheduleMonitorRefinement(input.sessionId, refineMonitor);
  }

  async function emitSessionControlIntelligence(input: {
    sessionId: string;
    humanJoined?: boolean;
    aiResumed?: boolean;
  }): Promise<void> {
    const target = dashboardSessionTarget(input.sessionId);
    if (!target) {
      throw new Error(`Unsupported conversation source: ${input.sessionId}`);
    }
    const turns = await store.listTurns(input.sessionId);
    const latestUserTurn = [...turns]
      .reverse()
      .find((turn) => turn.role === 'user');
    const state: AgentState = {
      sessionId: input.sessionId,
      customerId: target.externalUserId,
      channel: target.channel as Channel,
      latestUserMessage: latestUserTurn?.text ?? '',
      recentTurns: buildBoundedRecentTurns(turns),
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [],
    };
    const existing =
      dashboard
        .listSessionSummaries()
        .find((summary) => summary.sessionId === input.sessionId)
        ?.sessionIntelligence ?? null;
    const dashboardEvents = dashboard.getEvents(input.sessionId);
    const deterministic = calculateMonitorSessionIntelligence({
      state,
      dashboardEvents,
      customerTurnCount:
        turns.length > 0
          ? countCustomerTurns(turns)
          : existing?.evaluatedCustomerTurnCount,
      humanJoined: input.humanJoined,
      aiResumed: input.aiResumed,
    });
    // A control transition invalidates prior model-authored ownership prose.
    // The immediate card is projected only from current typed control state;
    // the deferred judge may add a fresh conversational summary later.
    const sessionIntelligence = deterministic;
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, 'session_intelligence_updated'),
      sessionId: input.sessionId,
      type: 'session_intelligence_updated',
      payload: { sessionIntelligence },
      createdAt: new Date().toISOString(),
    });
    if (turns.length > 0) {
      let evidenceRevision: string | undefined;
      try {
        // Dashboard buses are isolate-local. This durable audit marker makes a
        // control transition visible to refinements scheduled by other Worker
        // requests, even when the customer turn count did not change.
        await store.appendEvent(
          input.sessionId,
          'monitor:session_control_evidence',
          {
            agentMode: (await store.getSessionControl(input.sessionId))
              .agentMode,
          },
        );
        const durableEvidence = await captureDurableMonitorEvidence(
          input.sessionId,
        );
        if (
          (input.humanJoined &&
            durableEvidence.control.agentMode !== 'human_paused') ||
          (input.aiResumed && durableEvidence.control.agentMode !== 'ai_active')
        ) {
          return;
        }
        evidenceRevision = durableEvidence.revision;
      } catch (error) {
        await recordMonitorFailure(
          input.sessionId,
          error,
          'Monitor control evidence persistence failed',
        ).catch(() => undefined);
        return;
      }
      deferMonitorSessionIntelligenceRefinement({
        sessionId: input.sessionId,
        state,
        dashboardEvents,
        customerTurnCount: deterministic.evaluatedCustomerTurnCount,
        humanJoined: input.humanJoined,
        aiResumed: input.aiResumed,
        evidenceRevision,
      });
    }
  }

  function withStoredMonitorContext(
    current: MonitorSessionIntelligence,
    existing: MonitorSessionIntelligence | null,
  ): MonitorSessionIntelligence {
    if (
      current.contextSummary.trim().length > 0 ||
      !existing?.contextSummary.trim()
    ) {
      return current;
    }
    return {
      ...current,
      contextSummary: existing.contextSummary,
    };
  }

  function deferMonitorSessionIntelligenceRefinement(input: {
    sessionId: string;
    state: AgentState;
    dashboardEvents: ReturnType<DashboardEventBus['getEvents']>;
    customerTurnCount: number;
    humanJoined?: boolean;
    aiResumed?: boolean;
    evidenceRevision: string;
  }): void {
    if (!options.monitorJudge) return;
    const { evidenceRevision } = input;
    if (!beginMonitorRefinement(input.sessionId, evidenceRevision)) return;
    const refine = async () => {
      let durableLease: DurableMonitorRefinementLease | undefined;
      try {
        durableLease =
          (await reserveDurableMonitorRefinement({
            sessionId: input.sessionId,
            evidenceRevision,
            state: input.state,
            dashboardEvents: input.dashboardEvents,
            customerTurnCount: input.customerTurnCount,
            humanJoined: input.humanJoined,
            aiResumed: input.aiResumed,
          })) ?? undefined;
        if (!durableLease) return;
        const sessionIntelligence = await resolveMonitorWithinDeadline({
          state: input.state,
          dashboardEvents: input.dashboardEvents,
          customerTurnCount: input.customerTurnCount,
          humanJoined: input.humanJoined,
          aiResumed: input.aiResumed,
          judge: options.monitorJudge,
        });
        if (sessionIntelligence.source !== 'ai_monitor_judge') {
          const fallbackError = new Error(
            sessionIntelligence.fallbackReason ??
              'Monitor judge returned runtime fallback',
          );
          await failDurableMonitorRefinement(durableLease, fallbackError);
          durableLease = undefined;
          if (
            await monitorRefinementIsCurrent(input.sessionId, evidenceRevision)
          ) {
            dashboard.emitEvent({
              id: dashboardEventId(
                input.sessionId,
                'session_intelligence_updated',
              ),
              sessionId: input.sessionId,
              type: 'session_intelligence_updated',
              payload: { sessionIntelligence },
              createdAt: new Date().toISOString(),
            });
          }
          await recordMonitorFailure(
            input.sessionId,
            fallbackError,
            'Monitor judge returned runtime fallback',
          );
          return;
        }
        if (
          !(await monitorRefinementIsCurrent(input.sessionId, evidenceRevision))
        ) {
          await completeDurableMonitorRefinement(
            durableLease,
            'discarded_stale',
          );
          durableLease = undefined;
          return;
        }
        const ownsCompletion = await completeDurableMonitorRefinement(
          durableLease,
          'ready',
        );
        durableLease = undefined;
        if (
          !ownsCompletion ||
          !(await monitorRefinementIsCurrent(input.sessionId, evidenceRevision))
        ) {
          return;
        }
        dashboard.emitEvent({
          id: dashboardEventId(input.sessionId, 'session_intelligence_updated'),
          sessionId: input.sessionId,
          type: 'session_intelligence_updated',
          payload: { sessionIntelligence },
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        if (durableLease) {
          await failDurableMonitorRefinement(durableLease, error).catch(
            () => undefined,
          );
        }
        await recordMonitorFailure(
          input.sessionId,
          error,
          'Unknown monitor judge failure',
        );
      } finally {
        finishMonitorRefinement(input.sessionId, evidenceRevision);
      }
    };
    scheduleMonitorRefinement(input.sessionId, refine, () =>
      finishMonitorRefinement(input.sessionId, evidenceRevision),
    );
  }

  function resumedOwnershipSummary(summary: string): string {
    // Ownership is projected from typed control state and reasons. Keep model
    // prose intact instead of routing or rewriting it with phrase rules.
    return summary.trim();
  }

  function shouldEvaluateDashboardMonitorContext(input: {
    existing: MonitorSessionIntelligence | null;
    customerTurnCount: number;
  }): boolean {
    if (input.customerTurnCount === 0) return false;
    const evaluatedCustomerTurnCount =
      input.existing?.evaluatedCustomerTurnCount ?? -1;
    const newCustomerTurns =
      input.customerTurnCount - evaluatedCustomerTurnCount;
    const hasAiContext =
      input.existing?.source === 'ai_monitor_judge' &&
      input.existing.contextSummary.trim().length > 0;
    if (
      hasAiContext &&
      newCustomerTurns < monitorContextReevaluationCustomerTurnThreshold
    ) {
      return false;
    }
    if (
      !options.monitorJudge &&
      input.existing &&
      newCustomerTurns < monitorContextReevaluationCustomerTurnThreshold
    ) {
      return false;
    }
    return true;
  }

  async function ensureDashboardMonitorContext(input: {
    sessionId: string;
    existing: MonitorSessionIntelligence | null;
  }): Promise<MonitorSessionIntelligence | null> {
    const target = dashboardSessionTarget(input.sessionId);
    if (target?.channel !== 'messenger') return input.existing;

    const turns = await store.listTurns(input.sessionId);
    const customerTurnCount = countCustomerTurns(turns);
    if (
      !shouldEvaluateDashboardMonitorContext({
        existing: input.existing,
        customerTurnCount,
      })
    ) {
      return input.existing;
    }

    const latestUserTurn = [...turns]
      .reverse()
      .find((turn) => turn.role === 'user');
    const state: AgentState = {
      sessionId: input.sessionId,
      customerId: target.externalUserId,
      channel: 'messenger',
      latestUserMessage: latestUserTurn?.text ?? '',
      recentTurns: buildBoundedRecentTurns(turns),
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [],
    };
    const dashboardEvents = dashboard.getEvents(input.sessionId);
    const deterministic = calculateMonitorSessionIntelligence({
      state,
      dashboardEvents,
      customerTurnCount,
    });
    const sessionIntelligence = withStoredMonitorContext(
      deterministic,
      input.existing,
    );
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, 'session_intelligence_updated'),
      sessionId: input.sessionId,
      type: 'session_intelligence_updated',
      payload: { sessionIntelligence },
      createdAt: new Date().toISOString(),
    });
    const evidenceRevision = (
      await captureDurableMonitorEvidence(input.sessionId)
    ).revision;
    deferMonitorSessionIntelligenceRefinement({
      sessionId: input.sessionId,
      state,
      dashboardEvents,
      customerTurnCount,
      evidenceRevision,
    });
    return sessionIntelligence;
  }

  return {
    deferAiMonitorRefinement,
    emitSessionControlIntelligence,
    ensureDashboardMonitorContext,
    resumedOwnershipSummary,
    shouldEvaluateDashboardMonitorContext,
  };
}

export type RouteMonitorRuntime = ReturnType<typeof createRouteMonitorRuntime>;
