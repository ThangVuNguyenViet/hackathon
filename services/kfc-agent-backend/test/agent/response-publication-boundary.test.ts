import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
  type ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import {
  createModelResponseClaimVerifier,
  validateGroundedResponse,
  validateResponseClaimVerification,
  type ResponseClaimVerifier,
  type ResponseFactualClaims,
} from '../../src/agent/responseGrounding.js';
import {
  verifyResponse,
  type ResponseVerificationState,
} from '../../src/agent/responseVerification.js';
import {
  invokeAgentModel,
  providerRetryUpdate,
} from '../../src/agent/agentModelInvocation.js';
import {
  validateSelectedActionGroundedResponse,
} from '../../src/agent/selectedActionResponseBoundary.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createAgentTurnExternalCallScope,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import {
  assertPublicationCommitAuthority,
} from '../../src/agent/agentPublicationCommitAuthority.js';
import {
  responsePublicationAttestationSchema,
} from '../../src/agent/responsePrivacyAttestation.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';

const currentUserMessage = 'Show my current cart';
const customerText = 'Your current cart has one item.';

function publicationState(): AgentGraphState {
  const currentUserTurn = {
    id: 'publication-grounding-turn',
    sessionId: 'publication-grounding-session',
    channel: 'kfc' as const,
    role: 'user' as const,
    text: currentUserMessage,
    externalMessageId: 'publication-grounding-message',
    externalUserId: 'publication-grounding-user',
    deliveryStatus: 'received' as const,
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
  return {
    sessionId: currentUserTurn.sessionId,
    customerId: 'publication-grounding-customer',
    channel: currentUserTurn.channel,
    latestUserMessage: currentUserMessage,
    recentTurns: [currentUserTurn],
    cart: {
      id: 'publication-grounding-cart',
      items: [{
        itemCode: 'item-current',
        name: 'Current item',
        quantity: 1,
        unitPriceVnd: 50_000,
      }],
      subtotalVnd: 50_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 50_000,
      voucherCode: null,
    },
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

async function publicationBundle(
  state = publicationState(),
): Promise<ModelPublicationBundle> {
  const currentUserTurn = state.recentTurns?.at(-1);
  if (!currentUserTurn) throw new Error('current user turn missing');
  const authority = await issueModelPublicationAuthority({
    state,
    currentUserTurn,
  });
  return buildModelPublicationBundle({ state, authority });
}

const claims: ResponseFactualClaims = {
  evidenceReferences: [{
    evidenceId: 'cart',
    claimKinds: ['product', 'price'],
  }],
  hasUnsupportedFactualClaim: false,
};

async function publicationAttestation(
  bundle: ModelPublicationBundle,
  responseText = customerText,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 'kfc-response-publication-attestation-v1',
    projectionDigest: bundle.projectionDigest,
    responseDigest: await stateRevision(responseText),
    semanticRelevance: 'aligned',
    privateDataDisclosure: 'none',
    disclosureAuthorities: [],
    disclosesInternalMetadata: false,
    ...overrides,
  };
}

function groundedResponse(
  bundle: ModelPublicationBundle,
  overrides: Record<string, unknown> = {},
) {
  return {
    customerText,
    projectionDigest: bundle.projectionDigest,
    factualClaims: claims,
    ...overrides,
  };
}

async function runtime(
  state: AgentGraphState,
): Promise<{
  runtime: SingleAgentRuntimeContext;
  dispose: () => void;
}> {
  const scope = createAgentTurnExternalCallScope(10_000);
  const turnTrace = await createNoopAgentTracer().startTurn({
    name: 'response_publication_boundary_test',
    inputs: {},
  });
  return {
    runtime: {
      turnInput: {
        sessionId: state.sessionId,
        customerId: state.customerId,
        channel: state.channel,
        text: state.latestUserMessage,
        externalMessageId: 'publication-grounding-message',
        clients: createMockClients(createTestFixtures()),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
      },
      turnTrace,
      externalCallContext: scope.context,
      abortExternalCalls: scope.abort,
      disposeExternalCalls: scope.dispose,
      state,
    },
    dispose: scope.dispose,
  };
}

function verificationState(
  state: AgentGraphState,
): ResponseVerificationState {
  return {
    approvalDecision: null,
    currentTurnToolTrace: [],
    domainState: state,
    providerAttempts: 0,
    providerAttemptEvidence: [],
    responseFactualClaims: claims,
    responseText: customerText,
    responseVerificationCalls: 0,
    selectedActionResponseAuthority: null,
    selectedActionResponseReference: null,
    structuredAction: null,
    structuredActionOutcome: null,
    turnDeadlineAt: Date.now() + 10_000,
    validatedApprovalActionDigest: null,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('response publication boundary', () => {
  it('revalidates exact access, evidence, and projection at the commit boundary', async () => {
    const setup = async () => {
      const state = publicationState();
      const currentUserTurn = state.recentTurns?.at(-1);
      if (!currentUserTurn) throw new Error('current user turn missing');
      const accessContext = controlledCustomerAccess({
        sessionId: state.sessionId,
        customerId: state.customerId,
        channel: state.channel,
      });
      const authority = await issueModelPublicationAuthority({
        state,
        currentUserTurn,
        accessContext,
      });
      const bundle = await buildModelPublicationBundle({
        state,
        authority,
      });
      const responsePublicationAttestation =
        responsePublicationAttestationSchema.parse(
          await publicationAttestation(bundle),
        );
      return {
        accessContext,
        authority,
        responsePublicationAttestation,
        state,
      };
    };
    const valid = await setup();
    const assertCurrent = await assertPublicationCommitAuthority({
      ...valid,
      currentTurnEvidence: [],
      responseText: customerText,
    });
    expect(assertCurrent).toBeTypeOf('function');
    expect(() => assertCurrent()).not.toThrow();

    const revokedAfterAsyncValidation = await setup();
    const assertStillCurrent = await assertPublicationCommitAuthority({
      ...revokedAfterAsyncValidation,
      currentTurnEvidence: [],
      responseText: customerText,
    });
    revokedAfterAsyncValidation.accessContext.authorizedScopes.splice(0);
    expect(() => assertStillCurrent()).toThrow(
      'agent_model_publication_authority_invalid',
    );

    const scopeRevoked = await setup();
    scopeRevoked.accessContext.authorizedScopes.splice(0);
    await expect(assertPublicationCommitAuthority({
      ...scopeRevoked,
      currentTurnEvidence: [],
      responseText: customerText,
    })).rejects.toThrow(
      'agent_model_publication_authority_invalid',
    );

    const evidenceRevoked = await setup();
    if (
      evidenceRevoked.accessContext.authenticationEvidence.state !==
        'verified'
    ) {
      throw new Error('verified authentication evidence missing');
    }
    evidenceRevoked.accessContext.authenticationEvidence.evidenceRef =
      'revoked-authentication-evidence';
    await expect(assertPublicationCommitAuthority({
      ...evidenceRevoked,
      currentTurnEvidence: [],
      responseText: customerText,
    })).rejects.toThrow(
      'agent_model_publication_authority_invalid',
    );

    const projectionChanged = await setup();
    if (!projectionChanged.state.cart) throw new Error('cart missing');
    projectionChanged.state.cart.totalVnd += 1;
    await expect(assertPublicationCommitAuthority({
      ...projectionChanged,
      currentTurnEvidence: [],
      responseText: customerText,
    })).rejects.toThrow(
      'agent_model_publication_authority_invalid',
    );
  });

  it('does not invoke the model after async message construction loses run ownership', async () => {
    const state = publicationState();
    const activeRuntime = await runtime(state);
    const entered = deferred<void>();
    const release = deferred<BaseMessage[]>();
    let current = true;
    activeRuntime.runtime.turnInput.runGuard = {
      isCurrent: async () => current,
    };
    const model = fakeModel().respond(new AIMessage('must not run'));
    const invocation = invokeAgentModel({
      model: model.bindTools([]),
      messages: async () => {
        entered.resolve();
        return release.promise;
      },
      observation: { kind: 'planning' },
      runtime: activeRuntime.runtime,
      state: {
        providerAttempts: 0,
        providerAttemptEvidence: [],
        turnDeadlineAt: Date.now() + 10_000,
      },
    });
    await entered.promise;
    current = false;
    release.resolve([]);

    try {
      await expect(invocation).resolves.toEqual({
        failure: 'customer_run_cancelled',
      });
      expect(model.callCount).toBe(0);
    } finally {
      activeRuntime.dispose();
    }
  });

  it('accepts author output only for the exact issued bundle and digest', async () => {
    const bundle = await publicationBundle();

    expect(validateGroundedResponse({
      raw: groundedResponse(bundle),
      bundle,
    })).toEqual({
      ok: true,
      customerText,
      projectionDigest: bundle.projectionDigest,
      factualClaims: claims,
    });

    expect(validateGroundedResponse({
      raw: groundedResponse(bundle, {
        projectionDigest: 'a'.repeat(64),
      }),
      bundle,
    })).toEqual({
      ok: false,
      errorCode: 'agent_model_publication_reference_invalid',
    });

    expect(validateGroundedResponse({
      raw: groundedResponse(bundle),
      bundle: { ...bundle },
    })).toEqual({
      ok: false,
      errorCode: 'agent_model_publication_reference_invalid',
    });
  });

  it('validates factual references only against bundle evidence', async () => {
    const bundle = await publicationBundle();

    expect(validateGroundedResponse({
      raw: groundedResponse(bundle, {
        factualClaims: {
          evidenceReferences: [{
            evidenceId: 'customer_context',
            claimKinds: ['product'],
          }],
          hasUnsupportedFactualClaim: false,
        },
      }),
      bundle,
    })).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_mismatch',
    });

    expect(validateGroundedResponse({
      raw: groundedResponse(bundle, {
        factualClaims: {
          evidenceReferences: [{
            evidenceId: 'cart',
            claimKinds: ['order_id'],
          }],
          hasUnsupportedFactualClaim: false,
        },
      }),
      bundle,
    })).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_mismatch',
    });
  });

  it('validates the verifier publication attestation before acceptance', async () => {
    const bundle = await publicationBundle();
    const output = {
      ...claims,
      publicationAttestation:
        await publicationAttestation(bundle),
    };

    await expect(validateResponseClaimVerification({
      raw: output,
      bundle,
      customerText,
    })).resolves.toEqual({
      ok: true,
      verification: {
        factualClaims: claims,
        publicationAttestation: output.publicationAttestation,
      },
    });

    await expect(validateResponseClaimVerification({
      raw: {
        ...output,
        publicationAttestation: await publicationAttestation(
          bundle,
          customerText,
          { projectionDigest: 'b'.repeat(64) },
        ),
      },
      bundle,
      customerText,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });

    await expect(validateResponseClaimVerification({
      raw: output,
      bundle,
      customerText: 'A replayed response.',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('passes one exact bundle to the independent verifier and returns its attestation', async () => {
    const state = publicationState();
    const bundle = await publicationBundle(state);
    const output = {
      ...claims,
      publicationAttestation:
        await publicationAttestation(bundle),
    };
    const verify = vi.fn<ResponseClaimVerifier['verify']>(
      async () => output,
    );
    const verifier: ResponseClaimVerifier = { verify };
    const activeRuntime = await runtime(state);
    try {
      await expect(verifyResponse({
        maximumProviderCalls: 2,
        responseClaimVerifier: verifier,
        publicationBundle: bundle,
        runtime: activeRuntime.runtime,
        state: verificationState(state),
      })).resolves.toEqual({
        providerAttempts: 1,
        providerAttemptEvidence: [{
          attempt: 1,
          outcome: 'success',
          purpose: 'response_verification',
        }],
        responseVerificationCalls: 1,
        responseVerificationLatencyMs: expect.any(Number),
        responsePublicationAttestation:
          output.publicationAttestation,
        responseVerified: true,
      });
    } finally {
      activeRuntime.dispose();
    }

    expect(verify).toHaveBeenCalledOnce();
    const verifierInput = verify.mock.calls[0]?.[0];
    expect(verifierInput?.publicationBundle).toBe(bundle);
    expect(verifierInput?.currentUserMessage).toBe(currentUserMessage);
  });

  it('rejects a verifier result when its exact publication changes in flight', async () => {
    const state = publicationState();
    const originalBundle = await publicationBundle(state);
    let activeBundle = originalBundle;
    const output = {
      ...claims,
      publicationAttestation:
        await publicationAttestation(originalBundle),
    };
    const entered = deferred<void>();
    const release = deferred<typeof output>();
    const verify = vi.fn<ResponseClaimVerifier['verify']>(async () => {
      entered.resolve();
      return release.promise;
    });
    const activeRuntime = await runtime(state);
    const verification = verifyResponse({
      maximumProviderCalls: 2,
      responseClaimVerifier: { verify },
      publicationBundle: async () => activeBundle,
      runtime: activeRuntime.runtime,
      state: verificationState(state),
    });
    await entered.promise;
    const changedState = structuredClone(state);
    if (!changedState.cart) throw new Error('test_cart_missing');
    changedState.cart.totalVnd += 1;
    activeBundle = await publicationBundle(changedState);
    release.resolve(output);

    try {
      await expect(verification).resolves.toEqual({
        failure: 'agent_model_publication_authority_invalid',
      });
    } finally {
      activeRuntime.dispose();
    }
    expect(verify).toHaveBeenCalledOnce();
  });

  it('shares the six-attempt ceiling across verifier and retry boundaries', async () => {
    const state = publicationState();
    const bundle = await publicationBundle(state);
    const output = {
      ...claims,
      publicationAttestation:
        await publicationAttestation(bundle),
    };
    const verify = vi.fn<ResponseClaimVerifier['verify']>(
      async () => output,
    );
    const activeRuntime = await runtime(state);
    try {
      await expect(verifyResponse({
        maximumProviderCalls: 6,
        responseClaimVerifier: { verify },
        publicationBundle: bundle,
        runtime: activeRuntime.runtime,
        state: {
          ...verificationState(state),
          providerAttempts: 5,
        },
      })).resolves.toMatchObject({
        providerAttempts: 6,
        responseVerificationCalls: 1,
        responseVerified: true,
      });
      for (const providerAttempts of [6, 7]) {
        await expect(verifyResponse({
          maximumProviderCalls: 6,
          responseClaimVerifier: { verify },
          publicationBundle: bundle,
          runtime: activeRuntime.runtime,
          state: {
            ...verificationState(state),
            providerAttempts,
          },
        })).resolves.toEqual({
          failure: 'agent_provider_call_limit_exceeded',
        });
      }
    } finally {
      activeRuntime.dispose();
    }
    expect(verify).toHaveBeenCalledOnce();

    expect(providerRetryUpdate({
      providerFailure: {
        errorClass: 'server_error',
        retryable: true,
      },
      providerRetries: 0,
      providerAttempts: 5,
      turnDeadlineAt: Date.now() + 10_000,
    })).toEqual({
      providerRetries: 1,
      providerFailure: null,
    });
    for (const providerAttempts of [6, 7]) {
      expect(providerRetryUpdate({
        providerFailure: {
          errorClass: 'server_error',
          retryable: true,
        },
        providerRetries: 0,
        providerAttempts,
        turnDeadlineAt: Date.now() + 10_000,
      })).toEqual({
        failure: 'agent_provider_call_failed:server_error',
      });
    }
  });

  it('does not call the verifier when the current message is not bundle-bound', async () => {
    const issuedState = publicationState();
    const bundle = await publicationBundle(issuedState);
    const changedState = {
      ...issuedState,
      latestUserMessage: 'A changed current message',
    };
    const verify = vi.fn<ResponseClaimVerifier['verify']>();
    const activeRuntime = await runtime(changedState);
    try {
      await expect(verifyResponse({
        maximumProviderCalls: 2,
        responseClaimVerifier: { verify },
        publicationBundle: bundle,
        runtime: activeRuntime.runtime,
        state: verificationState(changedState),
      })).resolves.toEqual({
        failure: 'agent_response_grounding_rejected',
      });
    } finally {
      activeRuntime.dispose();
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps the selected-action boundary behind the same publication reference', async () => {
    const state = publicationState();
    const bundle = await publicationBundle(state);

    expect(validateSelectedActionGroundedResponse({
      raw: groundedResponse(bundle),
      publicationBundle: bundle,
      state,
      envelope: null,
      outcome: null,
      authority: null,
      currentTurnToolTrace: [],
      approvalDecision: null,
      validatedApprovalActionDigest: null,
    })).toEqual({
      ok: true,
      customerText,
      projectionDigest: bundle.projectionDigest,
      factualClaims: claims,
    });
  });

  it('binds the model verifier input to the issued current message', async () => {
    const bundle = await publicationBundle();
    const model = fakeModel().structuredResponse({
      ...claims,
      publicationAttestation:
        await publicationAttestation(bundle),
    });
    const verifier = createModelResponseClaimVerifier(model);

    await expect(verifier.verify({
      customerText,
      currentUserMessage: 'A different current message',
      publicationBundle: bundle,
    }, {})).rejects.toThrow('agent_model_publication_context_invalid');
  });
});
