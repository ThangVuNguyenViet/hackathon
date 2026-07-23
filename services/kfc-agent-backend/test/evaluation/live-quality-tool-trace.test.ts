import { describe, expect, it } from 'vitest';
import {
  currentTurnResponseEvidenceDigest,
} from '../../src/agent/modelPublicationProjection.js';
import {
  isPrivateResponseEvidenceTool,
  responseEvidenceContractForTool,
} from '../../src/agent/responseEvidenceContracts.js';
import {
  liveQualityV3ToolTraceEntrySchema,
  validatedV3PrivateTraceBinding,
} from '../../src/evaluation/liveQualityToolTrace.js';
import {
  verifiedSemanticToolOutcomeCode,
} from '../../src/evaluation/semanticResponseJudge.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import type {
  MembershipActionResult,
  ToolName,
  ToolTraceEntry,
  ToolTracePublicationAuditV2,
} from '../../src/ordering/types.js';

const digest = {
  arguments: 'a'.repeat(64),
  authority: 'b'.repeat(64),
  turn: 'c'.repeat(64),
  evidence: 'd'.repeat(64),
} as const;

function structuralSummary(
  toolName: ToolName,
  ok: boolean,
): ToolTraceEntry['resultSummary'] {
  switch (toolName) {
    case 'getRecentOrder':
      return ok
        ? 'recent_order_observed'
        : 'recent_order_lookup_failed';
    case 'getOrderStatus':
      return ok
        ? 'order_status_observed'
        : 'order_status_lookup_failed';
    case 'checkPaymentStatus':
      return ok
        ? 'payment_status_observed'
        : 'payment_status_check_failed';
    default:
      return ok ? 'private_tool_observed' : 'private_tool_failed';
  }
}

function membershipOutcome(
  toolName: ToolName,
  ok: boolean,
): Pick<
  MembershipActionResult,
  'actionId' | 'status' | 'requiresUserConfirmation' | 'targetId'
> | undefined {
  return ok && (
    toolName === 'acquireVoucher' ||
    toolName === 'redeemReward'
  )
    ? {
        actionId: `action-${toolName}`,
        status: 'completed',
        requiresUserConfirmation: false,
        targetId: `target-${toolName}`,
      }
    : undefined;
}

async function auditedPrivateTrace(
  toolName: ToolName,
  ok = true,
): Promise<ToolTraceEntry> {
  const trace: ToolTraceEntry = {
    toolName,
    arguments: {
      privateArgumentsDigest: digest.arguments,
    },
    ok,
    resultSummary: structuralSummary(toolName, ok),
    provenance: [{
      fixtureMode: 'provider_runtime',
      serverPolicy: {
        policyId: 'verified-policy',
        revision: '1',
      },
    }],
  };
  const outcome = membershipOutcome(toolName, ok);
  const contract = responseEvidenceContractForTool(toolName);
  const evidenceDigest = outcome
    ? await currentTurnResponseEvidenceDigest({
        authorityDigest: digest.authority,
        currentTurnRevision: digest.turn,
        toolCallId: `call-${toolName}`,
        toolName,
        claimKinds: contract.claimKinds,
        value: outcome,
        privateData: contract.privateData,
        executionOutcome: ok ? 'success' : 'error',
      })
    : digest.evidence;
  trace.publicationEvidenceAudit = {
    schemaVersion: 'kfc-tool-trace-publication-audit-v2',
    currentTurnId: 'turn-private-trace',
    authorityDigest: digest.authority,
    currentTurnRevision: digest.turn,
    traceIndex: 0,
    traceDigest: await stateRevision({
      toolName: trace.toolName,
      arguments: trace.arguments,
      ok: trace.ok,
      resultSummary: trace.resultSummary,
      provenance: trace.provenance,
    }),
    argumentsDigest: digest.arguments,
    toolCallId: `call-${toolName}`,
    toolName,
    executionOutcome: ok ? 'success' : 'error',
    evidenceId: `current:${toolName}:${evidenceDigest}`,
    evidenceDigest,
    ...(outcome ? { membershipActionOutcome: outcome } : {}),
  };
  return trace;
}

describe('V3 live-quality private tool trace authority', () => {
  it('accepts public traces but cannot parse raw private traces through the base', async () => {
    expect(liveQualityV3ToolTraceEntrySchema.safeParse({
      toolName: 'searchMenu',
      arguments: {
        scope: 'filtered',
        query: 'bucket meal',
      },
      ok: true,
      resultSummary: 'menu_search_results',
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceApi: 'menu-provider',
      }],
    }).success).toBe(true);

    expect(liveQualityV3ToolTraceEntrySchema.safeParse({
      toolName: 'getOrderStatus',
      arguments: { orderId: 'private-order-id' },
      ok: true,
      resultSummary: 'private-provider-result',
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'private-provider-path',
      }],
    }).success).toBe(false);

    expect(liveQualityV3ToolTraceEntrySchema.safeParse(
      await auditedPrivateTrace('getOrderStatus'),
    ).success).toBe(true);
  });

  it('accepts only canonical digest-bound projections for all private tools', async () => {
    const privateTools = toolNames.filter(isPrivateResponseEvidenceTool);
    expect(privateTools).toHaveLength(15);

    for (const toolName of privateTools) {
      for (const ok of [true, false]) {
        const trace = await auditedPrivateTrace(toolName, ok);
        expect(
          validatedV3PrivateTraceBinding(trace),
          `${toolName}:${ok ? 'success' : 'error'}`,
        ).toEqual(trace.publicationEvidenceAudit);
      }
    }
  });

  it('rejects noncanonical traces, raw private fields, and V1 audits', async () => {
    const canonical = await auditedPrivateTrace('getOrderStatus');
    const cases: ToolTraceEntry[] = [];

    const changedSummary = structuredClone(canonical);
    changedSummary.resultSummary = 'private_tool_observed';
    cases.push(changedSummary);

    const rawArguments = structuredClone(canonical);
    rawArguments.arguments = {
      privateArgumentsDigest: digest.arguments,
      orderId: 'private-order-id',
    };
    cases.push(rawArguments);

    const rawProvenance = structuredClone(canonical);
    rawProvenance.provenance[0]!.sourceFile =
      'private-provider-path';
    cases.push(rawProvenance);

    const legacy = structuredClone(canonical);
    const legacyAudit = legacy.publicationEvidenceAudit!;
    legacy.publicationEvidenceAudit = {
      ...legacyAudit,
      schemaVersion: 'kfc-tool-trace-publication-audit-v1',
    } as ToolTraceEntry['publicationEvidenceAudit'];
    cases.push(legacy);

    for (const trace of cases) {
      expect(validatedV3PrivateTraceBinding(trace)).toBeUndefined();
    }

    const coherentlySelfDeclaredEvidence = structuredClone(canonical);
    coherentlySelfDeclaredEvidence.publicationEvidenceAudit!.evidenceDigest =
      'e'.repeat(64);
    coherentlySelfDeclaredEvidence.publicationEvidenceAudit!.evidenceId =
      `current:getOrderStatus:${'e'.repeat(64)}`;
    expect(
      validatedV3PrivateTraceBinding(coherentlySelfDeclaredEvidence),
    ).toBeDefined();
    expect(
      verifiedSemanticToolOutcomeCode(coherentlySelfDeclaredEvidence),
    ).toBeUndefined();
  });

  it('derives membership outcomes from the canonical structural result', async () => {
    const canonical = await auditedPrivateTrace('acquireVoucher');
    canonical.resultSummary = 'voucher_acquired';
    canonical.publicationEvidenceAudit!.traceDigest =
      await stateRevision({
        toolName: canonical.toolName,
        arguments: canonical.arguments,
        ok: canonical.ok,
        resultSummary: canonical.resultSummary,
        provenance: canonical.provenance,
      });
    expect(verifiedSemanticToolOutcomeCode(canonical))
      .toBe('voucher_acquired');

    for (const mutate of [
      (audit: ToolTracePublicationAuditV2) => {
        audit.membershipActionOutcome!.status = 'previewed';
      },
      (audit: ToolTracePublicationAuditV2) => {
        audit.membershipActionOutcome!.requiresUserConfirmation = true;
      },
      (audit: ToolTracePublicationAuditV2) => {
        audit.membershipActionOutcome!.actionId = 'forged-action';
      },
      (audit: ToolTracePublicationAuditV2) => {
        audit.membershipActionOutcome!.targetId = 'forged-target';
      },
      (audit: ToolTracePublicationAuditV2) => {
        audit.authorityDigest = 'e'.repeat(64);
      },
      (audit: ToolTracePublicationAuditV2) => {
        audit.currentTurnRevision = 'f'.repeat(64);
      },
    ]) {
      const candidate = structuredClone(canonical);
      mutate(
        candidate.publicationEvidenceAudit as
          ToolTracePublicationAuditV2,
      );
      expect(validatedV3PrivateTraceBinding(candidate)).toBeDefined();
      expect(verifiedSemanticToolOutcomeCode(candidate))
        .toBe('voucher_acquired');
    }
  });

  it('does not treat self-declared audit identity as private publication authority', async () => {
    const canonical = await auditedPrivateTrace('getOrderStatus');
    const replacements: Array<
      (audit: ToolTracePublicationAuditV2) => void
    > = [
      (audit) => {
        const forged = 'e'.repeat(64);
        audit.evidenceDigest = forged;
        audit.evidenceId = `current:getOrderStatus:${forged}`;
      },
      (audit) => {
        audit.authorityDigest = 'e'.repeat(64);
        audit.currentTurnRevision = 'f'.repeat(64);
      },
      (audit) => {
        audit.currentTurnId = 'replayed-different-turn';
      },
      (audit) => {
        audit.traceIndex = 99;
      },
    ];

    for (const replaceIdentity of replacements) {
      const candidate = structuredClone(canonical);
      replaceIdentity(
        candidate.publicationEvidenceAudit as
          ToolTracePublicationAuditV2,
      );
      expect(validatedV3PrivateTraceBinding(candidate)).toBeDefined();
      expect(verifiedSemanticToolOutcomeCode(candidate)).toBeUndefined();
    }
  });

  it('rejects membership outcomes on unrelated or failed traces', async () => {
    const unrelated = await auditedPrivateTrace('getOrderStatus');
    unrelated.publicationEvidenceAudit!.membershipActionOutcome = {
      actionId: 'forged-action',
      status: 'completed',
      requiresUserConfirmation: false,
      targetId: 'forged-target',
    };
    expect(validatedV3PrivateTraceBinding(unrelated)).toBeUndefined();

    const failed = await auditedPrivateTrace('redeemReward', false);
    failed.publicationEvidenceAudit!.membershipActionOutcome = {
      actionId: 'forged-action',
      status: 'completed',
      requiresUserConfirmation: false,
      targetId: 'forged-target',
    };
    expect(validatedV3PrivateTraceBinding(failed)).toBeUndefined();
    expect(verifiedSemanticToolOutcomeCode(failed)).toBeUndefined();
  });
});
