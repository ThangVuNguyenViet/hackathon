import {
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  KfcAgentState,
  type KfcAgentStateUpdate,
} from '../../src/agent/agentStateSchema.js';

describe('KFC agent StateSchema', () => {
  it('publishes required graph input and native defaults to LangGraph', () => {
    expect(KfcAgentState.getJsonSchema()).toMatchObject({
      type: 'object',
      required: ['sessionId', 'customerId', 'channel'],
      properties: {
        turnDeadlineAt: { default: 0, type: 'number' },
        currentTurnId: { default: null },
        turnToolTraceStartIndex: { default: 0, type: 'integer' },
        turnToolTracePrefixDigest: { default: null },
        providerAttempts: { default: 0, type: 'integer' },
        advertisedToolNames: { default: [], type: 'array' },
        responsePublicationAttestation: { default: null },
        responsePublicationValidated: { default: false, type: 'boolean' },
        failure: { default: null },
      },
    });
  });

  it('exposes every declared state field through LangGraph channels', () => {
    expect(Object.keys(KfcAgentState.getChannels())).toEqual(
      expect.arrayContaining([
        'messages',
        'domainState',
        'currentTurnId',
        'turnToolTraceStartIndex',
        'turnToolTracePrefixDigest',
        'turnDeadlineAt',
        'advertisedToolNames',
        'pendingToolCalls',
        'responsePublicationAttestation',
        'responseText',
        'output',
        'failure',
      ]),
    );
  });

  it('rejects malformed or non-serializable tracked state', async () => {
    const invalidUpdates = [
      { currentTurnId: '' },
      { turnToolTraceStartIndex: -1 },
      { turnToolTraceStartIndex: 1.5 },
      { turnToolTracePrefixDigest: 'not-a-digest' },
      { advertisedToolNames: ['inventedTool'] },
      {
        responseFactualClaims: {
          evidenceReferences: 'not-an-array',
          hasUnsupportedFactualClaim: false,
        },
      },
      {
        responsePublicationAttestation: {
          schemaVersion: 'kfc-response-publication-attestation-v1',
          projectionDigest: 'not-a-digest',
          responseDigest: 'b'.repeat(64),
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'none',
          disclosureAuthorities: [],
          disclosesInternalMetadata: false,
        },
      },
      {
        toolEvidenceReceipts: [{
          schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v1',
          evidenceId: 'stale-runtime-authority',
          evidenceDigest: 'c'.repeat(64),
          toolCallId: 'call-stale',
          toolName: 'searchMenu',
          ok: true,
          result: 'runtime_evidence_available',
        }],
      },
      {
        toolEvidenceReceipts: [{
          schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
          evidenceId: 'obsolete-ok-authority',
          evidenceDigest: 'c'.repeat(64),
          toolCallId: 'call-obsolete-ok',
          toolName: 'searchMenu',
          executionOutcome: 'success',
          ok: true,
          result: 'audit_evidence_reference',
        }],
      },
      {
        toolEvidenceReceipts: [{
          schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
          evidenceId: 'runtime-authority-claim',
          evidenceDigest: 'c'.repeat(64),
          toolCallId: 'call-runtime-authority',
          toolName: 'searchMenu',
          executionOutcome: 'success',
          result: 'runtime_evidence_available',
        }],
      },
      {
        toolEvidenceReceipts: [{
          schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
          evidenceId: 'invalid-outcome',
          evidenceDigest: 'c'.repeat(64),
          toolCallId: 'call-invalid',
          toolName: 'searchMenu',
          executionOutcome: 'unknown',
          result: 'audit_evidence_reference',
        }],
      },
      {
        providerAttemptEvidence: [{
          attempt: 1,
          outcome: 'success',
        }],
      },
    ];

    for (const update of invalidUpdates) {
      await expect(
        KfcAgentState.validateInput(update as never),
      ).rejects.toThrow();
    }
  });

  it('round-trips tracked evidence and resume coordinates through MemorySaver', async () => {
    const responsePublicationAttestation:
      NonNullable<
        KfcAgentStateUpdate['responsePublicationAttestation']
      > = {
      schemaVersion: 'kfc-response-publication-attestation-v1',
      projectionDigest: 'a'.repeat(64),
      responseDigest: 'b'.repeat(64),
      semanticRelevance: 'aligned',
      privateDataDisclosure: 'none',
      disclosureAuthorities: [],
      disclosesInternalMetadata: false,
    };
    const persistedUpdate = {
      currentTurnId: 'turn-42',
      turnToolTraceStartIndex: 7,
      turnToolTracePrefixDigest: 'e'.repeat(64),
      toolEvidenceReceipts: [{
        schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
        evidenceId: 'menu-search-result',
        evidenceDigest: 'c'.repeat(64),
        toolCallId: 'call-1',
        toolName: 'searchMenu',
        executionOutcome: 'success',
        result: 'audit_evidence_reference',
      }],
      providerAttemptEvidence: [{
        attempt: 1,
        outcome: 'success',
        purpose: 'response_composition',
      }],
      advertisedToolNames: ['searchMenu'],
      messages: [new AIMessage({
        content: 'PRIVATE-UNVERIFIED-MODEL-DRAFT',
      })],
      pendingToolCalls: [{
        id: 'call-1',
        toolName: 'searchMenu',
        arguments: {
          scope: 'filtered',
          filters: { query: 'bucket' },
        },
      }],
      queuedToolCalls: [{
        id: 'call-2',
        toolName: 'handoff',
        arguments: { reasons: ['PRIVATE-PENDING-ARGUMENT'] },
      }],
      checkpointSafeApproval: {
        schemaVersion: 'kfc-checkpoint-safe-approval-v1',
        requestId: 'request-42',
        toolName: 'handoff',
        actionDigest: 'd'.repeat(64),
      },
      responseFactualClaims: {
        evidenceReferences: [{
          evidenceId: 'menu-search-result',
          claimKinds: ['product'],
        }],
        hasUnsupportedFactualClaim: false,
      },
      responsePublicationAttestation,
      responsePublicationValidated: true,
    } satisfies KfcAgentStateUpdate;
    const checkpointer = new MemorySaver();
    const graph = new StateGraph(KfcAgentState)
      .addNode('persist_tracked_state', () => persistedUpdate)
      .addEdge(START, 'persist_tracked_state')
      .addEdge('persist_tracked_state', END)
      .compile({ checkpointer });
    const config = {
      configurable: {
        thread_id: 'agent-state-schema-serialization',
      },
    };

    await graph.invoke({
      sessionId: 'session-1',
      customerId: 'customer-1',
      channel: 'kfc',
    }, config);

    const restored = (await checkpointer.getTuple(config))
      ?.checkpoint.channel_values;
    expect(restored).toMatchObject({
      currentTurnId: persistedUpdate.currentTurnId,
      turnToolTraceStartIndex: persistedUpdate.turnToolTraceStartIndex,
      turnToolTracePrefixDigest:
        persistedUpdate.turnToolTracePrefixDigest,
      toolEvidenceReceipts: persistedUpdate.toolEvidenceReceipts,
      providerAttemptEvidence: persistedUpdate.providerAttemptEvidence,
      advertisedToolNames: persistedUpdate.advertisedToolNames,
      checkpointSafeApproval: persistedUpdate.checkpointSafeApproval,
      responseFactualClaims: persistedUpdate.responseFactualClaims,
      responsePublicationAttestation,
      responsePublicationValidated: true,
    });
    expect(restored?.responsePublicationAttestation).toEqual(
      responsePublicationAttestation,
    );
    expect(restored?.responsePublicationAttestation).not.toBe(
      responsePublicationAttestation,
    );
    expect(JSON.stringify(restored?.toolEvidenceReceipts)).not.toContain(
      'runtime_evidence_available',
    );
    expect(restored?.messages).toBeUndefined();
    expect(restored?.text).toBeUndefined();
    expect(restored?.pendingToolCalls).toBeUndefined();
    expect(restored?.queuedToolCalls).toBeUndefined();
    expect(restored?.metadata).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain(
      'PRIVATE-UNVERIFIED-MODEL-DRAFT',
    );
    expect(JSON.stringify(restored)).not.toContain(
      'PRIVATE-PENDING-ARGUMENT',
    );
  });
});
