import { z } from 'zod';
import {
  traceReceiptIsRecoverable,
} from '../agent/agentPublicationRuntime.js';
import {
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
  type CheckpointSafeToolEvidenceReceipt,
} from '../agent/modelPublicationProjection.js';
import {
  officialSourceAuthoritySchema,
} from '../domain/officialSourceAuthority.js';
import { stateRevision } from '../graph/turnSupport.js';
import {
  TOOL_NAMES,
  type FixtureMode,
  type MembershipActionResult,
  type SourceProvenance,
  type ToolName,
  type ToolTraceEntry,
} from '../ordering/types.js';

const digestPattern = /^[0-9a-f]{64}$/u;
const digestSchema = z.string().regex(digestPattern);
const toolNameSchema: z.ZodType<ToolName> = z.enum(TOOL_NAMES);
const fixtureModeSchema: z.ZodType<FixtureMode> = z.enum([
  'public_crawl_seed',
  'authenticated_chrome_seed',
  'mock_external_state',
  'test_only',
  'demo_mock_seed',
  'provider_runtime',
]);
const membershipActionOutcomeSchema: z.ZodType<
  Pick<
    MembershipActionResult,
    | 'actionId'
    | 'status'
    | 'requiresUserConfirmation'
    | 'targetId'
  >
> = z.object({
  actionId: z.string(),
  status: z.enum(['previewed', 'completed']),
  requiresUserConfirmation: z.boolean(),
  targetId: z.string(),
}).strict();
const sourceProvenanceSchema: z.ZodType<SourceProvenance> = z.object({
  fixtureMode: fixtureModeSchema,
  sourceFile: z.string(),
  sourceUrl: z.string().optional(),
  sourceApi: z.string().optional(),
  serverPolicy: z.object({
    policyId: z.string(),
    revision: z.string(),
  }).strict().optional(),
  officialAuthority: officialSourceAuthoritySchema.optional(),
}).strict();
const toolTracePublicationAuditSchema: z.ZodType<
  NonNullable<ToolTraceEntry['publicationEvidenceAudit']>
> = z.object({
  schemaVersion: z.literal('kfc-tool-trace-publication-audit-v1'),
  currentTurnId: z.string(),
  traceIndex: z.number().int().nonnegative(),
  traceDigest: digestSchema,
  argumentsDigest: digestSchema,
  toolCallId: z.string(),
  toolName: toolNameSchema,
  executionOutcome: z.enum(['success', 'error']),
  evidenceId: z.string(),
  evidenceDigest: digestSchema,
  membershipActionOutcome: membershipActionOutcomeSchema.optional(),
}).strict();
const toolTraceEntrySchema: z.ZodType<ToolTraceEntry> = z.object({
  toolName: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  resultSummary: z.string(),
  provenance: z.array(sourceProvenanceSchema).max(64),
  publicationEvidenceAudit:
    toolTracePublicationAuditSchema.optional(),
}).strict();

const toolEvidenceReceiptSchema:
  z.ZodType<CheckpointSafeToolEvidenceReceipt> = z.object({
    schemaVersion: z.literal(
      CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
    ),
    evidenceId: z.string().min(1).max(256),
    evidenceDigest: digestSchema,
    toolCallId: z.string().min(1).max(256),
    toolName: toolNameSchema,
    executionOutcome: z.enum(['success', 'error']),
    result: z.literal(CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT),
  }).strict();

export const toolEvidenceReceiptListSchema =
  z.array(toolEvidenceReceiptSchema).max(128);

export interface KfcProofProvenanceEvidence {
  fixtureMode: FixtureMode;
  sourceDigest: string;
}

export interface KfcProofToolExecutionEvidence {
  receiptSchemaVersion:
    typeof CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION;
  auditSchemaVersion: 'kfc-tool-trace-publication-audit-v1';
  traceIndex: number;
  traceDigest: string;
  argumentsDigest: string;
  toolCallId: string;
  toolName: ToolName;
  executionOutcome: 'success' | 'error';
  evidenceId: string;
  evidenceDigest: string;
  provenanceEvidence: KfcProofProvenanceEvidence[];
  membershipActionOutcome?: {
    status: MembershipActionResult['status'];
    requiresUserConfirmation: boolean;
    actionDigest: string;
  };
}

function toolTraceEntry(value: unknown): ToolTraceEntry | undefined {
  const parsed = toolTraceEntrySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function provenanceEvidence(
  trace: ToolTraceEntry,
): Promise<KfcProofProvenanceEvidence[]> {
  return Promise.all(trace.provenance.map(async (source) => ({
    fixtureMode: source.fixtureMode,
    sourceDigest: await stateRevision(source),
  })));
}

function membershipActionOutcome(
  value: unknown,
): Pick<
  MembershipActionResult,
  'actionId' | 'status' | 'requiresUserConfirmation' | 'targetId'
> | undefined {
  const parsed = membershipActionOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function bindToolExecutionEvidence(input: {
  traceValue: unknown;
  receipt: CheckpointSafeToolEvidenceReceipt;
  currentTurnId: string;
  traceIndex: number;
}): Promise<KfcProofToolExecutionEvidence | undefined> {
  const trace = toolTraceEntry(input.traceValue);
  const audit = trace?.publicationEvidenceAudit;
  const boundedMembershipOutcome = membershipActionOutcome(
    audit?.membershipActionOutcome,
  );
  const isMembershipAction =
    input.receipt.toolName === 'acquireVoucher' ||
    input.receipt.toolName === 'redeemReward';
  const shouldHaveMembershipOutcome =
    input.receipt.executionOutcome === 'success' &&
    isMembershipAction;
  if (
    !trace ||
    !audit ||
    audit.schemaVersion !== 'kfc-tool-trace-publication-audit-v1' ||
    audit.currentTurnId !== input.currentTurnId ||
    audit.traceIndex !== input.traceIndex ||
    audit.toolName !== trace.toolName ||
    audit.executionOutcome !== (trace.ok ? 'success' : 'error') ||
    !audit.toolCallId ||
    !digestPattern.test(audit.traceDigest) ||
    !digestPattern.test(audit.argumentsDigest) ||
    !digestPattern.test(audit.evidenceDigest) ||
    audit.evidenceId !==
      `current:${audit.toolName}:${audit.evidenceDigest}` ||
    input.receipt.evidenceId !== audit.evidenceId ||
    input.receipt.evidenceDigest !== audit.evidenceDigest ||
    input.receipt.toolCallId !== audit.toolCallId ||
    input.receipt.toolName !== audit.toolName ||
    input.receipt.executionOutcome !== audit.executionOutcome ||
    Boolean(boundedMembershipOutcome) !==
      shouldHaveMembershipOutcome
  ) {
    return undefined;
  }
  if (!await traceReceiptIsRecoverable({
    trace,
    receipt: input.receipt,
    currentTurnId: input.currentTurnId,
    traceIndex: input.traceIndex,
  })) {
    return undefined;
  }
  const membershipOutcomeEvidence = boundedMembershipOutcome
    ? {
        status: boundedMembershipOutcome.status,
        requiresUserConfirmation:
          boundedMembershipOutcome.requiresUserConfirmation,
        actionDigest: await stateRevision(boundedMembershipOutcome),
      }
    : undefined;
  return {
    receiptSchemaVersion: input.receipt.schemaVersion,
    auditSchemaVersion: audit.schemaVersion,
    traceIndex: audit.traceIndex,
    traceDigest: audit.traceDigest,
    argumentsDigest: audit.argumentsDigest,
    toolCallId: audit.toolCallId,
    toolName: audit.toolName,
    executionOutcome: audit.executionOutcome,
    evidenceId: audit.evidenceId,
    evidenceDigest: audit.evidenceDigest,
    provenanceEvidence: await provenanceEvidence(trace),
    ...(membershipOutcomeEvidence
      ? { membershipActionOutcome: membershipOutcomeEvidence }
      : {}),
  };
}

export async function toolExecutionEvidenceForTurn(input: {
  traceCandidates: readonly unknown[][];
  traceStartIndex: number;
  tracePrefixDigest: string;
  receipts: readonly CheckpointSafeToolEvidenceReceipt[];
  currentTurnId: string;
}): Promise<KfcProofToolExecutionEvidence[] | undefined> {
  const expectedTraceLength =
    input.traceStartIndex + input.receipts.length;
  let accepted: KfcProofToolExecutionEvidence[] | undefined;
  let acceptedFingerprint: string | undefined;
  for (const candidate of input.traceCandidates) {
    const tracePrefix = candidate.slice(0, input.traceStartIndex);
    if (
      candidate.length !== expectedTraceLength ||
      await stateRevision(tracePrefix) !== input.tracePrefixDigest ||
      tracePrefix.some(
        (value) =>
          toolTraceEntry(value)?.publicationEvidenceAudit
            ?.currentTurnId === input.currentTurnId,
      )
    ) {
      continue;
    }
    const evidence: KfcProofToolExecutionEvidence[] = [];
    let valid = true;
    for (const [offset, receipt] of input.receipts.entries()) {
      const traceIndex = input.traceStartIndex + offset;
      const bound = await bindToolExecutionEvidence({
        traceValue: candidate[traceIndex],
        receipt,
        currentTurnId: input.currentTurnId,
        traceIndex,
      });
      if (!bound) {
        valid = false;
        break;
      }
      evidence.push(bound);
    }
    if (!valid) continue;
    const fingerprint = await stateRevision(evidence);
    if (acceptedFingerprint && acceptedFingerprint !== fingerprint) {
      return undefined;
    }
    accepted = evidence;
    acceptedFingerprint = fingerprint;
  }
  return accepted;
}

export async function completeTraceInventoryIsClaimed(input: {
  traceCandidates: readonly unknown[][];
  claimedTraceIndexes: ReadonlySet<number>;
  claimedTraceAuditKeys: ReadonlySet<string>;
}): Promise<boolean> {
  const maximumTraceLength = Math.max(
    -1,
    ...input.traceCandidates.map((candidate) => candidate.length),
  );
  if (maximumTraceLength < 0) return false;
  const finalCandidates = input.traceCandidates.filter(
    (candidate) => candidate.length === maximumTraceLength,
  );
  const fingerprints = new Set(
    await Promise.all(
      finalCandidates.map((candidate) => stateRevision(candidate)),
    ),
  );
  if (
    fingerprints.size !== 1 ||
    input.claimedTraceIndexes.size !== maximumTraceLength
  ) {
    return false;
  }
  const finalTrace = finalCandidates[0] ?? [];
  return finalTrace.every((value, traceIndex) => {
    const trace = toolTraceEntry(value);
    const audit = trace?.publicationEvidenceAudit;
    if (
      !audit ||
      audit.schemaVersion !== 'kfc-tool-trace-publication-audit-v1' ||
      audit.traceIndex !== traceIndex
    ) {
      return false;
    }
    return (
      input.claimedTraceIndexes.has(traceIndex) &&
      input.claimedTraceAuditKeys.has(
        `${audit.currentTurnId}:${traceIndex}:${audit.traceDigest}`,
      )
    );
  });
}
