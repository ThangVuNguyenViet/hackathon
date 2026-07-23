import { z } from 'zod';
import {
  commerceApprovalBindingSchema,
  commerceApprovalPrincipalSchema,
  commerceApprovalReceiptSchema,
  digestCommerceAction,
} from '../ordering/approvalReceipt.js';
import {
  commerceApprovalPrincipalsMatch,
  commerceApprovalPrincipalStorageEvidenceRef,
  commerceApprovalPrincipalStorageSubject,
} from '../ordering/commerceApprovalPrincipal.js';
import {
  agentToolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import type {
  CommerceApprovalReceipt,
  CommerceApprovalPrincipal,
  ToolName,
} from '../ordering/types.js';
import type {
  ClaimConfirmationRejectionInput,
  CompleteConfirmationResumeInput,
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  ReserveConfirmationResumeOperationInput,
} from './contracts.js';

export interface ConfirmationPauseStorageRow {
  [key: string]: unknown;
  schema_version: unknown;
  request_id: unknown;
  checkpoint_thread_id: unknown;
  checkpoint_namespace: unknown;
  checkpoint_id: unknown;
  session_id: unknown;
  session_generation: unknown;
  session_authority_generation: unknown;
  pause_identity_digest: unknown;
  customer_id: unknown;
  channel: unknown;
  action_json: unknown;
  action_digest: unknown;
  approval_binding_json: unknown;
  approval_binding_digest: unknown;
  principal_json: unknown;
  authenticated_subject: unknown;
  authentication_evidence_ref: unknown;
  created_at: unknown;
  expires_at: unknown;
  status: unknown;
  rejection_receipt_id: unknown;
  rejection_receipt_json: unknown;
  rejected_at: unknown;
  completion_status: unknown;
  result_json: unknown;
  completion_error: unknown;
  completed_at: unknown;
}

export interface ConfirmationPauseStorageSnapshot {
  record: ConfirmationPauseRecord;
  sessionGeneration: number;
  sessionAuthorityGeneration: number;
  identityDigest: string;
}

export function currentConfirmationPauseAuthoritySql(
  pauseAlias = 'pause',
): string {
  return `(
    EXISTS (
      SELECT 1
      FROM session_controls AS control
      WHERE control.session_id = ${pauseAlias}.session_id
        AND control.agent_mode = 'ai_active'
        AND control.session_authority_generation =
          ${pauseAlias}.session_authority_generation
    )
    OR (
      ${pauseAlias}.session_authority_generation = 0
      AND NOT EXISTS (
        SELECT 1
        FROM session_controls AS control
        WHERE control.session_id = ${pauseAlias}.session_id
      )
    )
  )`;
}

export function confirmationPauseSnapshotsMatch(
  left: ConfirmationPauseStorageSnapshot,
  right: ConfirmationPauseStorageSnapshot,
): boolean {
  return (
    left.sessionGeneration === right.sessionGeneration &&
    left.sessionAuthorityGeneration ===
      right.sessionAuthorityGeneration &&
    left.identityDigest === right.identityDigest
  );
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const sessionGenerationSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime().refine(
  (value) => new Date(value).toISOString() === value,
  'Timestamp must use canonical UTC millisecond precision',
);
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);
const jsonObjectSchema = z.record(jsonValueSchema);
const channelSchema = z.enum([
  'messenger',
  'zalo',
  'kfc',
  'messenger_mock',
  'zalo_mock',
]);
const toolNameSchema = z.enum(
  toolNames as unknown as [ToolName, ...ToolName[]],
);
const principalSchema = commerceApprovalPrincipalSchema;
const actionSchema = z.object({
  toolName: toolNameSchema,
  arguments: jsonObjectSchema,
}).strict().superRefine((action, context) => {
  const parsed = agentToolArgumentSchemas[action.toolName].safeParse(
    action.arguments,
  );
  if (!parsed.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['arguments'],
      message: 'Confirmation action arguments are invalid',
    });
  }
});

const confirmationPauseCreateFields = {
  schemaVersion: z.literal('kfc-confirmation-pause-v1'),
  requestId: z.string().uuid(),
  checkpointThreadId: z.string().min(1),
  checkpointNamespace: z.string(),
  checkpointId: z.string().min(1),
  sessionId: z.string().min(1),
  customerId: z.string().min(1),
  channel: channelSchema,
  action: actionSchema,
  actionDigest: digestSchema,
  approvalBinding: commerceApprovalBindingSchema,
  approvalBindingDigest: digestSchema,
  principal: principalSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
} as const;

const createConfirmationPauseInputSchema = z.object(
  confirmationPauseCreateFields,
).strict().superRefine((record, context) => {
  const add = (path: Array<string | number>, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  if (Date.parse(record.createdAt) >= Date.parse(record.expiresAt)) {
    add(['expiresAt'], 'Confirmation pause must expire after it is created');
  }
  if (
    record.principal.sessionId !== record.sessionId ||
    record.principal.customerId !== record.customerId ||
    record.principal.channel !== record.channel
  ) {
    add(['principal'], 'Confirmation principal does not match the pause');
  }
  if (
    !commerceApprovalPrincipalsMatch(
      record.approvalBinding.principal,
      record.principal,
    )
  ) {
    add(
      ['approvalBinding', 'principal'],
      'Approval binding principal does not match the pause',
    );
  }
  if (record.approvalBinding.capability !== record.action.toolName) {
    add(
      ['approvalBinding', 'capability'],
      'Approval capability does not match the exact action',
    );
  }
});

const confirmationPauseRecordSchema = z.object({
  ...confirmationPauseCreateFields,
  status: z.enum(['pending', 'rejected', 'expired']),
  rejectionReceipt: commerceApprovalReceiptSchema.nullable(),
  rejectedAt: timestampSchema.nullable(),
  completionStatus: z.enum(['pending', 'completed', 'failed']),
  result: jsonObjectSchema.nullable(),
  completionError: z.string().min(1).nullable(),
  completedAt: timestampSchema.nullable(),
}).strict().superRefine((record, context) => {
  const add = (path: Array<string | number>, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  if (Date.parse(record.createdAt) >= Date.parse(record.expiresAt)) {
    add(['expiresAt'], 'Confirmation pause must expire after it is created');
  }
  if (
    record.principal.sessionId !== record.sessionId ||
    record.principal.customerId !== record.customerId ||
    record.principal.channel !== record.channel
  ) {
    add(['principal'], 'Confirmation principal does not match the pause');
  }
  if (
    !commerceApprovalPrincipalsMatch(
      record.approvalBinding.principal,
      record.principal,
    )
  ) {
    add(
      ['approvalBinding', 'principal'],
      'Approval binding principal does not match the pause',
    );
  }
  if (record.approvalBinding.capability !== record.action.toolName) {
    add(
      ['approvalBinding', 'capability'],
      'Approval capability does not match the exact action',
    );
  }
  if (record.status === 'pending') {
    if (record.rejectionReceipt || record.rejectedAt) {
      add(['status'], 'Pending confirmation cannot contain a rejection');
    }
  } else if (record.status === 'rejected') {
    if (
      !record.rejectionReceipt ||
      record.rejectionReceipt.decision !== 'reject' ||
      !record.rejectedAt
    ) {
      add(['status'], 'Rejected confirmation requires an exact reject receipt');
    }
    if (
      record.rejectedAt &&
      (
        Date.parse(record.rejectedAt) < Date.parse(record.createdAt) ||
        Date.parse(record.rejectedAt) >= Date.parse(record.expiresAt)
      )
    ) {
      add(
        ['rejectedAt'],
        'Rejection must occur during the confirmation pause lifetime',
      );
    }
  } else if (record.rejectionReceipt || record.rejectedAt) {
    add(['status'], 'Expired confirmation cannot contain a rejection');
  }
  if (record.rejectionReceipt) {
    const receiptPrincipal = record.rejectionReceipt.binding.principal;
    if (
      !commerceApprovalPrincipalsMatch(
        receiptPrincipal,
        record.principal,
      )
    ) {
      add(
        ['rejectionReceipt', 'binding', 'principal'],
        'Rejection receipt principal does not match the pause',
      );
    }
    if (
      canonicalJson(record.rejectionReceipt.binding) !==
      canonicalJson(record.approvalBinding)
    ) {
      add(
        ['rejectionReceipt', 'binding'],
        'Rejection receipt binding does not match the exact pause binding',
      );
    }
    if (
      Date.parse(record.rejectionReceipt.issuedAt) <
        Date.parse(record.createdAt) ||
      Date.parse(record.rejectionReceipt.issuedAt) >
        Date.parse(record.rejectedAt ?? record.rejectionReceipt.issuedAt) ||
      Date.parse(record.rejectionReceipt.expiresAt) <=
        Date.parse(record.rejectedAt ?? record.rejectionReceipt.expiresAt)
    ) {
      add(
        ['rejectionReceipt'],
        'Rejection receipt is not valid at the rejection timestamp',
      );
    }
  }
  if (record.completionStatus !== 'pending' && record.status !== 'rejected') {
    add(
      ['completionStatus'],
      'Only an authenticated rejection can be completed',
    );
  }
  if (
    record.completedAt &&
    record.rejectedAt &&
    Date.parse(record.completedAt) < Date.parse(record.rejectedAt)
  ) {
    add(
      ['completedAt'],
      'Confirmation completion cannot precede its rejection',
    );
  }
  if (record.completionStatus === 'pending') {
    if (record.result || record.completionError || record.completedAt) {
      add(['completionStatus'], 'Pending completion cannot contain an outcome');
    }
  } else if (record.completionStatus === 'completed') {
    if (!record.result || record.completionError || !record.completedAt) {
      add(
        ['completionStatus'],
        'Completed confirmation requires a result and timestamp',
      );
    }
  } else if (
    record.result ||
    !record.completionError ||
    !record.completedAt
  ) {
    add(
      ['completionStatus'],
      'Failed confirmation requires an error and timestamp',
    );
  }
});

const claimConfirmationRejectionInputSchema = z.object({
  requestId: z.string().uuid(),
  actionDigest: digestSchema,
  approvalBindingDigest: digestSchema,
  principal: principalSchema,
  receipt: commerceApprovalReceiptSchema,
  rejectedAt: timestampSchema,
}).strict().superRefine((input, context) => {
  if (input.receipt.decision !== 'reject') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['receipt', 'decision'],
      message: 'Only authenticated rejection can be claimed',
    });
  }
});

const completeConfirmationResumeInputSchema = z.object({
  requestId: z.string().uuid(),
  receiptId: z.string().uuid(),
  completedAt: timestampSchema,
  completion: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('completed'),
      result: jsonObjectSchema,
    }).strict(),
    z.object({
      status: z.literal('failed'),
      error: z.string().min(1),
    }).strict(),
  ]),
}).strict();

const reserveConfirmationResumeOperationInputSchema = z.object({
  requestId: z.string().uuid(),
  sessionId: z.string().min(1),
  operation: z.literal('confirmation_resume'),
  bindingFingerprint: digestSchema,
  expectedPause: createConfirmationPauseInputSchema,
  expectedSessionGeneration: sessionGenerationSchema,
  pauseIdentityDigest: digestSchema,
  decision: z.enum(['approve', 'reject']),
  receipt: commerceApprovalReceiptSchema,
  providerIdempotencyKey: z.string().min(1).max(300),
  claimedAt: timestampSchema,
  leaseTtlMs: z.number().int().min(1).max(15_000),
}).strict().superRefine((input, context) => {
  const add = (path: Array<string | number>, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  if (
    input.requestId !== input.expectedPause.requestId ||
    input.sessionId !== input.expectedPause.sessionId
  ) {
    add(
      ['expectedPause'],
      'Confirmation resume operation does not match the pause identity',
    );
  }
  if (
    input.receipt.receiptId !== input.requestId ||
    input.receipt.decision !== input.decision
  ) {
    add(
      ['receipt'],
      'Confirmation resume receipt does not match the exact decision',
    );
  }
});

function principalsEqual(
  left: CommerceApprovalPrincipal,
  right: CommerceApprovalPrincipal,
): boolean {
  return commerceApprovalPrincipalsMatch(left, right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error('confirmation_pause_value_not_json_serializable');
  }
  return encoded;
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('confirmation_pause_stored_json_malformed');
  }
}

function storedTimestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

export function confirmationPauseStorageValues(
  record: ConfirmationPauseRecord,
  sessionGeneration: number,
  sessionAuthorityGeneration: number,
  identityDigest: string,
): readonly unknown[] {
  return [
    record.schemaVersion,
    record.requestId,
    record.checkpointThreadId,
    record.checkpointNamespace,
    record.checkpointId,
    record.sessionId,
    sessionGeneration,
    sessionAuthorityGeneration,
    identityDigest,
    record.customerId,
    record.channel,
    JSON.stringify(record.action),
    record.actionDigest,
    JSON.stringify(record.approvalBinding),
    record.approvalBindingDigest,
    JSON.stringify(record.principal),
    commerceApprovalPrincipalStorageSubject(record.principal),
    commerceApprovalPrincipalStorageEvidenceRef(record.principal),
    record.createdAt,
    record.expiresAt,
    record.status,
    record.rejectionReceipt?.receiptId ?? null,
    record.rejectionReceipt ? JSON.stringify(record.rejectionReceipt) : null,
    record.rejectedAt,
    record.completionStatus,
    record.result ? JSON.stringify(record.result) : null,
    record.completionError,
    record.completedAt,
  ] as const;
}

export async function confirmationPauseSnapshotFromStorageRow(
  row: ConfirmationPauseStorageRow,
): Promise<ConfirmationPauseStorageSnapshot> {
  const authenticatedSubject = row.authenticated_subject;
  const authenticationEvidenceRef = row.authentication_evidence_ref;
  const rejectionReceiptId = row.rejection_receipt_id;
  const record = await parseConfirmationPauseRecord({
    schemaVersion: row.schema_version,
    requestId: row.request_id,
    checkpointThreadId: row.checkpoint_thread_id,
    checkpointNamespace: row.checkpoint_namespace,
    checkpointId: row.checkpoint_id,
    sessionId: row.session_id,
    customerId: row.customer_id,
    channel: row.channel,
    action: parseStoredJson(row.action_json),
    actionDigest: row.action_digest,
    approvalBinding: parseStoredJson(row.approval_binding_json),
    approvalBindingDigest: row.approval_binding_digest,
    principal: parseStoredJson(row.principal_json),
    createdAt: storedTimestamp(row.created_at),
    expiresAt: storedTimestamp(row.expires_at),
    status: row.status,
    rejectionReceipt:
      row.rejection_receipt_json === null
        ? null
        : parseStoredJson(row.rejection_receipt_json),
    rejectedAt:
      row.rejected_at === null ? null : storedTimestamp(row.rejected_at),
    completionStatus: row.completion_status,
    result:
      row.result_json === null ? null : parseStoredJson(row.result_json),
    completionError: row.completion_error,
    completedAt:
      row.completed_at === null ? null : storedTimestamp(row.completed_at),
  });
  if (
    authenticatedSubject !==
      commerceApprovalPrincipalStorageSubject(record.principal) ||
    authenticationEvidenceRef !==
      commerceApprovalPrincipalStorageEvidenceRef(record.principal) ||
    rejectionReceiptId !==
      (record.rejectionReceipt?.receiptId ?? null)
  ) {
    throw new Error('confirmation_pause_storage_binding_mismatch');
  }
  const sessionGeneration = sessionGenerationSchema.parse(
    row.session_generation,
  );
  const sessionAuthorityGeneration = sessionGenerationSchema.parse(
    row.session_authority_generation,
  );
  const identityDigest = digestSchema.parse(row.pause_identity_digest);
  if (await confirmationPauseIdentityDigest(record) !== identityDigest) {
    throw new Error('confirmation_pause_storage_identity_mismatch');
  }
  return {
    record,
    sessionGeneration,
    sessionAuthorityGeneration,
    identityDigest,
  };
}

export async function confirmationPauseFromStorageRow(
  row: ConfirmationPauseStorageRow,
): Promise<ConfirmationPauseRecord> {
  return (await confirmationPauseSnapshotFromStorageRow(row)).record;
}

export function parseCreateConfirmationPauseShape(
  value: unknown,
): CreateConfirmationPauseInput {
  return createConfirmationPauseInputSchema.parse(value);
}

export async function parseCreateConfirmationPauseInput(
  value: unknown,
): Promise<CreateConfirmationPauseInput> {
  const input = parseCreateConfirmationPauseShape(value);
  if (await digestCommerceAction(input.action) !== input.actionDigest) {
    throw new Error('confirmation_pause_action_digest_mismatch');
  }
  if (
    await digestCommerceAction(input.approvalBinding) !==
      input.approvalBindingDigest
  ) {
    throw new Error('confirmation_pause_binding_digest_mismatch');
  }
  return input;
}

export function confirmationPauseCreateInput(
  record: ConfirmationPauseRecord,
): CreateConfirmationPauseInput {
  return {
    schemaVersion: record.schemaVersion,
    requestId: record.requestId,
    checkpointThreadId: record.checkpointThreadId,
    checkpointNamespace: record.checkpointNamespace,
    checkpointId: record.checkpointId,
    sessionId: record.sessionId,
    customerId: record.customerId,
    channel: record.channel,
    action: record.action,
    actionDigest: record.actionDigest,
    approvalBinding: record.approvalBinding,
    approvalBindingDigest: record.approvalBindingDigest,
    principal: record.principal,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export async function confirmationPauseIdentityDigest(
  value: CreateConfirmationPauseInput | ConfirmationPauseRecord,
): Promise<string> {
  const input = 'status' in value
    ? confirmationPauseCreateInput(value)
    : value;
  return digestCommerceAction(input);
}

export function confirmationResumeProviderIdempotencyKey(
  pause: CreateConfirmationPauseInput,
): string {
  return [
    'confirmation',
    pause.requestId,
    pause.action.toolName,
    pause.actionDigest,
  ].join(':');
}

export async function confirmationResumeOperationBindingFingerprint(input: {
  pause: CreateConfirmationPauseInput;
  expectedSessionGeneration: number;
  pauseIdentityDigest: string;
  decision: CommerceApprovalReceipt['decision'];
  receipt: CommerceApprovalReceipt;
  providerIdempotencyKey: string;
}): Promise<string> {
  return digestCommerceAction({
    schemaVersion: 'kfc-confirmation-resume-v1',
    pauseIdentityDigest: input.pauseIdentityDigest,
    checkpoint: {
      threadId: input.pause.checkpointThreadId,
      namespace: input.pause.checkpointNamespace,
      id: input.pause.checkpointId,
      sessionGeneration: input.expectedSessionGeneration,
    },
    actionDigest: input.pause.actionDigest,
    approvalBindingDigest: input.pause.approvalBindingDigest,
    decision: input.decision,
    receipt: input.receipt,
    providerIdempotencyKey: input.providerIdempotencyKey,
  });
}

export async function parseConfirmationPauseRecord(
  value: unknown,
): Promise<ConfirmationPauseRecord> {
  const record = confirmationPauseRecordSchema.parse(value);
  await parseCreateConfirmationPauseInput(confirmationPauseCreateInput(record));
  if (record.rejectionReceipt) {
    if (
      await digestCommerceAction(record.rejectionReceipt.binding) !==
        record.approvalBindingDigest
    ) {
      throw new Error('confirmation_pause_receipt_binding_mismatch');
    }
  }
  return record;
}

export async function parseClaimConfirmationRejectionInput(
  value: unknown,
): Promise<ClaimConfirmationRejectionInput> {
  return claimConfirmationRejectionInputSchema.parse(value);
}

export function parseCompleteConfirmationResumeInput(
  value: unknown,
): CompleteConfirmationResumeInput {
  return completeConfirmationResumeInputSchema.parse(value);
}

export async function parseReserveConfirmationResumeOperationInput(
  value: unknown,
): Promise<ReserveConfirmationResumeOperationInput> {
  const input = reserveConfirmationResumeOperationInputSchema.parse(value);
  const expectedPause = await parseCreateConfirmationPauseInput(
    input.expectedPause,
  );
  if (
    await confirmationPauseIdentityDigest(expectedPause) !==
      input.pauseIdentityDigest ||
    confirmationResumeProviderIdempotencyKey(expectedPause) !==
      input.providerIdempotencyKey ||
    await confirmationResumeOperationBindingFingerprint({
      pause: expectedPause,
      expectedSessionGeneration: input.expectedSessionGeneration,
      pauseIdentityDigest: input.pauseIdentityDigest,
      decision: input.decision,
      receipt: input.receipt,
      providerIdempotencyKey: input.providerIdempotencyKey,
    }) !== input.bindingFingerprint
  ) {
    throw new Error('confirmation_resume_operation_identity_mismatch');
  }
  return { ...input, expectedPause };
}

export function pendingConfirmationPause(
  input: CreateConfirmationPauseInput,
): ConfirmationPauseRecord {
  return {
    ...input,
    status: 'pending',
    rejectionReceipt: null,
    rejectedAt: null,
    completionStatus: 'pending',
    result: null,
    completionError: null,
    completedAt: null,
  };
}

export function immutableConfirmationPauseMatches(
  record: ConfirmationPauseRecord,
  input: CreateConfirmationPauseInput,
): boolean {
  return (
    record.schemaVersion === input.schemaVersion &&
    record.requestId === input.requestId &&
    record.checkpointThreadId === input.checkpointThreadId &&
    record.checkpointNamespace === input.checkpointNamespace &&
    record.checkpointId === input.checkpointId &&
    record.sessionId === input.sessionId &&
    record.customerId === input.customerId &&
    record.channel === input.channel &&
    record.actionDigest === input.actionDigest &&
    record.approvalBindingDigest === input.approvalBindingDigest &&
    principalsEqual(record.principal, input.principal) &&
    record.createdAt === input.createdAt &&
    record.expiresAt === input.expiresAt &&
    canonicalJson(record.action) === canonicalJson(input.action) &&
    canonicalJson(record.approvalBinding) ===
      canonicalJson(input.approvalBinding)
  );
}

export async function confirmationRejectionAuthorityMatches(
  record: ConfirmationPauseRecord,
  input: ClaimConfirmationRejectionInput,
): Promise<boolean> {
  return (
    record.actionDigest === input.actionDigest &&
    record.approvalBindingDigest === input.approvalBindingDigest &&
    principalsEqual(record.principal, input.principal) &&
    input.receipt.decision === 'reject' &&
    canonicalJson(input.receipt.binding) ===
      canonicalJson(record.approvalBinding) &&
    Date.parse(input.receipt.issuedAt) >= Date.parse(record.createdAt) &&
    Date.parse(input.receipt.issuedAt) <= Date.parse(input.rejectedAt) &&
    Date.parse(input.receipt.expiresAt) > Date.parse(input.rejectedAt) &&
    await digestCommerceAction(input.receipt.binding) ===
      record.approvalBindingDigest
  );
}

export async function confirmationRejectionMatches(
  record: ConfirmationPauseRecord,
  input: ClaimConfirmationRejectionInput,
): Promise<boolean> {
  return (
    Date.parse(input.rejectedAt) >= Date.parse(record.createdAt) &&
    Date.parse(input.rejectedAt) < Date.parse(record.expiresAt) &&
    await confirmationRejectionAuthorityMatches(record, input)
  );
}

export function rejectionClaimReplays(
  record: ConfirmationPauseRecord,
  input: ClaimConfirmationRejectionInput,
): boolean {
  const receipt = record.rejectionReceipt;
  return Boolean(
    receipt &&
    principalsEqual(record.principal, input.principal) &&
    record.actionDigest === input.actionDigest &&
    record.approvalBindingDigest === input.approvalBindingDigest &&
    canonicalJson(receipt) === canonicalJson(input.receipt),
  );
}

export function completionMatches(
  record: ConfirmationPauseRecord,
  input: CompleteConfirmationResumeInput,
): boolean {
  if (
    record.rejectionReceipt?.receiptId !== input.receiptId
  ) {
    return false;
  }
  return input.completion.status === 'completed'
    ? record.completionStatus === 'completed' &&
        canonicalJson(record.result) === canonicalJson(input.completion.result)
    : record.completionStatus === 'failed' &&
        record.completionError === input.completion.error;
}

export async function confirmationResumeOperationAuthorityMatches(
  record: ConfirmationPauseRecord,
  input: ReserveConfirmationResumeOperationInput,
): Promise<boolean> {
  return (
    record.status === 'pending' &&
    immutableConfirmationPauseMatches(record, input.expectedPause) &&
    await confirmationPauseIdentityDigest(record) ===
      input.pauseIdentityDigest &&
    input.requestId === record.requestId &&
    input.sessionId === record.sessionId &&
    input.receipt.receiptId === record.requestId &&
    input.receipt.decision === input.decision &&
    canonicalJson(input.receipt.binding) ===
      canonicalJson(record.approvalBinding) &&
    input.receipt.issuedAt === record.createdAt &&
    input.receipt.expiresAt === record.expiresAt &&
    Date.parse(input.claimedAt) >= Date.parse(record.createdAt) &&
    Date.parse(input.claimedAt) < Date.parse(record.expiresAt) &&
    confirmationResumeProviderIdempotencyKey(input.expectedPause) ===
      input.providerIdempotencyKey &&
    await confirmationResumeOperationBindingFingerprint({
      pause: input.expectedPause,
      expectedSessionGeneration: input.expectedSessionGeneration,
      pauseIdentityDigest: input.pauseIdentityDigest,
      decision: input.decision,
      receipt: input.receipt,
      providerIdempotencyKey: input.providerIdempotencyKey,
    }) === input.bindingFingerprint
  );
}
