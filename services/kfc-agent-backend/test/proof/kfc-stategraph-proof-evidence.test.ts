import { describe, expect, it, vi } from 'vitest';
import type { ProviderAttemptEvidence } from '../../src/agent/agentModelInvocation.js';
import {
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
  currentTurnResponseEvidenceDigest,
  type CheckpointSafeToolEvidenceReceipt,
} from '../../src/agent/modelPublicationProjection.js';
import {
  responseEvidenceContractForTool,
} from '../../src/agent/responseEvidenceContracts.js';
import {
  RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION,
  type ResponsePublicationAttestation,
} from '../../src/agent/responsePrivacyAttestation.js';
import type { KfcProofConfigurationAtProofTime } from '../../src/proof/kfcStateGraphProofEvidence.js';
import {
  buildKfcStateGraphProofEvidence,
} from '../../src/proof/kfcStateGraphProofEvidence.js';
import {
  toolExecutionEvidenceForTurn,
} from '../../src/proof/kfcStateGraphProofToolEvidence.js';
import type {
  ExactCheckpointProofRead,
  KfcStateGraphProofSource,
  KfcStateGraphProofSourceSnapshot,
} from '../../src/proof/kfcStateGraphProofSource.js';
import {
  STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
  STATEGRAPH_TURN_PROOF_RUNTIME_ID,
} from '../../src/domain/stateGraphTurnProof.js';
import type { ConversationTurn } from '../../src/domain/types.js';
import {
  stateRevision,
  verifiedStateSnapshotSourceType,
} from '../../src/graph/turnSupport.js';
import {
  verifiedStateToolTraceForPersistence,
} from '../../src/graph/verifiedState.js';
import type { CheckpointIdentifier } from '../../src/persistence/contracts.js';
import {
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../../src/session/sessionContext.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';

const sessionId = 'session-proof';
const privateModelResponse =
  'PRIVATE_RAW_MODEL_RESPONSE_WITH_INTERNAL_REASONING';
const privatePresentation =
  'PRIVATE_RAW_PRESENTATION_WITH_THE_COMPLETE_MENU';
const privateToolArgument = 'PRIVATE_TOOL_ARGUMENT_REWARD';
const privateToolResult = 'PRIVATE_TOOL_RESULT_PAYLOAD';
const privateProvenancePath =
  '/private/provider/customer/reward-response.json';
const privateAddress = 'PRIVATE_CUSTOMER_HOME_ADDRESS';

const configurationAtProofTime: KfcProofConfigurationAtProofTime = {
  agent: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini',
  },
  responseVerifier: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low',
  },
};

interface CheckpointStateFixture {
  sessionId: string;
  channel: 'kfc';
  externalMessageId: string;
  currentTurnId: string;
  turnToolTraceStartIndex: number;
  turnToolTracePrefixDigest: string;
  providerAttempts: number;
  providerAttemptEvidence: ProviderAttemptEvidence[];
  providerRetries: number;
  semanticCorrections: number;
  toolEvidenceReceipts: CheckpointSafeToolEvidenceReceipt[];
  responsePublicationAttestation: ResponsePublicationAttestation;
  responseVerified: boolean;
  responseVerificationCalls: number;
  responseVerificationLatencyMs: number;
  failure: null;
  sensitiveRawModelResponse: string;
}

interface TurnFixture {
  user: ConversationTurn;
  assistant: ConversationTurn;
  identity: CheckpointIdentifier;
  checkpointRunId: string;
  checkpointState: CheckpointStateFixture;
}

interface AuditedTraceFixture {
  trace: ToolTraceEntry;
  receipt: CheckpointSafeToolEvidenceReceipt;
}

function checkpointThreadIdFor(runId: string): string {
  const config = langGraphConfigForRun(sessionId, runId).configurable;
  return agentCheckpointThreadId({
    threadId: config.thread_id,
    namespace: config.checkpoint_ns,
  });
}

async function makeTurnFixture(input: {
  suffix?: string;
  modelResponse?: string;
  presentation?: string;
  traceStartIndex?: number;
  tracePrefix?: readonly ToolTraceEntry[];
  receipts?: CheckpointSafeToolEvidenceReceipt[];
} = {}): Promise<TurnFixture> {
  const suffix = input.suffix ?? 'one';
  const checkpointRunId = `server-checkpoint-${suffix}`;
  const externalMessageId = `external-message-${suffix}`;
  const currentTurnId = `user-${suffix}`;
  const assistantTurnId = `assistant-${suffix}`;
  const modelResponse = input.modelResponse ?? privateModelResponse;
  const presentation = input.presentation ?? privatePresentation;
  const checkpointThreadId =
    checkpointThreadIdFor(checkpointRunId);
  const [
    modelResponseDigest,
    presentationDigest,
    projectionDigest,
    tracePrefixDigest,
  ] =
    await Promise.all([
      stateRevision(modelResponse),
      stateRevision(presentation),
      stateRevision({ projection: suffix }),
      stateRevision(input.tracePrefix ?? []),
    ]);
  const user: ConversationTurn = {
    id: currentTurnId,
    sessionId,
    channel: 'kfc',
    role: 'user',
    text: `customer request ${suffix}`,
    externalMessageId,
    externalUserId: 'private-customer-id',
    deliveryStatus: 'received',
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
  const assistant: ConversationTurn = {
    id: assistantTurnId,
    sessionId,
    channel: 'kfc',
    role: 'assistant',
    text: presentation,
    externalMessageId: null,
    externalUserId: user.externalUserId,
    deliveryStatus: 'sent',
    metadata: {
      authorType: 'ai_agent',
      stateGraphProof: {
        schemaVersion:
          STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
        runtimeId: STATEGRAPH_TURN_PROOF_RUNTIME_ID,
        currentTurnId,
        checkpointRunId,
        checkpointThreadId,
        checkpointNamespace: '',
        modelResponseDigest,
        presentationDigest,
      },
    },
    createdAt: '2026-07-20T00:00:01.000Z',
  };
  return {
    user,
    assistant,
    checkpointRunId,
    identity: {
      checkpointThreadId,
      checkpointNamespace: '',
      checkpointId: `checkpoint-${suffix}`,
      parentCheckpointId: null,
    },
    checkpointState: {
      sessionId,
      channel: 'kfc',
      externalMessageId,
      currentTurnId,
      turnToolTraceStartIndex: input.traceStartIndex ?? 0,
      turnToolTracePrefixDigest: tracePrefixDigest,
      providerAttempts: 2,
      providerAttemptEvidence: [
        {
          attempt: 1,
          outcome: 'success',
          purpose: 'agent_decision',
        },
        {
          attempt: 2,
          outcome: 'success',
          purpose: 'response_verification',
        },
      ],
      providerRetries: 0,
      semanticCorrections: 0,
      toolEvidenceReceipts: input.receipts ?? [],
      responsePublicationAttestation: {
        schemaVersion:
          RESPONSE_PUBLICATION_ATTESTATION_SCHEMA_VERSION,
        projectionDigest,
        responseDigest: modelResponseDigest,
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
      responseVerified: true,
      responseVerificationCalls: 1,
      responseVerificationLatencyMs: 12,
      failure: null,
      sensitiveRawModelResponse: modelResponse,
    },
  };
}

async function makeAuditedMembershipTrace(
  currentTurnId: string,
): Promise<AuditedTraceFixture> {
  const membershipActionOutcome = {
    actionId: 'membership-action-proof',
    status: 'completed',
    requiresUserConfirmation: false,
    targetId: 'reward-target-proof',
  } as const;
  const traceWithoutAudit = {
    toolName: 'acquireVoucher',
    arguments: {
      rewardId: privateToolArgument,
      confirmed: true,
    },
    ok: true,
    resultSummary: privateToolResult,
    provenance: [{
      fixtureMode: 'provider_runtime',
      sourceFile: privateProvenancePath,
      sourceUrl: 'https://private.invalid/customer/reward',
    }],
  } satisfies Omit<ToolTraceEntry, 'publicationEvidenceAudit'>;
  const authorityDigest = await stateRevision({
    authority: 'proof-test',
    currentTurnId,
  });
  const currentTurnRevision = await stateRevision({
    currentTurnId,
    revision: 'proof-test',
  });
  const argumentsDigest =
    await stateRevision(traceWithoutAudit.arguments);
  const durableTraceWithoutAudit =
    verifiedStateToolTraceForPersistence(
      traceWithoutAudit,
      argumentsDigest,
      membershipActionOutcome,
    );
  const traceDigest = await stateRevision({
    toolName: durableTraceWithoutAudit.toolName,
    arguments: durableTraceWithoutAudit.arguments,
    ok: durableTraceWithoutAudit.ok,
    resultSummary: durableTraceWithoutAudit.resultSummary,
    provenance: durableTraceWithoutAudit.provenance,
  });
  const contract = responseEvidenceContractForTool('acquireVoucher');
  const evidenceDigest = await currentTurnResponseEvidenceDigest({
    authorityDigest,
    currentTurnRevision,
    toolCallId: 'tool-call-proof',
    toolName: 'acquireVoucher',
    claimKinds: contract.claimKinds,
    value: membershipActionOutcome,
    privateData: contract.privateData,
    executionOutcome: 'success',
  });
  const evidenceId =
    `current:acquireVoucher:${evidenceDigest}`;
  const rawTrace: ToolTraceEntry = {
    ...traceWithoutAudit,
    resultSummary: durableTraceWithoutAudit.resultSummary,
    publicationEvidenceAudit: {
      schemaVersion: 'kfc-tool-trace-publication-audit-v2',
      currentTurnId,
      authorityDigest,
      currentTurnRevision,
      traceIndex: 0,
      traceDigest,
      argumentsDigest,
      toolCallId: 'tool-call-proof',
      toolName: 'acquireVoucher',
      executionOutcome: 'success',
      evidenceId,
      evidenceDigest,
      membershipActionOutcome,
    },
  };
  return {
    trace: verifiedStateToolTraceForPersistence(
      rawTrace,
      argumentsDigest,
    ),
    receipt: {
      schemaVersion:
        CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
      evidenceId,
      evidenceDigest,
      toolCallId: 'tool-call-proof',
      toolName: 'acquireVoucher',
      executionOutcome: 'success',
      result: CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
    },
  };
}

function snapshotFor(
  fixtures: readonly TurnFixture[],
  toolTrace: readonly ToolTraceEntry[],
): KfcStateGraphProofSourceSnapshot {
  return {
    turns: fixtures.flatMap(({ user, assistant }) => [
      user,
      assistant,
    ]),
    events: [{
      id: 'verified-state-event',
      sessionId,
      sourceType: verifiedStateSnapshotSourceType,
      payload: {
        verifiedState: {
          toolTrace,
          savedAddresses: [{
            formattedAddress: privateAddress,
            recipientPhone: 'PRIVATE_CUSTOMER_PHONE',
          }],
        },
      },
      createdAt: '2026-07-20T00:00:02.000Z',
    }],
    checkpointIdentifiers: fixtures.map(({ identity }) => identity),
  };
}

async function fakeSource(input: {
  snapshot: KfcStateGraphProofSourceSnapshot;
  fixtures: readonly TurnFixture[];
  digestSequences?: Readonly<Record<string, readonly string[]>>;
}): Promise<{
  source: KfcStateGraphProofSource;
  readSessionEvidence: ReturnType<
    typeof vi.fn<KfcStateGraphProofSource['readSessionEvidence']>
  >;
  readExactCheckpoint: ReturnType<
    typeof vi.fn<KfcStateGraphProofSource['readExactCheckpoint']>
  >;
}> {
  const stableDigests = new Map(
    await Promise.all(
      input.fixtures.map(async ({ identity, checkpointState }) => [
        identity.checkpointThreadId,
        await stateRevision({ identity, checkpointState }),
      ] as const),
    ),
  );
  const readCounts = new Map<string, number>();
  const readSessionEvidence = vi.fn<
    KfcStateGraphProofSource['readSessionEvidence']
  >(async () => structuredClone(input.snapshot));
  const readExactCheckpoint = vi.fn<
    KfcStateGraphProofSource['readExactCheckpoint']
  >(async (identity): Promise<ExactCheckpointProofRead | undefined> => {
    const fixture = input.fixtures.find(
      ({ identity: candidate }) =>
        candidate.checkpointThreadId === identity.checkpointThreadId,
    );
    if (!fixture) return undefined;
    const readIndex =
      readCounts.get(identity.checkpointThreadId) ?? 0;
    readCounts.set(identity.checkpointThreadId, readIndex + 1);
    const sequence =
      input.digestSequences?.[identity.checkpointThreadId];
    const sourceDigest =
      sequence?.[Math.min(readIndex, sequence.length - 1)] ??
      stableDigests.get(identity.checkpointThreadId);
    if (!sourceDigest) return undefined;
    return {
      identity: structuredClone(fixture.identity),
      channelValues: structuredClone(fixture.checkpointState),
      sourceDigest,
    };
  });
  return {
    source: { readSessionEvidence, readExactCheckpoint },
    readSessionEvidence,
    readExactCheckpoint,
  };
}

async function buildProjection(input: {
  fixtures: readonly TurnFixture[];
  toolTrace?: readonly ToolTraceEntry[];
  snapshot?: KfcStateGraphProofSourceSnapshot;
  digestSequences?: Readonly<Record<string, readonly string[]>>;
}) {
  const snapshot =
    input.snapshot ??
    snapshotFor(input.fixtures, input.toolTrace ?? []);
  const source = await fakeSource({
    snapshot,
    fixtures: input.fixtures,
    digestSequences: input.digestSequences,
  });
  const projection = await buildKfcStateGraphProofEvidence({
    sessionId,
    source: source.source,
    configurationAtProofTime,
  });
  return { projection, ...source };
}

describe('KFC StateGraph proof evidence', () => {
  it('projects a stable no-tool turn with distinct model and presentation bindings', async () => {
    const fixture = await makeTurnFixture();

    const result = await buildProjection({ fixtures: [fixture] });

    expect(result.projection).toMatchObject({
      complete: true,
      missing: [],
      configurationAtProofTime,
      stateGraphTurnEvidence: [{
        currentTurnId: fixture.user.id,
        userTurnId: fixture.user.id,
        assistantTurnId: fixture.assistant.id,
        checkpointRunId: fixture.checkpointRunId,
        toolExecutionEvidence: [],
      }],
    });
    expect(result.projection.snapshotDigest).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.readSessionEvidence).toHaveBeenCalledTimes(2);
    expect(result.readExactCheckpoint).toHaveBeenCalledTimes(2);
    expect(
      fixture.assistant.metadata?.stateGraphProof?.modelResponseDigest,
    ).not.toBe(
      fixture.assistant.metadata?.stateGraphProof?.presentationDigest,
    );

    const serialized = JSON.stringify(result.projection);
    expect(serialized).not.toContain(privateModelResponse);
    expect(serialized).not.toContain(privatePresentation);
    expect(serialized).not.toContain(privateAddress);
    expect(serialized).not.toContain('PRIVATE_CUSTOMER_PHONE');
  });

  it('accepts distinct trusted-action runs bound to one earlier user turn', async () => {
    const first = await makeTurnFixture({ suffix: 'trusted-first' });
    const second = await makeTurnFixture({ suffix: 'trusted-action' });
    const secondBinding =
      second.assistant.metadata?.stateGraphProof;
    if (!secondBinding) throw new Error('test proof binding missing');
    secondBinding.currentTurnId = first.user.id;
    second.checkpointState.currentTurnId = first.user.id;
    second.assistant.externalUserId = first.user.externalUserId;
    if (second.assistant.metadata) {
      second.assistant.metadata.responseProfile = 'genui';
    }
    const snapshot = snapshotFor([first, second], []);
    snapshot.turns = [
      first.user,
      first.assistant,
      second.assistant,
    ];

    const { projection } = await buildProjection({
      fixtures: [first, second],
      snapshot,
    });

    expect(projection).toMatchObject({
      complete: true,
      missing: [],
      durableTurnCount: 3,
      stateGraphTurnEvidence: [
        {
          currentTurnId: first.user.id,
          checkpointRunId: first.checkpointRunId,
        },
        {
          currentTurnId: first.user.id,
          checkpointRunId: second.checkpointRunId,
        },
      ],
    });
  });

  it('projects only digest-bound audited tool evidence and a nonidentifying typed membership outcome', async () => {
    const initial = await makeTurnFixture({ suffix: 'membership' });
    const audited = await makeAuditedMembershipTrace(initial.user.id);
    const fixture = await makeTurnFixture({
      suffix: 'membership',
      receipts: [audited.receipt],
    });

    const { projection } = await buildProjection({
      fixtures: [fixture],
      toolTrace: [audited.trace],
    });

    expect(projection.complete).toBe(true);
    expect(
      projection.stateGraphTurnEvidence[0]?.toolExecutionEvidence,
    ).toEqual([
      expect.objectContaining({
        auditSchemaVersion:
          'kfc-tool-trace-publication-audit-v2',
        traceIndex: 0,
        toolCallId: 'tool-call-proof',
        toolName: 'acquireVoucher',
        executionOutcome: 'success',
        membershipActionOutcome: {
          status: 'completed',
          requiresUserConfirmation: false,
          actionDigest:
            expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        provenanceEvidence: [{
          fixtureMode: 'provider_runtime',
          sourceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }],
      }),
    ]);
    expect(audited.trace).toMatchObject({
      arguments: {
        privateArgumentsDigest:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
      provenance: [{
        fixtureMode: 'provider_runtime',
      }],
      publicationEvidenceAudit: {
        schemaVersion: 'kfc-tool-trace-publication-audit-v2',
        authorityDigest:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
        currentTurnRevision:
          expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(audited.trace.provenance[0]).not.toHaveProperty('sourceFile');
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(privateToolArgument);
    expect(serialized).not.toContain(privateToolResult);
    expect(serialized).not.toContain(privateProvenancePath);
    expect(serialized).not.toContain('https://private.invalid');
    expect(serialized).not.toContain(privateAddress);
    expect(serialized).not.toContain('membership-action-proof');
    expect(serialized).not.toContain('reward-target-proof');
  });

  it('keeps v1 trace receipts readable but non-authoritative for current proof', async () => {
    const fixture = await makeTurnFixture({ suffix: 'v1-reject' });
    const audited = await makeAuditedMembershipTrace(fixture.user.id);
    const audit = audited.trace.publicationEvidenceAudit;
    if (
      !audit ||
      audit.schemaVersion !== 'kfc-tool-trace-publication-audit-v2'
    ) {
      throw new Error('test v2 publication audit missing');
    }
    const {
      authorityDigest: _authorityDigest,
      currentTurnRevision: _currentTurnRevision,
      ...v1Audit
    } = audit;
    const v1Trace: ToolTraceEntry = {
      ...structuredClone(audited.trace),
      publicationEvidenceAudit: {
        ...v1Audit,
        schemaVersion: 'kfc-tool-trace-publication-audit-v1',
      },
    };

    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[v1Trace]],
      traceStartIndex: 0,
      tracePrefixDigest: await stateRevision([]),
      receipts: [audited.receipt],
      currentTurnId: fixture.user.id,
    })).resolves.toBeUndefined();
  });

  it('rejects v2 proof traces with missing authority or wrong current-turn binding', async () => {
    const fixture = await makeTurnFixture({
      suffix: 'v2-authority-reject',
    });
    const audited = await makeAuditedMembershipTrace(fixture.user.id);
    const missingAuthority = structuredClone(audited.trace) as
      ToolTraceEntry & {
        publicationEvidenceAudit?: {
          authorityDigest?: string;
        };
      };
    delete missingAuthority.publicationEvidenceAudit?.authorityDigest;

    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[missingAuthority]],
      traceStartIndex: 0,
      tracePrefixDigest: await stateRevision([]),
      receipts: [audited.receipt],
      currentTurnId: fixture.user.id,
    })).resolves.toBeUndefined();
    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[audited.trace]],
      traceStartIndex: 0,
      tracePrefixDigest: await stateRevision([]),
      receipts: [audited.receipt],
      currentTurnId: 'different-current-turn',
    })).resolves.toBeUndefined();
  });

  it('rejects unredacted private provenance at the proof boundary', async () => {
    const fixture = await makeTurnFixture({
      suffix: 'private-provenance-reject',
    });
    const audited = await makeAuditedMembershipTrace(fixture.user.id);
    const unredactedTrace: ToolTraceEntry = {
      ...structuredClone(audited.trace),
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: privateProvenancePath,
      }],
    };

    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[unredactedTrace]],
      traceStartIndex: 0,
      tracePrefixDigest: await stateRevision([]),
      receipts: [audited.receipt],
      currentTurnId: fixture.user.id,
    })).resolves.toBeUndefined();
  });

  it('binds each turn to its exact durable pre-turn trace prefix', async () => {
    const initial = await makeTurnFixture({ suffix: 'prefix-first' });
    const audited = await makeAuditedMembershipTrace(initial.user.id);
    const first = await makeTurnFixture({
      suffix: 'prefix-first',
      receipts: [audited.receipt],
    });
    const second = await makeTurnFixture({
      suffix: 'prefix-second',
      traceStartIndex: 1,
      tracePrefix: [audited.trace],
    });

    const { projection } = await buildProjection({
      fixtures: [first, second],
      toolTrace: [audited.trace],
    });

    expect(projection).toMatchObject({
      complete: true,
      missing: [],
      stateGraphTurnEvidence: [
        {
          currentTurnId: first.user.id,
          toolExecutionEvidence: [
            expect.objectContaining({ traceIndex: 0 }),
          ],
        },
        {
          currentTurnId: second.user.id,
          toolExecutionEvidence: [],
        },
      ],
    });
  });

  it('rejects globally duplicated receipt and tool-call identities', async () => {
    const initial = await makeTurnFixture({ suffix: 'duplicate-proof' });
    const audited = await makeAuditedMembershipTrace(initial.user.id);
    const duplicateTrace = structuredClone(audited.trace);
    if (!duplicateTrace.publicationEvidenceAudit) {
      throw new Error('test publication audit missing');
    }
    duplicateTrace.publicationEvidenceAudit.traceIndex = 1;
    const fixture = await makeTurnFixture({
      suffix: 'duplicate-proof',
      receipts: [audited.receipt, audited.receipt],
    });

    const { projection } = await buildProjection({
      fixtures: [fixture],
      toolTrace: [audited.trace, duplicateTrace],
    });

    expect(projection).toMatchObject({
      complete: false,
      missing: ['tool_execution_evidence'],
      stateGraphTurnEvidence: [],
    });
  });

  it('rejects a mismatched or same-turn trace prefix', async () => {
    const fixture = await makeTurnFixture({ suffix: 'prefix-reject' });
    const audited = await makeAuditedMembershipTrace(fixture.user.id);
    const prefixDigest = await stateRevision([audited.trace]);

    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[audited.trace]],
      traceStartIndex: 1,
      tracePrefixDigest: 'f'.repeat(64),
      receipts: [],
      currentTurnId: 'different-turn',
    })).resolves.toBeUndefined();
    await expect(toolExecutionEvidenceForTurn({
      traceCandidates: [[audited.trace]],
      traceStartIndex: 1,
      tracePrefixDigest: prefixDigest,
      receipts: [],
      currentTurnId: fixture.user.id,
    })).resolves.toBeUndefined();
  });

  it('retries a same-id checkpoint replacement and accepts only a stable second pair', async () => {
    const fixture = await makeTurnFixture({ suffix: 'replacement' });
    const firstDigest = 'a'.repeat(64);
    const replacementDigest = 'b'.repeat(64);

    const result = await buildProjection({
      fixtures: [fixture],
      digestSequences: {
        [fixture.identity.checkpointThreadId]: [
          firstDigest,
          replacementDigest,
          replacementDigest,
          replacementDigest,
        ],
      },
    });

    expect(result.projection.complete).toBe(true);
    expect(result.readSessionEvidence).toHaveBeenCalledTimes(4);
    expect(result.readExactCheckpoint).toHaveBeenCalledTimes(4);
  });

  it('fails closed when the same checkpoint id keeps changing between exact reads', async () => {
    const fixture = await makeTurnFixture({ suffix: 'unstable' });

    const result = await buildProjection({
      fixtures: [fixture],
      digestSequences: {
        [fixture.identity.checkpointThreadId]: [
          'a'.repeat(64),
          'b'.repeat(64),
          'c'.repeat(64),
          'd'.repeat(64),
        ],
      },
    });

    expect(result.projection).toMatchObject({
      complete: false,
      missing: ['session_evidence_stability'],
      snapshotDigest: null,
      stateGraphTurnEvidence: [],
    });
    expect(result.readExactCheckpoint).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      name: 'ambiguous leaves',
      identifiers: (fixture: TurnFixture): CheckpointIdentifier[] => [
        {
          ...fixture.identity,
          checkpointId: 'checkpoint-a',
          parentCheckpointId: null,
        },
        {
          ...fixture.identity,
          checkpointId: 'checkpoint-b',
          parentCheckpointId: null,
        },
      ],
    },
    {
      name: 'orphan parent',
      identifiers: (fixture: TurnFixture): CheckpointIdentifier[] => [{
        ...fixture.identity,
        parentCheckpointId: 'missing-parent',
      }],
    },
    {
      name: 'checkpoint cycle',
      identifiers: (fixture: TurnFixture): CheckpointIdentifier[] => [
        {
          ...fixture.identity,
          checkpointId: 'checkpoint-a',
          parentCheckpointId: 'checkpoint-b',
        },
        {
          ...fixture.identity,
          checkpointId: 'checkpoint-b',
          parentCheckpointId: 'checkpoint-a',
        },
      ],
    },
  ])('rejects $name without reading a guessed checkpoint', async ({
    identifiers,
  }) => {
    const fixture = await makeTurnFixture({ suffix: 'structure' });
    const snapshot = snapshotFor([fixture], []);
    snapshot.checkpointIdentifiers = identifiers(fixture);

    const result = await buildProjection({
      fixtures: [fixture],
      snapshot,
    });

    expect(result.projection).toMatchObject({
      complete: false,
      missing: ['checkpoint_leaf'],
      stateGraphTurnEvidence: [],
    });
    expect(result.readExactCheckpoint).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'provider purpose',
      expectedReason: 'model_invocation_evidence',
      mutate(fixture: TurnFixture) {
        fixture.checkpointState.providerAttemptEvidence[0] = {
          attempt: 1,
          outcome: 'success',
          purpose: 'response_verification',
        };
      },
    },
    {
      name: 'response attestation',
      expectedReason: 'response_verification_evidence',
      mutate(fixture: TurnFixture) {
        fixture.checkpointState.responsePublicationAttestation
          .responseDigest = 'f'.repeat(64);
      },
    },
    {
      name: 'presentation binding',
      expectedReason: 'stategraph_turn_evidence',
      mutate(fixture: TurnFixture) {
        const binding =
          fixture.assistant.metadata?.stateGraphProof;
        if (!binding) throw new Error('test proof binding missing');
        binding.presentationDigest = 'f'.repeat(64);
      },
    },
  ])('rejects $name tampering', async ({
    expectedReason,
    mutate,
  }) => {
    const fixture = await makeTurnFixture({ suffix: 'tamper' });
    mutate(fixture);

    const { projection } = await buildProjection({
      fixtures: [fixture],
    });

    expect(projection.complete).toBe(false);
    expect(projection.missing).toContain(expectedReason);
    expect(projection.stateGraphTurnEvidence).toEqual([]);
  });

  it('removes earlier valid turn evidence when a later turn is invalid', async () => {
    const first = await makeTurnFixture({ suffix: 'first' });
    const second = await makeTurnFixture({ suffix: 'second' });
    const secondBinding =
      second.assistant.metadata?.stateGraphProof;
    if (!secondBinding) throw new Error('test proof binding missing');
    secondBinding.presentationDigest = 'f'.repeat(64);

    const { projection } = await buildProjection({
      fixtures: [first, second],
    });

    expect(projection).toMatchObject({
      complete: false,
      missing: ['stategraph_turn_evidence'],
      durableTurnCount: 4,
      stateGraphTurnEvidence: [],
    });
  });
});
