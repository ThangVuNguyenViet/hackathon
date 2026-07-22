import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  isPrivateResponseEvidenceTool,
} from '../agent/responseEvidenceContracts.js';
import {
  canonicalJson,
} from '../graph/turnSupport.js';
import {
  TOOL_NAMES,
  type ToolTracePublicationAuditV2,
  type ToolTraceEntry,
} from '../ordering/types.js';

const toolNameSchema = z.enum(TOOL_NAMES);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const fixtureModeSchema = z.enum([
  'public_crawl_seed',
  'authenticated_chrome_seed',
  'mock_external_state',
  'test_only',
  'demo_mock_seed',
  'provider_runtime',
]);
const serverPolicySchema = z.object({
  policyId: z.string().min(1).max(256),
  revision: z.string().min(1).max(256),
}).strict();
const membershipActionOutcomeSchema = z.object({
  actionId: z.string().min(1).max(256),
  status: z.enum(['previewed', 'completed']),
  requiresUserConfirmation: z.boolean(),
  targetId: z.string().min(1).max(256),
}).strict();
const publicationAuditV1Schema = z.object({
  schemaVersion: z.literal(
    'kfc-tool-trace-publication-audit-v1',
  ),
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
const publicationAuditV2Schema = publicationAuditV1Schema
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(
      'kfc-tool-trace-publication-audit-v2',
    ),
    authorityDigest: digestSchema,
    currentTurnRevision: digestSchema,
  })
  .strict();
const publicationAuditSchema = z.discriminatedUnion('schemaVersion', [
  publicationAuditV1Schema,
  publicationAuditV2Schema,
]);
const provenanceSchema = z.object({
  fixtureMode: fixtureModeSchema,
  sourceFile: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceApi: z.string().optional(),
  serverPolicy: serverPolicySchema.optional(),
}).passthrough();
const privateProvenanceSchema = z.object({
  fixtureMode: fixtureModeSchema,
  serverPolicy: serverPolicySchema.optional(),
}).strict();

export const liveQualityToolTraceEntrySchema = z.object({
  toolName: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  resultSummary: z.string(),
  provenance: z.array(provenanceSchema).max(64),
  publicationEvidenceAudit: publicationAuditSchema.optional(),
});

const privateStructuralResultSummarySchema = z.enum([
  'private_tool_observed',
  'private_tool_failed',
  'recent_order_observed',
  'recent_order_lookup_failed',
  'order_status_observed',
  'order_status_lookup_failed',
  'payment_status_observed',
  'payment_status_check_failed',
  'payment_failed',
  'confirmation_required',
  'voucher_acquired',
  'reward_redeemed',
]);

export const liveQualityV3PrivateToolTraceEntrySchema = z.object({
  toolName: toolNameSchema,
  arguments: z.object({
    privateArgumentsDigest: digestSchema,
  }).strict(),
  ok: z.boolean(),
  resultSummary: privateStructuralResultSummarySchema,
  provenance: z.array(privateProvenanceSchema).max(64),
  publicationEvidenceAudit: publicationAuditV2Schema,
}).strict().superRefine((entry, context) => {
  if (!isPrivateResponseEvidenceTool(entry.toolName)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toolName'],
      message: 'tool must use private response evidence',
    });
  }
});

function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value ?? null))
    .digest('hex');
}

function durableTraceDigestInput(entry: ToolTraceEntry) {
  return {
    toolName: entry.toolName,
    arguments: entry.arguments,
    ok: entry.ok,
    resultSummary: entry.resultSummary,
    provenance: entry.provenance,
  };
}

/**
 * Validates only the durable, redacted execution binding. This is deliberately
 * not publication authority: a trace carries its own unhashed audit fields, so
 * it cannot independently authorize private customer-facing evidence.
 */
export function validatedV3PrivateTraceBinding(
  entry: ToolTraceEntry,
): ToolTracePublicationAuditV2 | undefined {
  const parsed = liveQualityV3PrivateToolTraceEntrySchema.safeParse(entry);
  if (!parsed.success) return undefined;
  const audit = parsed.data.publicationEvidenceAudit;
  const shouldHaveMembershipOutcome =
    entry.ok &&
    (
      entry.toolName === 'acquireVoucher' ||
      entry.toolName === 'redeemReward'
    );
  if (
    audit.toolName !== entry.toolName ||
    audit.executionOutcome !== (entry.ok ? 'success' : 'error') ||
    Boolean(audit.membershipActionOutcome) !==
      shouldHaveMembershipOutcome ||
    entry.arguments.privateArgumentsDigest !== audit.argumentsDigest ||
    sha256Canonical(durableTraceDigestInput(entry)) !== audit.traceDigest
  ) {
    return undefined;
  }
  return audit;
}

export const liveQualityV3ToolTraceEntrySchema =
  liveQualityToolTraceEntrySchema.superRefine((entry, context) => {
    if (
      isPrivateResponseEvidenceTool(entry.toolName) &&
      !validatedV3PrivateTraceBinding(entry)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'private V3 tool traces require a canonical redacted trace binding',
      });
    }
  });
