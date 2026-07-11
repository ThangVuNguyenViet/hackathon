import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
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

type ExecutionResult = {
  responseText: string;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string | null;
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

export interface CustomerRunCoordinatorOptions {
  store: ConversationStore;
  execute: (
    request: CustomerRunStartRequest,
    runId: string,
    observe: (observation: CustomerRunObservation) => Promise<void>,
    isCurrent: () => Promise<boolean>,
  ) => Promise<ExecutionResult>;
  defer?: (task: () => Promise<void>) => void;
  paceMs?: number;
  maxTextEvents?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'superseded']);
const protectedPhases = new Set<CustomerRunPhase>(['state_change_tool', 'irreversible_tool']);
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
    const run: CustomerRun = {
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
      if (this.options.store.createCustomerRunWithEvent) {
        const accepted = await this.options.store.createCustomerRunWithEvent(
          run,
          {
            schemaVersion: CUSTOMER_RUN_SCHEMA_VERSION,
            eventId: `customer_run_event_${crypto.randomUUID()}`,
            runId: run.id,
            expectedSequence: 1,
            type: 'run_accepted',
            occurredAt: now,
            payload: { status: 'accepted', phase: 'queued' },
          },
        );
        if (!accepted.created) {
          return { status: 202, body: startBody(accepted.run, true) };
        }
        this.nextSequences.set(run.id, accepted.run.nextEventSequence);
        this.latestPhases.set(run.id, 'queued');
        this.defer(() => this.execute(request, run.id));
        return { status: 202, body: startBody(accepted.run, false) };
      }
      const stored = await this.options.store.createCustomerRun(run);
      if (stored.id !== run.id) return { status: 202, body: startBody(stored, true) };
      this.nextSequences.set(run.id, stored.nextEventSequence);
      this.latestPhases.set(run.id, 'queued');
      await this.emit(run.id, 'run_accepted', { status: 'accepted', phase: 'queued' });
      this.defer(() => this.execute(request, run.id));
      return { status: 202, body: startBody(run, false) };
    } catch (error) {
      if (error instanceof CustomerRunIdempotencyConflictError) {
        return { status: 409, body: { errorCode: 'idempotency_conflict' } };
      }
      throw error;
    }
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

  private async execute(request: CustomerRunStartRequest, runId: string): Promise<void> {
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
      await this.emitMany(runId, [
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
      ]);

      if (await this.finishIfCancelled(runId)) return;
      const result = await this.options.execute(
        request,
        runId,
        (observation) => this.observe(runId, observation),
        async () => {
          const current = await this.options.store.getCustomerRun(runId);
          return current?.status === 'running' || current?.status === 'accepted';
        },
      );
      if (!result || typeof result.responseText !== 'string') throw new Error('Invalid canonical response');
      if (await this.finishIfCancelled(runId)) return;

      if (result.genUi) {
        const actionless = { ...result.genUi, actions: [] };
        await this.emitMany(runId, [
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
        ]);
      }

      this.latestPhases.set(runId, 'text_delivery');
      await Promise.all([
        this.options.store.updateCustomerRun(runId, {
          phase: 'text_delivery',
        }),
        this.emit(runId, 'text_started', { text: '' }),
      ]);
      for (const delta of splitCustomerText(
        result.responseText,
        this.options.maxTextEvents,
      )) {
        if (await this.finishIfCancelled(runId)) return;
        await this.emit(runId, 'text_delta', { delta });
        if ((this.options.paceMs ?? 25) > 0) await this.sleep(this.options.paceMs ?? 25);
      }
      const terminalAt = this.now();
      await this.emitMany(runId, [
        ...(result.genUi
          ? [{
              type: 'genui_snapshot' as const,
              payload: { snapshot: result.genUi },
            }]
          : []),
        {
          type: 'run_completed',
          payload: {
            status: 'completed',
            responseText: result.responseText,
            assistantTurnId: result.assistantTurnId ?? null,
          },
        },
      ]);
      await this.options.store.updateCustomerRun(runId, {
        status: 'completed', phase: 'finalizing', terminalAt,
      });
      this.latestPhases.set(runId, 'finalizing');
      this.latestProgress.delete(runId);
      this.nextSequences.delete(runId);
      this.latestPhases.delete(runId);
    } catch {
      if (await this.finishIfCancelled(runId)) return;
      const terminalAt = this.now();
      await this.emit(runId, 'run_failed', { status: 'failed', message: 'Không thể hoàn tất yêu cầu lúc này.' });
      await this.options.store.updateCustomerRun(runId, { status: 'failed', phase: 'finalizing', terminalAt });
      this.latestPhases.set(runId, 'finalizing');
      this.latestProgress.delete(runId);
      this.nextSequences.delete(runId);
      this.latestPhases.delete(runId);
    }
  }

  private async observe(runId: string, observation: CustomerRunObservation): Promise<void> {
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
          runId,
          observation.progressFamily ??
            this.latestProgress.get(runId)?.family ??
            'reviewing_request',
          !observation.protected && !observation.irreversible,
        );
      if (observation.protected || observation.irreversible) {
        await updatePhase;
        await updateProgress();
      } else {
        await Promise.all([updatePhase, updateProgress()]);
      }
      return;
    }
    if (observation.kind === 'verified_state') {
      await this.options.store.updateCustomerRun(runId, { phase: 'reconciling' });
      this.latestPhases.set(runId, 'reconciling');
      const current = this.latestProgress.get(runId);
      if (current) await this.emitProgress(runId, current.family, true);
      return;
    }
    const previousPhase = this.latestPhases.get(runId);
    this.latestPhases.set(runId, 'response_composition');
    const updatePhase = this.options.store.updateCustomerRun(runId, {
      phase: 'response_composition',
    });
    const updateProgress = () =>
      this.emitProgress(runId, 'preparing_response', true);
    if (previousPhase && protectedPhases.has(previousPhase)) {
      await updatePhase;
      await updateProgress();
    } else {
      await Promise.all([updatePhase, updateProgress()]);
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
    runId: string,
    family: CustomerSafeProgressFamily,
    cancellable: boolean,
  ): Promise<void> {
    const latest = this.latestProgress.get(runId);
    if (latest?.family === family && latest.cancellable === cancellable) return;
    this.latestProgress.set(runId, { family, cancellable });
    await this.emit(runId, 'progress_updated', {
      code: family,
      label: customerSafeProgressLabels[family],
      cancellable,
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

function startBody(run: CustomerRun, replayed: boolean): Record<string, unknown> {
  return { schemaVersion: run.schemaVersion, runId: run.id, status: run.status, nextSequence: 1, replayed };
}

function terminalBody(run: CustomerRun): Record<string, unknown> {
  return { runId: run.id, status: run.status, terminalAt: run.terminalAt };
}
