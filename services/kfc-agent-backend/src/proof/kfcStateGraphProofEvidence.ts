import { z } from 'zod';
import type { AgentModelIdentity } from '../config/agentModelProfile.js';
import type { ConversationTurn } from '../domain/types.js';
import {
  stateGraphTurnProofBindingSchema,
  type StateGraphTurnProofBinding,
} from '../domain/stateGraphTurnProof.js';
import {
  stateRevision,
  verifiedStateSnapshotSourceType,
} from '../graph/turnSupport.js';
import type {
  CheckpointIdentifier,
  StoredEvent,
} from '../persistence/contracts.js';
import {
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../session/sessionContext.js';
import {
  MAXIMUM_AGENT_PROVIDER_CALLS,
  type ProviderAttemptEvidence,
} from '../agent/agentModelInvocation.js';
import {
  responsePublicationAttestationSchema,
  type ResponsePublicationAttestation,
} from '../agent/responsePrivacyAttestation.js';
import {
  createKfcStateGraphProofSource,
  type ExactCheckpointProofRead,
  type KfcStateGraphProofSource,
  type KfcStateGraphProofSourceSnapshot,
} from './kfcStateGraphProofSource.js';
import {
  completeTraceInventoryIsClaimed,
  toolEvidenceReceiptListSchema,
  toolExecutionEvidenceForTurn,
  type KfcProofToolExecutionEvidence,
} from './kfcStateGraphProofToolEvidence.js';

export { createKfcStateGraphProofSource };
export type {
  CreateKfcStateGraphProofSourceInput,
  ExactCheckpointProofRead,
  KfcStateGraphProofSource,
  KfcStateGraphProofSourceSnapshot,
} from './kfcStateGraphProofSource.js';
export type {
  KfcProofProvenanceEvidence,
  KfcProofToolExecutionEvidence,
} from './kfcStateGraphProofToolEvidence.js';

export const KFC_STATEGRAPH_PROOF_EVIDENCE_SCHEMA_VERSION = 2 as const;
export const KFC_STATEGRAPH_PROOF_ARTIFACT_KIND =
  'kfc-stategraph-session-proof-envelope' as const;

export type KfcStateGraphProofMissingReason =
  | 'checkpoint_leaf'
  | 'checkpoint_readability'
  | 'configuration_at_proof_time'
  | 'durable_turn_bindings'
  | 'model_invocation_evidence'
  | 'response_publication_evidence'
  | 'session_evidence_readability'
  | 'session_evidence_stability'
  | 'stategraph_turn_evidence'
  | 'tool_execution_evidence'
  | 'verified_state';

export interface KfcProofConfigurationAtProofTime {
  agent: AgentModelIdentity;
}

export interface KfcProofCheckpointEvidence {
  checkpointThreadId: string;
  checkpointNamespace: '';
  checkpointId: string;
  parentCheckpointId: string | null;
  readable: true;
}

export interface KfcProofResponsePublicationEvidence {
  verified: true;
  publicationAttestation: ResponsePublicationAttestation;
}

export interface KfcStateGraphTurnEvidence {
  currentTurnId: string;
  userTurnId: string;
  assistantTurnId: string;
  checkpointRunId: string;
  checkpoint: KfcProofCheckpointEvidence;
  modelInvocationEvidence: {
    providerRetries: number;
    semanticCorrections: number;
    attempts: ProviderAttemptEvidence[];
  };
  responsePublicationEvidence: KfcProofResponsePublicationEvidence;
  toolExecutionEvidence: KfcProofToolExecutionEvidence[];
}

export interface KfcStateGraphProofEvidenceProjection {
  schemaVersion: typeof KFC_STATEGRAPH_PROOF_EVIDENCE_SCHEMA_VERSION;
  artifactKind: typeof KFC_STATEGRAPH_PROOF_ARTIFACT_KIND;
  complete: boolean;
  missing: KfcStateGraphProofMissingReason[];
  snapshotDigest: string | null;
  configurationAtProofTime: KfcProofConfigurationAtProofTime | null;
  durableTurnCount: number;
  verifiedStateCount: number;
  stateGraphTurnEvidence: KfcStateGraphTurnEvidence[];
}

export interface BuildKfcStateGraphProofEvidenceInput {
  sessionId: string;
  source: KfcStateGraphProofSource;
  configurationAtProofTime?: {
    agent?: AgentModelIdentity;
  };
}

interface BuildKfcStateGraphProofEvidenceSnapshotInput
  extends BuildKfcStateGraphProofEvidenceInput,
    KfcStateGraphProofSourceSnapshot {}

interface BoundAssistantTurn {
  user: ConversationTurn;
  assistant: ConversationTurn;
  binding: StateGraphTurnProofBinding;
}

interface CheckpointProofState {
  sessionId: string;
  channel: ConversationTurn['channel'];
  currentTurnId: string;
  turnToolTraceStartIndex: number;
  turnToolTracePrefixDigest: string;
  providerAttempts: number;
  providerAttemptEvidence: unknown[];
  providerRetries: number;
  semanticCorrections: number;
  toolEvidenceReceipts: unknown[];
  responsePublicationAttestation?: unknown;
  responsePublicationValidated: boolean;
  failure: string | null;
}

const digestPattern = /^[0-9a-f]{64}$/u;
const providerAttemptEvidenceSchema: z.ZodType<ProviderAttemptEvidence> =
  z.object({
    attempt: z.number().int().positive(),
    outcome: z.enum(['error', 'invalid_response', 'success']),
    errorClass: z.enum([
      'aborted',
      'client_error',
      'network_error',
      'rate_limited',
      'server_error',
      'timeout',
      'unknown',
    ]).optional(),
    retryable: z.boolean().optional(),
    purpose: z.enum([
      'agent_decision',
      'response_composition',
    ]),
  }).strict();
const providerAttemptEvidenceListSchema =
  z.array(providerAttemptEvidenceSchema)
    .min(1)
    .max(MAXIMUM_AGENT_PROVIDER_CALLS);
const checkpointProofStateSchema: z.ZodType<CheckpointProofState> =
  z.object({
    sessionId: z.string().min(1),
    channel: z.enum(['kfc', 'messenger', 'zalo']),
    currentTurnId: z.string().min(1),
    turnToolTraceStartIndex: z.number().int().nonnegative(),
    turnToolTracePrefixDigest:
      z.string().regex(digestPattern),
    providerAttempts: z.number().int().nonnegative(),
    providerAttemptEvidence:
      z.array(z.unknown()).max(MAXIMUM_AGENT_PROVIDER_CALLS),
    providerRetries: z.number().int().nonnegative(),
    semanticCorrections: z.number().int().nonnegative(),
    toolEvidenceReceipts: z.array(z.unknown()).max(128),
    responsePublicationAttestation: z.unknown(),
    responsePublicationValidated: z.boolean(),
    failure: z.string().nullable(),
  }).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function boundedModelIdentity(
  value: AgentModelIdentity | undefined,
): AgentModelIdentity | undefined {
  if (
    !value ||
    typeof value.provider !== 'string' ||
    value.provider.length === 0 ||
    value.provider.length > 64 ||
    typeof value.model !== 'string' ||
    value.model.length === 0 ||
    value.model.length > 128 ||
    typeof value.profile !== 'string' ||
    value.profile.length === 0 ||
    value.profile.length > 128
  ) {
    return undefined;
  }
  return {
    provider: value.provider,
    model: value.model,
    profile: value.profile,
  };
}

function proofConfiguration(
  input: Pick<
    BuildKfcStateGraphProofEvidenceInput,
    'configurationAtProofTime'
  >,
): KfcProofConfigurationAtProofTime | undefined {
  const agent = boundedModelIdentity(
    input.configurationAtProofTime?.agent,
  );
  return agent ? { agent } : undefined;
}

function boundAssistantTurns(
  sessionId: string,
  turns: readonly ConversationTurn[],
): BoundAssistantTurn[] | undefined {
  if (
    turns.length === 0 ||
    turns.some((turn) => turn.sessionId !== sessionId)
  ) {
    return undefined;
  }
  const turnsById = new Map<string, ConversationTurn>();
  const turnPositions = new Map<string, number>();
  for (const [index, turn] of turns.entries()) {
    if (turnsById.has(turn.id)) return undefined;
    turnsById.set(turn.id, turn);
    turnPositions.set(turn.id, index);
  }
  const assistantTurns = turns.filter(
    (turn) =>
      turn.role === 'assistant' &&
      turn.metadata?.authorType !== 'human_agent',
  );
  if (assistantTurns.length === 0) return undefined;

  const checkpointThreads = new Set<string>();
  const bound: BoundAssistantTurn[] = [];
  for (const assistant of assistantTurns) {
    const parsed = stateGraphTurnProofBindingSchema.safeParse(
      assistant.metadata?.stateGraphProof,
    );
    if (!parsed.success) return undefined;
    const binding = parsed.data;
    const user = turnsById.get(binding.currentTurnId);
    const logical = langGraphConfigForRun(
      sessionId,
      binding.checkpointRunId,
    ).configurable;
    const expectedCheckpointThreadId = agentCheckpointThreadId({
      threadId: logical.thread_id,
      namespace: logical.checkpoint_ns,
    });
    if (
      !user ||
      user.role !== 'user' ||
      (turnPositions.get(user.id) ?? Number.MAX_SAFE_INTEGER) >=
        (turnPositions.get(assistant.id) ?? -1) ||
      user.channel !== assistant.channel ||
      user.externalUserId !== assistant.externalUserId ||
      binding.checkpointThreadId !== expectedCheckpointThreadId ||
      checkpointThreads.has(binding.checkpointThreadId)
    ) {
      return undefined;
    }
    checkpointThreads.add(binding.checkpointThreadId);
    bound.push({ user, assistant, binding });
  }
  return bound;
}

function exactCheckpointLeaf(
  identifiers: readonly CheckpointIdentifier[],
  checkpointThreadId: string,
): CheckpointIdentifier | undefined {
  const relevant = identifiers.filter(
    (identifier) =>
      identifier.checkpointThreadId === checkpointThreadId &&
      identifier.checkpointNamespace === '',
  );
  if (relevant.length === 0) return undefined;
  const byId = new Map<string, CheckpointIdentifier>();
  for (const identifier of relevant) {
    if (byId.has(identifier.checkpointId)) return undefined;
    byId.set(identifier.checkpointId, identifier);
  }
  for (const identifier of relevant) {
    if (
      identifier.parentCheckpointId !== null &&
      !byId.has(identifier.parentCheckpointId)
    ) {
      return undefined;
    }
  }
  const parentIds = new Set(
    relevant.flatMap(({ parentCheckpointId }) =>
      parentCheckpointId ? [parentCheckpointId] : []),
  );
  const leaves = relevant.filter(
    ({ checkpointId }) => !parentIds.has(checkpointId),
  );
  if (leaves.length !== 1) return undefined;

  const visited = new Set<string>();
  let cursor: CheckpointIdentifier | undefined = leaves[0];
  while (cursor) {
    if (visited.has(cursor.checkpointId)) return undefined;
    visited.add(cursor.checkpointId);
    cursor = cursor.parentCheckpointId
      ? byId.get(cursor.parentCheckpointId)
      : undefined;
  }
  return visited.size === relevant.length ? leaves[0] : undefined;
}

interface ExactCheckpointState {
  state: CheckpointProofState;
  sourceDigest: string;
}

async function exactCheckpointState(input: {
  source: KfcStateGraphProofSource;
  checkpoint: CheckpointIdentifier;
}): Promise<ExactCheckpointState | undefined> {
  try {
    const read = await input.source.readExactCheckpoint(input.checkpoint);
    if (
      !read ||
      read.identity.checkpointThreadId !==
        input.checkpoint.checkpointThreadId ||
      read.identity.checkpointNamespace !==
        input.checkpoint.checkpointNamespace ||
      read.identity.checkpointId !== input.checkpoint.checkpointId ||
      read.identity.parentCheckpointId !==
        input.checkpoint.parentCheckpointId ||
      !digestPattern.test(read.sourceDigest)
    ) {
      return undefined;
    }
    const parsed = checkpointProofStateSchema.safeParse(
      read.channelValues,
    );
    return parsed.success
      ? { state: parsed.data, sourceDigest: read.sourceDigest }
      : undefined;
  } catch {
    return undefined;
  }
}

function verifiedStateToolTraces(
  sessionId: string,
  events: readonly StoredEvent[],
): unknown[][] {
  return events.flatMap((event) => {
    if (
      event.sessionId !== sessionId ||
      event.sourceType !== verifiedStateSnapshotSourceType ||
      !isRecord(event.payload.verifiedState) ||
      !Array.isArray(event.payload.verifiedState.toolTrace)
    ) {
      return [];
    }
    return [event.payload.verifiedState.toolTrace];
  });
}

function providerAttemptsAreComplete(input: {
  attempts: readonly ProviderAttemptEvidence[];
  providerAttempts: number;
}): boolean {
  if (
    input.attempts.length !== input.providerAttempts ||
    input.attempts.some(
      (attempt, index) => attempt.attempt !== index + 1,
    )
  ) {
    return false;
  }
  const semanticSuccess = input.attempts.some(
    ({ outcome, purpose }) =>
      outcome === 'success' &&
      (
        purpose === 'agent_decision' ||
        purpose === 'response_composition'
      ),
  );
  return semanticSuccess;
}

function responseAttestationIsSafe(
  value: unknown,
): value is ResponsePublicationAttestation {
  const parsed = responsePublicationAttestationSchema.safeParse(value);
  return parsed.success &&
    parsed.data.semanticRelevance === 'aligned' &&
    parsed.data.privateDataDisclosure !== 'unauthorized' &&
    !parsed.data.disclosesInternalMetadata;
}

function appendMissing(
  missing: Set<KfcStateGraphProofMissingReason>,
  reason: KfcStateGraphProofMissingReason,
): void {
  missing.add(reason);
}

async function buildKfcStateGraphProofEvidenceSnapshot(
  input: BuildKfcStateGraphProofEvidenceSnapshotInput,
): Promise<{
  projection: KfcStateGraphProofEvidenceProjection;
  checkpointReads: ExactCheckpointProofRead[];
}> {
  const missing = new Set<KfcStateGraphProofMissingReason>();
  const configuration = proofConfiguration(input);
  if (!configuration) {
    appendMissing(missing, 'configuration_at_proof_time');
  }

  const boundTurns = boundAssistantTurns(input.sessionId, input.turns);
  if (!boundTurns) appendMissing(missing, 'durable_turn_bindings');

  const traceCandidates = verifiedStateToolTraces(
    input.sessionId,
    input.events,
  );
  const verifiedStateCount = input.events.filter(
    (event) =>
      event.sessionId === input.sessionId &&
      event.sourceType === verifiedStateSnapshotSourceType,
  ).length;
  if (traceCandidates.length === 0) appendMissing(missing, 'verified_state');

  const stateGraphTurnEvidence: KfcStateGraphTurnEvidence[] = [];
  const checkpointReads: ExactCheckpointProofRead[] = [];
  const claimedTraceIndexes = new Set<number>();
  const claimedTraceAuditKeys = new Set<string>();
  const claimedEvidenceIds = new Set<string>();
  const claimedEvidenceDigests = new Set<string>();
  const claimedToolCallIds = new Set<string>();
  for (const turn of boundTurns ?? []) {
    const checkpointThreadId = turn.binding.checkpointThreadId;
    const leaf = exactCheckpointLeaf(
      input.checkpointIdentifiers,
      checkpointThreadId,
    );
    if (!leaf) {
      appendMissing(missing, 'checkpoint_leaf');
      break;
    }
    const checkpointRead = await exactCheckpointState({
      source: input.source,
      checkpoint: leaf,
    });
    if (!checkpointRead) {
      appendMissing(missing, 'checkpoint_readability');
      break;
    }
    const { state } = checkpointRead;
    checkpointReads.push({
      identity: leaf,
      channelValues: null,
      sourceDigest: checkpointRead.sourceDigest,
    });
    if (
      state.sessionId !== input.sessionId ||
      state.channel !== turn.user.channel ||
      state.currentTurnId !== turn.user.id ||
      state.currentTurnId !== turn.binding.currentTurnId ||
      turn.binding.checkpointNamespace !== '' ||
      turn.binding.presentationDigest !==
        await stateRevision(turn.assistant.text) ||
      state.failure !== null
    ) {
      appendMissing(missing, 'stategraph_turn_evidence');
      break;
    }

    const attempts = providerAttemptEvidenceListSchema.safeParse(
      state.providerAttemptEvidence,
    );
    if (
      !attempts.success ||
      !providerAttemptsAreComplete({
        attempts: attempts.data,
        providerAttempts: state.providerAttempts,
      })
    ) {
      appendMissing(missing, 'model_invocation_evidence');
      break;
    }

    const publicationAttestation =
      responsePublicationAttestationSchema.safeParse(
        state.responsePublicationAttestation,
      );
    if (
      !state.responsePublicationValidated ||
      !publicationAttestation.success ||
      !responseAttestationIsSafe(publicationAttestation.data) ||
      publicationAttestation.data.responseDigest !==
        turn.binding.modelResponseDigest
    ) {
      appendMissing(missing, 'response_publication_evidence');
      break;
    }

    const receipts = toolEvidenceReceiptListSchema.safeParse(
      state.toolEvidenceReceipts,
    );
    if (!receipts.success) {
      appendMissing(missing, 'tool_execution_evidence');
      break;
    }
    const toolExecutionEvidence =
      await toolExecutionEvidenceForTurn({
        traceCandidates,
        traceStartIndex: state.turnToolTraceStartIndex,
        tracePrefixDigest: state.turnToolTracePrefixDigest,
        receipts: receipts.data,
        currentTurnId: state.currentTurnId,
      });
    if (!toolExecutionEvidence) {
      appendMissing(missing, 'tool_execution_evidence');
      break;
    }
    const duplicateAudit = toolExecutionEvidence.some((evidence) => {
      const auditKey =
        `${state.currentTurnId}:${evidence.traceIndex}:` +
        evidence.traceDigest;
      if (
        claimedTraceIndexes.has(evidence.traceIndex) ||
        claimedTraceAuditKeys.has(auditKey) ||
        claimedEvidenceIds.has(evidence.evidenceId) ||
        claimedEvidenceDigests.has(evidence.evidenceDigest) ||
        claimedToolCallIds.has(evidence.toolCallId)
      ) {
        return true;
      }
      claimedTraceIndexes.add(evidence.traceIndex);
      claimedTraceAuditKeys.add(auditKey);
      claimedEvidenceIds.add(evidence.evidenceId);
      claimedEvidenceDigests.add(evidence.evidenceDigest);
      claimedToolCallIds.add(evidence.toolCallId);
      return false;
    });
    if (duplicateAudit) {
      appendMissing(missing, 'tool_execution_evidence');
      break;
    }

    stateGraphTurnEvidence.push({
      currentTurnId: state.currentTurnId,
      userTurnId: turn.user.id,
      assistantTurnId: turn.assistant.id,
      checkpointRunId: turn.binding.checkpointRunId,
      checkpoint: {
        checkpointThreadId,
        checkpointNamespace: '',
        checkpointId: leaf.checkpointId,
        parentCheckpointId: leaf.parentCheckpointId,
        readable: true,
      },
      modelInvocationEvidence: {
        providerRetries: state.providerRetries,
        semanticCorrections: state.semanticCorrections,
        attempts: attempts.data,
      },
      responsePublicationEvidence: {
        verified: true,
        publicationAttestation: publicationAttestation.data,
      },
      toolExecutionEvidence,
    });
  }
  if (
    missing.size === 0 &&
    !await completeTraceInventoryIsClaimed({
      traceCandidates,
      claimedTraceIndexes,
      claimedTraceAuditKeys,
    })
  ) {
    appendMissing(missing, 'tool_execution_evidence');
  }

  const complete =
    missing.size === 0 &&
    boundTurns !== undefined &&
    stateGraphTurnEvidence.length === boundTurns.length;
  return {
    projection: {
      schemaVersion: KFC_STATEGRAPH_PROOF_EVIDENCE_SCHEMA_VERSION,
      artifactKind: KFC_STATEGRAPH_PROOF_ARTIFACT_KIND,
      complete,
      missing: [...missing].sort(),
      snapshotDigest: null,
      configurationAtProofTime: configuration ?? null,
      durableTurnCount: input.turns.length,
      verifiedStateCount,
      stateGraphTurnEvidence: complete ? stateGraphTurnEvidence : [],
    },
    checkpointReads,
  };
}

async function readSessionEvidence(
  input: BuildKfcStateGraphProofEvidenceInput,
): Promise<KfcStateGraphProofSourceSnapshot> {
  return input.source.readSessionEvidence(input.sessionId);
}

async function checkpointReadsAreStable(input: {
  source: KfcStateGraphProofSource;
  reads: readonly ExactCheckpointProofRead[];
}): Promise<boolean> {
  const repeated = await Promise.all(
    input.reads.map(({ identity }) =>
      input.source.readExactCheckpoint(identity)),
  );
  return repeated.every((read, index) => {
    const prior = input.reads[index];
    return (
      !!read &&
      !!prior &&
      read.identity.checkpointThreadId ===
        prior.identity.checkpointThreadId &&
      read.identity.checkpointNamespace ===
        prior.identity.checkpointNamespace &&
      read.identity.checkpointId === prior.identity.checkpointId &&
      read.identity.parentCheckpointId ===
        prior.identity.parentCheckpointId &&
      read.sourceDigest === prior.sourceDigest
    );
  });
}

function failedStableProjection(input: {
  source?: KfcStateGraphProofSourceSnapshot;
  configuration: KfcProofConfigurationAtProofTime | undefined;
  reason:
    | 'session_evidence_readability'
    | 'session_evidence_stability';
}): KfcStateGraphProofEvidenceProjection {
  return {
    schemaVersion: KFC_STATEGRAPH_PROOF_EVIDENCE_SCHEMA_VERSION,
    artifactKind: KFC_STATEGRAPH_PROOF_ARTIFACT_KIND,
    complete: false,
    missing: [
      ...(!input.configuration
        ? ['configuration_at_proof_time' as const]
        : []),
      input.reason,
    ].sort(),
    snapshotDigest: null,
    configurationAtProofTime: input.configuration ?? null,
    durableTurnCount: input.source?.turns.length ?? 0,
    verifiedStateCount: input.source?.events.filter(
      ({ sourceType }) =>
        sourceType === verifiedStateSnapshotSourceType,
    ).length ?? 0,
    stateGraphTurnEvidence: [],
  };
}

export async function buildKfcStateGraphProofEvidence(
  input: BuildKfcStateGraphProofEvidenceInput,
): Promise<KfcStateGraphProofEvidenceProjection> {
  const configuration = proofConfiguration(input);
  let latest: KfcStateGraphProofSourceSnapshot | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const before = await readSessionEvidence(input);
      latest = before;
      const beforeRevision = await stateRevision(before);
      const built = await buildKfcStateGraphProofEvidenceSnapshot({
        sessionId: input.sessionId,
        source: input.source,
        configurationAtProofTime: input.configurationAtProofTime,
        ...before,
      });
      const after = await readSessionEvidence(input);
      latest = after;
      if (
        beforeRevision === await stateRevision(after) &&
        await checkpointReadsAreStable({
          source: input.source,
          reads: built.checkpointReads,
        })
      ) {
        return {
          ...built.projection,
          snapshotDigest: beforeRevision,
        };
      }
    } catch {
      return failedStableProjection({
        source: latest,
        configuration,
        reason: 'session_evidence_readability',
      });
    }
  }
  return failedStableProjection({
    source: latest,
    configuration,
    reason: 'session_evidence_stability',
  });
}
