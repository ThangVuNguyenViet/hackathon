import {
  kfcGenUiAttachmentForPersistence,
  type KfcGenUiAttachment,
} from '../genui/kfcGenUi.js';
import type {
  ConfirmationApprovalPausePointer,
} from '../api/confirmationPausePersistence.js';
import type {
  ConversationStore,
  CreateCustomerRunInput,
} from '../persistence/memoryStore.js';
import {
  CUSTOMER_RUN_SCHEMA_VERSION,
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunStartRequestSchema,
  type CustomerRun,
  type CustomerRunEventType,
  type CustomerRunPhase,
  type CustomerRunStartRequest,
} from './contracts.js';
import {
  customerSafeProgressLabels,
  type CustomerSafeProgressFamily,
} from './progressProjection.js';

type ExecutionResult =
  | {
      status?: 'completed';
      responseText: string;
      genUi?: KfcGenUiAttachment;
      assistantTurnId?: string | null;
      approvalPause?: ConfirmationApprovalPausePointer;
    }
  | {
      status: 'superseded';
    };

export type CustomerRunObservation =
  | { kind: 'planning' }
  | {
      kind: 'tool';
      protected: boolean;
      irreversible: boolean;
      progressFamily?: CustomerSafeProgressFamily;
    }
  | { kind: 'verified_state' }
  | { kind: 'response_composition' };

type CoordinatorReply = { status: number; body: Record<string, unknown> };

class CustomerRunSupersededError extends Error {
  constructor() {
    super('customer_run_superseded');
    this.name = 'CustomerRunSupersededError';
  }
}

export interface CustomerRunCoordinatorOptions {
  store: ConversationStore;
  execute: (
    request: CustomerRunStartRequest,
    run: CustomerRun,
    observe: (observation: CustomerRunObservation) => Promise<void>,
    isCurrent: () => Promise<boolean>,
  ) => Promise<ExecutionResult>;
  defer?: (task: () => Promise<void>) => void;
  paceMs?: number;
  maxTextEvents?: number;
  replayRecoveryDelayMs?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'superseded']);
const protectedPhases = new Set<CustomerRunPhase>(['state_change_tool', 'irreversible_tool']);
const maximumAuthorityStartAttempts = 3;

export class CustomerRunCoordinator {
  private readonly latestProgress = new Map<
    string,
    { family: CustomerSafeProgressFamily; cancellable: boolean }
  >();
  private readonly nextSequences = new Map<string, number>();
  private readonly latestPhases = new Map<string, CustomerRunPhase>();

  constructor(private readonly options: CustomerRunCoordinatorOptions) {}

  async start(input: unknown): Promise<CoordinatorReply> {
    const parsed = customerRunStartRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { status: 400, body: { errorCode: 'invalid_customer_run', issues: parsed.error.issues } };
    }
    const request = parsed.data;
    const fingerprint = await fingerprintFor(request);
    const now = this.now();
    const run: CreateCustomerRunInput = {
      id: `customer_run_${crypto.randomUUID()}`,
      schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
      sessionId: request.sessionId,
      customerId: request.customerId,
      clientMessageId: request.clientMessageId,
      requestFingerprint: fingerprint,
      generation: 1,
      status: 'accepted',
      phase: 'queued',
      nextEventSequence: 1,
      clientSchemaVersion: request.schemaVersion,
      acceptedAt: now,
      startedAt: null,
      terminalAt: null,
      updatedAt: now,
    };

    try {
      for (
        let attempt = 0;
        attempt < maximumAuthorityStartAttempts;
        attempt += 1
      ) {
        const existing = await this.options.store.findCustomerRunByRequest(
          request.sessionId,
          request.clientMessageId,
        );
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) {
            throw new CustomerRunIdempotencyConflictError(
              request.sessionId,
              request.clientMessageId,
            );
          }
          if (existing.status === 'accepted' && existing.phase === 'queued') {
            this.defer(() => this.recoverAcceptedRun(request, existing));
          }
          return {
            status: 202,
            body: startBody(existing, true),
          };
        }

        const control = await this.options.store.getSessionControl(
          request.sessionId,
        );
        if (control.agentMode === 'human_paused') {
          if (request.input.kind !== 'text') {
            return {
              status: 409,
              body: {
                errorCode:
                  'trusted_genui_action_requires_ai_active_session',
                sessionId: request.sessionId,
                suppressed: true,
              },
            };
          }
          const pausedAt = this.now();
          const paused = await this.options.store.commitPausedCustomerRunIntake(
            {
              expectedSessionAuthorityGeneration:
                control.sessionAuthorityGeneration,
              run: {
                ...run,
                status: 'superseded',
                phase: 'finalizing',
                terminalAt: pausedAt,
                updatedAt: pausedAt,
              },
              userTurn: {
                sessionId: request.sessionId,
                channel: 'kfc',
                role: 'user',
                text: request.input.text,
                externalMessageId: request.clientMessageId,
                externalUserId: request.customerId,
                deliveryStatus: 'received',
                metadata: {
                  rawEvent: {
                    source: 'kfc_customer_run',
                    intake: 'human_paused',
                  },
                },
                createdAt: pausedAt,
              },
              events: [{
                schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
                eventId: `customer_run_event_${crypto.randomUUID()}`,
                runId: run.id,
                expectedSequence: 1,
                type: 'run_superseded',
                occurredAt: pausedAt,
                payload: {
                  status: 'superseded',
                  suppressed: true,
                  agentMode: 'human_paused',
                },
              }],
            },
          );
          if (paused.status === 'stale') continue;
          return {
            status: 202,
            body: startBody(
              paused.run,
              paused.status === 'replayed',
              'human_paused',
            ),
          };
        }

        try {
          return await this.startActiveRun(request, run, now);
        } catch (error) {
          if (isSessionAuthorityUnavailable(error)) continue;
          throw error;
        }
      }
      return {
        status: 409,
        body: {
          errorCode: 'session_authority_conflict',
          sessionId: request.sessionId,
          suppressed: true,
        },
      };
    } catch (error) {
      if (error instanceof CustomerRunIdempotencyConflictError) {
        return { status: 409, body: { errorCode: 'idempotency_conflict' } };
      }
      throw error;
    }
  }

  private async recoverAcceptedRun(
    request: CustomerRunStartRequest,
    run: CustomerRun,
  ): Promise<void> {
    await this.sleep(this.options.replayRecoveryDelayMs ?? 1_000);
    const current = await this.options.store.getCustomerRun(run.id);
    if (current?.status !== 'accepted' || current.phase !== 'queued') return;
    this.nextSequences.set(current.id, current.nextEventSequence);
    this.latestPhases.set(current.id, 'queued');
    await this.execute(request, current);
  }

  private async startActiveRun(
    request: CustomerRunStartRequest,
    run: CreateCustomerRunInput,
    occurredAt: string,
  ): Promise<CoordinatorReply> {
    if (this.options.store.createCustomerRunWithEvent) {
      const accepted = await this.options.store.createCustomerRunWithEvent(
        run,
        {
          schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
          eventId: `customer_run_event_${crypto.randomUUID()}`,
          runId: run.id,
          expectedSequence: 1,
          type: 'run_accepted',
          occurredAt,
          payload: { status: 'accepted', phase: 'queued' },
        },
      );
      if (!accepted.created) {
        return { status: 202, body: startBody(accepted.run, true) };
      }
      this.nextSequences.set(run.id, accepted.run.nextEventSequence);
      this.latestPhases.set(run.id, 'queued');
      this.defer(() => this.execute(request, accepted.run));
      return {
        status: 202,
        body: startBody(accepted.run, false),
      };
    }
    const stored = await this.options.store.createCustomerRun(run);
    if (stored.id !== run.id) {
      return { status: 202, body: startBody(stored, true) };
    }
    this.nextSequences.set(run.id, stored.nextEventSequence);
    this.latestPhases.set(run.id, 'queued');
    const accepted = await this.emitManyIfCurrent(stored, [{
      type: 'run_accepted',
      payload: { status: 'accepted', phase: 'queued' },
    }]);
    if (!accepted) {
      await this.finishAsSuperseded(run.id);
      const superseded =
        await this.options.store.getCustomerRun(run.id);
      if (!superseded) {
        throw new Error(`Customer run not found: ${run.id}`);
      }
      return { status: 202, body: startBody(superseded, false) };
    }
    this.defer(() => this.execute(request, stored));
    return { status: 202, body: startBody(stored, false) };
  }

  async cancel(runId: string): Promise<CoordinatorReply> {
    const run = await this.options.store.getCustomerRun(runId);
    if (!run) return { status: 404, body: { errorCode: 'run_not_found' } };
    this.nextSequences.set(runId, run.nextEventSequence);
    if (terminalStatuses.has(run.status)) return { status: 200, body: terminalBody(run) };
    if (run.phase && protectedPhases.has(run.phase)) {
      return { status: 409, body: { errorCode: 'cancellation_temporarily_unavailable', runId } };
    }
    if (run.status !== 'cancelling') {
      await this.options.store.updateCustomerRun(runId, { status: 'cancelling' });
      await this.emit(runId, 'cancellation_requested', { status: 'cancelling' });
    }
    return { status: 202, body: { runId, status: 'cancelling' } };
  }

  private async execute(
    request: CustomerRunStartRequest,
    run: CustomerRun,
  ): Promise<void> {
    const runId = run.id;
    try {
      if (await this.finishIfCancelled(runId)) return;
      const startedAt = this.now();
      await this.options.store.updateCustomerRun(runId, {
        status: 'running', phase: 'planning', startedAt,
      });
      this.latestPhases.set(runId, 'planning');
      this.latestProgress.set(runId, {
        family: 'reviewing_request',
        cancellable: true,
      });
      if (!(await this.emitManyIfCurrent(run, [
        {
          type: 'run_started',
          payload: { status: 'running', phase: 'planning' },
        },
        {
          type: 'progress_updated',
          payload: {
            code: 'reviewing_request',
            label: customerSafeProgressLabels.reviewing_request,
            cancellable: true,
          },
        },
      ]))) {
        await this.finishAsSuperseded(runId);
        return;
      }

      if (await this.finishIfCancelled(runId)) return;
      const isCurrent = () => this.isCurrent(run);
      const result = await this.options.execute(
        request,
        run,
        (observation) => this.observe(run, observation),
        isCurrent,
      );
      if (result.status === 'superseded' || !(await isCurrent())) {
        await this.finishAsSuperseded(runId);
        return;
      }
      if (!result || typeof result.responseText !== 'string') throw new Error('Invalid canonical response');
      if (await this.finishIfCancelled(runId)) return;

      const durableGenUi = result.genUi
        ? kfcGenUiAttachmentForPersistence(result.genUi)
        : undefined;
      if (durableGenUi) {
        if (!(await isCurrent())) {
          await this.finishAsSuperseded(runId);
          return;
        }
        const actionless = { ...durableGenUi, actions: [] };
        if (!(await this.emitManyIfCurrent(run, [
          {
            type: 'genui_revision',
            payload: {
              revision: 1,
              snapshot: { ...actionless, data: {} },
            },
          },
          {
            type: 'genui_revision',
            payload: { revision: 2, snapshot: actionless },
          },
        ]))) {
          await this.finishAsSuperseded(runId);
          return;
        }
      }

      if (!(await isCurrent())) {
        await this.finishAsSuperseded(runId);
        return;
      }
      this.latestPhases.set(runId, 'text_delivery');
      const [, textStartedCurrent] = await Promise.all([
        this.options.store.updateCustomerRun(runId, {
          phase: 'text_delivery',
        }),
        this.emitOneIfCurrent(run, 'text_started', { text: '' }),
      ]);
      if (!textStartedCurrent) {
        await this.finishAsSuperseded(runId);
        return;
      }
      for (const delta of splitCustomerText(
        result.responseText,
        this.options.maxTextEvents,
      )) {
        if (await this.finishIfCancelled(runId)) return;
        if (!(await isCurrent())) {
          await this.finishAsSuperseded(runId);
          return;
        }
        if (!(await this.emitOneIfCurrent(
          run,
          'text_delta',
          { delta },
        ))) {
          await this.finishAsSuperseded(runId);
          return;
        }
        if ((this.options.paceMs ?? 25) > 0) await this.sleep(this.options.paceMs ?? 25);
      }
      if (!(await isCurrent())) {
        await this.finishAsSuperseded(runId);
        return;
      }
      const terminalAt = this.now();
      if (!(await this.emitManyIfCurrent(run, [
        ...(durableGenUi
          ? [{
              type: 'genui_snapshot' as const,
              payload: { snapshot: durableGenUi },
            }]
          : []),
        {
          type: 'run_completed',
          payload: {
            status: 'completed',
            responseText: result.responseText,
            assistantTurnId: result.assistantTurnId ?? null,
            ...(result.approvalPause
              ? { approvalPause: result.approvalPause }
              : {}),
          },
        },
      ]))) {
        await this.finishAsSuperseded(runId);
        return;
      }
      await this.options.store.updateCustomerRun(runId, {
        status: 'completed', phase: 'finalizing', terminalAt,
      });
      this.latestPhases.set(runId, 'finalizing');
      this.latestProgress.delete(runId);
      this.nextSequences.delete(runId);
      this.latestPhases.delete(runId);
    } catch (error) {
      if (await this.finishIfCancelled(runId)) return;
      if (
        error instanceof CustomerRunSupersededError ||
        !(await this.isCurrent(run))
      ) {
        await this.finishAsSuperseded(runId);
        return;
      }
      const terminalAt = this.now();
      await this.emit(runId, 'run_failed', { status: 'failed', message: 'Không thể hoàn tất yêu cầu lúc này.' });
      await this.options.store.updateCustomerRun(runId, { status: 'failed', phase: 'finalizing', terminalAt });
      this.latestPhases.set(runId, 'finalizing');
      this.latestProgress.delete(runId);
      this.nextSequences.delete(runId);
      this.latestPhases.delete(runId);
    }
  }

  private async finishAsSuperseded(runId: string): Promise<void> {
    const current = await this.options.store.getCustomerRun(runId);
    if (!current || terminalStatuses.has(current.status)) return;
    const terminalAt = this.now();
    await this.emit(runId, 'run_superseded', {
      status: 'superseded',
    });
    await this.options.store.updateCustomerRun(runId, {
      status: 'superseded',
      phase: 'finalizing',
      terminalAt,
    });
    this.latestPhases.set(runId, 'finalizing');
    this.latestProgress.delete(runId);
    this.nextSequences.delete(runId);
    this.latestPhases.delete(runId);
  }

  private async observe(
    run: CustomerRun,
    observation: CustomerRunObservation,
  ): Promise<void> {
    const runId = run.id;
    if (!(await this.isCurrent(run))) {
      throw new CustomerRunSupersededError();
    }
    if (observation.kind === 'planning') {
      if (this.latestPhases.get(runId) === 'planning') return;
      await this.options.store.updateCustomerRun(runId, { phase: 'planning' });
      this.latestPhases.set(runId, 'planning');
      return;
    }
    if (observation.kind === 'tool') {
      const phase = observation.irreversible
        ? 'irreversible_tool'
        : observation.protected ? 'state_change_tool' : 'read_only_tool';
      this.latestPhases.set(runId, phase);
      const updatePhase = this.options.store.updateCustomerRun(runId, {
        phase,
      });
      const updateProgress = () => this.emitProgress(
          run,
          runId,
          observation.progressFamily ??
            this.latestProgress.get(runId)?.family ??
            'reviewing_request',
          !observation.protected && !observation.irreversible,
        );
      if (observation.protected || observation.irreversible) {
        await updatePhase;
        if (!(await updateProgress())) {
          throw new CustomerRunSupersededError();
        }
      } else {
        const [, progressCurrent] =
          await Promise.all([updatePhase, updateProgress()]);
        if (!progressCurrent) throw new CustomerRunSupersededError();
      }
      return;
    }
    if (observation.kind === 'verified_state') {
      await this.options.store.updateCustomerRun(runId, { phase: 'reconciling' });
      this.latestPhases.set(runId, 'reconciling');
      const current = this.latestProgress.get(runId);
      if (
        current &&
        !(await this.emitProgress(run, runId, current.family, true))
      ) {
        throw new CustomerRunSupersededError();
      }
      return;
    }
    const previousPhase = this.latestPhases.get(runId);
    this.latestPhases.set(runId, 'response_composition');
    const updatePhase = this.options.store.updateCustomerRun(runId, {
      phase: 'response_composition',
    });
    const updateProgress = () =>
      this.emitProgress(run, runId, 'preparing_response', true);
    if (previousPhase && protectedPhases.has(previousPhase)) {
      await updatePhase;
      if (!(await updateProgress())) {
        throw new CustomerRunSupersededError();
      }
    } else {
      const [, progressCurrent] =
        await Promise.all([updatePhase, updateProgress()]);
      if (!progressCurrent) throw new CustomerRunSupersededError();
    }
  }

  private async finishIfCancelled(runId: string): Promise<boolean> {
    const run = await this.options.store.getCustomerRun(runId);
    if (run) this.nextSequences.set(runId, run.nextEventSequence);
    if (run?.status !== 'cancelling') return false;
    const terminalAt = this.now();
    await this.emit(runId, 'run_cancelled', { status: 'cancelled', message: 'Đã dừng theo yêu cầu.' });
    await this.options.store.updateCustomerRun(runId, { status: 'cancelled', phase: 'finalizing', terminalAt });
    this.latestPhases.set(runId, 'finalizing');
    this.latestProgress.delete(runId);
    this.nextSequences.delete(runId);
    this.latestPhases.delete(runId);
    return true;
  }

  private async emitProgress(
    run: CustomerRun,
    runId: string,
    family: CustomerSafeProgressFamily,
    cancellable: boolean,
  ): Promise<boolean> {
    const latest = this.latestProgress.get(runId);
    if (
      latest?.family === family &&
      latest.cancellable === cancellable
    ) {
      return true;
    }
    this.latestProgress.set(runId, { family, cancellable });
    return this.emitOneIfCurrent(run, 'progress_updated', {
      code: family,
      label: customerSafeProgressLabels[family],
      cancellable,
    });
  }

  private async emitOneIfCurrent(
    run: CustomerRun,
    type: CustomerRunEventType,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    return this.emitManyIfCurrent(run, [{ type, payload }]);
  }

  private async emitManyIfCurrent(
    run: CustomerRun,
    events: Array<{
      type: CustomerRunEventType;
      payload: Record<string, unknown>;
    }>,
  ): Promise<boolean> {
    if (events.length === 0) return true;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let expectedSequence = this.nextSequences.get(run.id);
      if (expectedSequence === undefined) {
        const current = await this.options.store.getCustomerRun(run.id);
        if (!current) {
          throw new Error(`Customer run not found: ${run.id}`);
        }
        expectedSequence = current.nextEventSequence;
        this.nextSequences.set(run.id, expectedSequence);
      }
      const result =
        await this.options.store.appendCustomerRunEventsIfRunCurrent({
          sessionId: run.sessionId,
          fence: {
            kind: 'customer_run',
            runId: run.id,
            sessionAuthorityGeneration:
              run.sessionAuthorityGeneration,
          },
          events: events.map((event, index) => ({
            schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
            eventId: `customer_run_event_${crypto.randomUUID()}`,
            runId: run.id,
            expectedSequence: expectedSequence + index,
            type: event.type,
            occurredAt: this.now(),
            payload: event.payload,
          })),
        });
      if (result.status === 'committed') {
        this.nextSequences.set(
          run.id,
          expectedSequence + events.length,
        );
        return true;
      }
      if (!(await this.isCurrent(run))) return false;
      const current = await this.options.store.getCustomerRun(run.id);
      if (!current) return false;
      this.nextSequences.set(run.id, current.nextEventSequence);
    }
    throw new CustomerRunSequenceConflictError(
      run.id,
      this.nextSequences.get(run.id) ?? 1,
      this.nextSequences.get(run.id) ?? 1,
    );
  }

  private isCurrent(run: CustomerRun): Promise<boolean> {
    return this.options.store.isRunCommitFenceCurrent({
      sessionId: run.sessionId,
      fence: {
        kind: 'customer_run',
        runId: run.id,
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration,
      },
    });
  }

  private async emit(runId: string, type: CustomerRunEventType, payload: Record<string, unknown>): Promise<void> {
    await this.emitMany(runId, [{ type, payload }]);
  }

  private async emitMany(
    runId: string,
    events: Array<{
      type: CustomerRunEventType;
      payload: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (events.length === 0) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let expectedSequence = this.nextSequences.get(runId);
      if (expectedSequence === undefined) {
        const run = await this.options.store.getCustomerRun(runId);
        if (!run) throw new Error(`Customer run not found: ${runId}`);
        expectedSequence = run.nextEventSequence;
        this.nextSequences.set(runId, expectedSequence);
      }
      try {
        await this.options.store.appendCustomerRunEvents(
          events.map((event, index) => ({
            schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
            eventId: `customer_run_event_${crypto.randomUUID()}`,
            runId,
            expectedSequence: expectedSequence + index,
            type: event.type,
            occurredAt: this.now(),
            payload: event.payload,
          })),
        );
        this.nextSequences.set(runId, expectedSequence + events.length);
        return;
      } catch (error) {
        if (!(error instanceof CustomerRunSequenceConflictError) || attempt === 4) {
          throw error;
        }
        this.nextSequences.set(runId, error.actualSequence);
      }
    }
  }

  private now(): string { return (this.options.now?.() ?? new Date()).toISOString(); }
  private sleep(milliseconds: number): Promise<void> {
    return this.options.sleep?.(milliseconds) ?? new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  private defer(task: () => Promise<void>): void {
    if (this.options.defer) this.options.defer(task);
    else queueMicrotask(() => void task());
  }
}

export function splitCustomerText(text: string, maxEvents = 24): string[] {
  if (text.length === 0) return [];
  const graphemes = [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(text)]
    .map((part) => part.segment);
  const count = Math.min(Math.max(1, maxEvents), 24, graphemes.length);
  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * graphemes.length) / count);
    const end = Math.floor(((index + 1) * graphemes.length) / count);
    chunks.push(graphemes.slice(start, end).join(''));
  }
  return chunks;
}

async function fingerprintFor(request: CustomerRunStartRequest): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(request));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSessionAuthorityUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'session_ai_authority_unavailable'
  );
}

function startBody(
  run: CustomerRun,
  replayed: boolean,
  agentMode?: 'human_paused',
): Record<string, unknown> {
  return {
    schemaVersion: run.schemaVersion,
    runId: run.id,
    status: run.status,
    nextSequence: 1,
    replayed,
    ...(run.status === 'superseded'
      ? { suppressed: true }
      : {}),
    ...(agentMode ? { agentMode } : {}),
  };
}

function terminalBody(run: CustomerRun): Record<string, unknown> {
  return { runId: run.id, status: run.status, terminalAt: run.terminalAt };
}
