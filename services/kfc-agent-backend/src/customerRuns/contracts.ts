import { z } from 'zod';

export const CUSTOMER_RUN_SCHEMA_VERSION = 1 as const;

const opaqueIdSchema = z.string().trim().min(1).max(200);
const isoTimestampSchema = z.string().datetime({ offset: true });

export const customerRunStatusSchema = z.enum([
  'accepted',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'superseded',
]);

export const customerRunPhaseSchema = z.enum([
  'queued',
  'planning',
  'read_only_tool',
  'state_change_tool',
  'irreversible_tool',
  'reconciling',
  'response_composition',
  'text_delivery',
  'finalizing',
]);

export const customerRunEventTypeSchema = z.enum([
  'run_accepted',
  'run_started',
  'phase_changed',
  'progress_updated',
  'text_started',
  'text_delta',
  'text_checkpoint',
  'text_completed',
  'text_incomplete',
  'genui_revision',
  'genui_cleared',
  'genui_snapshot',
  'cancellation_requested',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'run_superseded',
]);

export const customerRunStartRequestSchema = z
  .object({
    schemaVersion: z.literal(CUSTOMER_RUN_SCHEMA_VERSION),
    sessionId: opaqueIdSchema,
    customerId: opaqueIdSchema,
    clientMessageId: opaqueIdSchema,
    input: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('text'),
          text: z.string().trim().min(1).max(4_000),
        })
        .strict(),
      z
        .object({
          kind: z.literal('genui_action'),
          attachmentId: opaqueIdSchema,
          actionId: opaqueIdSchema,
          value: z.string().max(1_000).optional(),
          payload: z.record(z.unknown()).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const customerRunEventSchema = z
  .object({
    schemaVersion: z.literal(CUSTOMER_RUN_SCHEMA_VERSION),
    eventId: opaqueIdSchema,
    runId: opaqueIdSchema,
    sequence: z.number().int().positive(),
    type: customerRunEventTypeSchema,
    occurredAt: isoTimestampSchema,
    payload: z.record(z.unknown()),
  })
  .strict();

export type CustomerRunStatus = z.infer<typeof customerRunStatusSchema>;
export type CustomerRunPhase = z.infer<typeof customerRunPhaseSchema>;
export type CustomerRunEventType = z.infer<typeof customerRunEventTypeSchema>;
export type CustomerRunStartRequest = z.infer<typeof customerRunStartRequestSchema>;
export type CustomerRunEvent = z.infer<typeof customerRunEventSchema>;

export interface CustomerRun {
  id: string;
  schemaVersion: typeof CUSTOMER_RUN_SCHEMA_VERSION;
  sessionId: string;
  customerId: string;
  clientMessageId: string;
  requestFingerprint: string;
  generation: number;
  status: CustomerRunStatus;
  phase: CustomerRunPhase | null;
  nextEventSequence: number;
  clientSchemaVersion: number;
  acceptedAt: string;
  startedAt: string | null;
  terminalAt: string | null;
  updatedAt: string;
}

export class CustomerRunIdempotencyConflictError extends Error {
  constructor(sessionId: string, clientMessageId: string) {
    super(`Customer run idempotency conflict: ${sessionId}:${clientMessageId}`);
    this.name = 'CustomerRunIdempotencyConflictError';
  }
}

export class CustomerRunSequenceConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super(
      `Customer run sequence conflict: ${runId} expected ${expectedSequence}, actual ${actualSequence}`,
    );
    this.name = 'CustomerRunSequenceConflictError';
  }
}
