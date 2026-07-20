import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
  type ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import {
  validateGroundedResponse,
  type ResponseFactualClaims,
} from '../../src/agent/responseGrounding.js';
import {
  invokeAgentModel,
  providerRetryUpdate,
} from '../../src/agent/agentModelInvocation.js';
import {
  buildSelectedActionGraphAuthorities,
  validateSelectedActionGroundedResponse,
} from '../../src/agent/selectedActionResponseBoundary.js';
import {
  createTrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import {
  kfcGenUiVerifiedStateRevision,
} from '../../src/genui/kfcGenUi.js';
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
  modelPublicationContext,
} from '../../src/agent/agentPublicationRuntime.js';
import {
  issueResponsePublicationAttestation,
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

async function privatePublicationBundle(): Promise<ModelPublicationBundle> {
  const state = publicationState();
  state.address = {
    label: 'Home',
    line1: '1 Private Street',
    district: 'District 7',
    city: 'Ho Chi Minh City',
  };
  state.addressDraft = {
    label: 'Home',
    line1: '1 Private Street',
    district: 'District 7',
    city: 'Ho Chi Minh City',
  };
  const currentUserTurn = state.recentTurns?.at(-1);
  if (!currentUserTurn) throw new Error('current user turn missing');
  const authority = await issueModelPublicationAuthority({
    state,
    currentUserTurn,
    accessContext: controlledCustomerAccess({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
    }),
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
    publicationDeclaration: {
      semanticRelevance: 'aligned',
      privateDataDisclosure: 'none',
      disclosureAuthorities: [],
      disclosesInternalMetadata: false,
    },
    selectedActionResponse: null,
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

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function selectedActionBoundaryFixture() {
  const state = publicationState();
  const bundle = await publicationBundle(state);
  const envelope = createTrustedCustomerActionEnvelope({
    source: 'kfc_genui_action',
    assistantTurnId: 'selected-action-negative-turn',
    attachmentId: 'selected-action-negative-attachment',
    actionDigest: 'd'.repeat(64),
    verifiedRevision: kfcGenUiVerifiedStateRevision(state),
    lifecycle: 'one_shot',
    command: { kind: 'edit_cart' },
  });
  const selectedAction = buildSelectedActionGraphAuthorities({
    envelope,
    outcome: 'presentation_ready',
    state,
    currentTurnToolTrace: [],
    approvalDecision: null,
    validatedApprovalActionDigest: null,
  });
  if (!selectedAction.ok) throw new Error(selectedAction.errorCode);
  return { state, bundle, envelope, selectedAction };
}

describe('response publication boundary', () => {
  it('publishes the exact private-evidence declaration contract to the model', async () => {
    const bundle = await privatePublicationBundle();
    const privateEvidenceIds = bundle.evidence
      .filter(({ privateData }) => privateData)
      .map(({ evidenceId }) => evidenceId);
    expect(privateEvidenceIds.length).toBeGreaterThan(0);

    const context = z.object({
      publication: z.object({
        evidence: z.array(z.object({
          evidenceId: z.string(),
          privateData: z.boolean(),
        }).passthrough()),
      }).passthrough(),
      responseContract: z.object({
        requiredShape: z.object({
          publicationDeclaration: z.unknown(),
        }).passthrough(),
      }).passthrough(),
    }).passthrough().parse(
      JSON.parse(modelPublicationContext(bundle, null)),
    );

    expect(context.publication.evidence
      .filter(({ privateData }) => privateData)
      .map(({ evidenceId }) => evidenceId))
      .toEqual(privateEvidenceIds);
    expect(
      context.responseContract.requiredShape.publicationDeclaration,
    ).toEqual({
      semanticRelevance: '"aligned" only for a relevant response',
      privateDataDisclosure:
        'Set to "authorized" when cited publication evidence has privateData true or customerText discloses private data explicitly supplied in the current user message; otherwise set to "none", or "unauthorized" when private disclosure lacks exact authority.',
      disclosureAuthorities: [
        'For every cited publication evidence entry with privateData true, include exactly one { kind: "publication_evidence", evidenceId: "<same cited evidenceId>" } authority.',
        'Do not add publication_evidence authorities for uncited or non-private evidence, and do not duplicate authorities.',
        'Use { kind: "current_user_message", messageDigest: publication.lifecycle.currentUserMessageDigest } only for private data explicitly supplied in the current user message; it never authorizes facts learned from publication evidence.',
        'When no cited publication evidence entry has privateData true, include no publication_evidence authority.',
      ],
      disclosesInternalMetadata: 'boolean',
    });
  });
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
      publicationDeclaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
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

  it('rejects an otherwise-valid grounded response that omits selectedActionResponse', async () => {
    const bundle = await publicationBundle();
    const missingSelectedAction: Record<string, unknown> = {
      ...groundedResponse(bundle),
    };
    delete missingSelectedAction.selectedActionResponse;

    expect(validateGroundedResponse({
      raw: missingSelectedAction,
      bundle,
    })).toEqual({
      ok: false,
      errorCode: 'agent_grounded_response_invalid',
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






  it('binds the author model publication declaration to trusted response digests', async () => {
    const bundle = await publicationBundle();

    await expect(issueResponsePublicationAttestation({
      raw: groundedResponse(bundle).publicationDeclaration,
      bundle,
      customerText,
      factualClaims: claims,
    })).resolves.toEqual({
      ok: true,
      responsePublicationSafe: true,
      attestation: {
        schemaVersion: 'kfc-response-publication-attestation-v1',
        projectionDigest: bundle.projectionDigest,
        responseDigest: await stateRevision(customerText),
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
    });
  });

  it.each([
    {
      name: 'semantic misalignment',
      declaration: {
        semanticRelevance: 'misaligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
    },
    {
      name: 'unauthorized private disclosure',
      declaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'unauthorized',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
    },
    {
      name: 'internal metadata disclosure',
      declaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: true,
      },
    },
  ])('fails closed for author-declared $name', async ({
    declaration,
  }) => {
    const bundle = await publicationBundle();

    await expect(issueResponsePublicationAttestation({
      raw: declaration,
      bundle,
      customerText,
      factualClaims: claims,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('requires private disclosure authority to bind the current message exactly', async () => {
    const bundle = await publicationBundle();
    const declaration = {
      semanticRelevance: 'aligned' as const,
      privateDataDisclosure: 'authorized' as const,
      disclosureAuthorities: [{
        kind: 'current_user_message' as const,
        messageDigest: bundle.lifecycle.currentUserMessageDigest,
      }],
      disclosesInternalMetadata: false,
    };

    await expect(issueResponsePublicationAttestation({
      raw: declaration,
      bundle,
      customerText,
      factualClaims: claims,
    })).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
    await expect(issueResponsePublicationAttestation({
      raw: {
        ...declaration,
        disclosureAuthorities: [{
          kind: 'current_user_message',
          messageDigest: 'f'.repeat(64),
        }],
      },
      bundle,
      customerText,
      factualClaims: claims,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it.each([
    {
      name: 'private evidence declared as no disclosure',
      declaration: {
        semanticRelevance: 'aligned' as const,
        privateDataDisclosure: 'none' as const,
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
    },
    {
      name: 'private evidence missing its exact authority',
      declaration: {
        semanticRelevance: 'aligned' as const,
        privateDataDisclosure: 'authorized' as const,
        disclosureAuthorities: [{
          kind: 'current_user_message' as const,
          messageDigest: '0'.repeat(64),
        }],
        disclosesInternalMetadata: false,
      },
    },
    {
      name: 'extra unused private publication evidence authority',
      declaration: {
        semanticRelevance: 'aligned' as const,
        privateDataDisclosure: 'authorized' as const,
        disclosureAuthorities: [
          {
            kind: 'publication_evidence' as const,
            evidenceId: 'address',
          },
          {
            kind: 'publication_evidence' as const,
            evidenceId: 'address_draft',
          },
        ],
        disclosesInternalMetadata: false,
      },
    },
  ])('rejects $name', async ({ declaration }) => {
    const bundle = await privatePublicationBundle();
    const boundDeclaration = declaration.privateDataDisclosure ===
        'authorized' &&
        declaration.disclosureAuthorities[0]?.kind ===
          'current_user_message'
      ? {
          ...declaration,
          disclosureAuthorities: [{
            kind: 'current_user_message' as const,
            messageDigest:
              bundle.lifecycle.currentUserMessageDigest,
          }],
        }
      : declaration;
    const privateClaims: ResponseFactualClaims = {
      evidenceReferences: [{
        evidenceId: 'address_draft',
        claimKinds: ['address'],
      }],
      hasUnsupportedFactualClaim: false,
    };

    await expect(issueResponsePublicationAttestation({
      raw: boundDeclaration,
      bundle,
      customerText,
      factualClaims: privateClaims,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('accepts only the exact cited private publication evidence authority', async () => {
    const bundle = await privatePublicationBundle();
    await expect(issueResponsePublicationAttestation({
      raw: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'authorized',
        disclosureAuthorities: [{
          kind: 'publication_evidence',
          evidenceId: 'address_draft',
        }],
        disclosesInternalMetadata: false,
      },
      bundle,
      customerText,
      factualClaims: {
        evidenceReferences: [{
          evidenceId: 'address_draft',
          claimKinds: ['address'],
        }],
        hasUnsupportedFactualClaim: false,
      },
    })).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
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
      publicationDeclaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosureAuthorities: [],
        disclosesInternalMetadata: false,
      },
    });
  });

  it('rejects a well-typed selected action without trusted envelope authority', async () => {
    const {
      state,
      bundle,
      selectedAction,
    } = await selectedActionBoundaryFixture();

    expect(validateSelectedActionGroundedResponse({
      raw: groundedResponse(bundle, {
        selectedActionResponse: selectedAction.reference,
      }),
      publicationBundle: bundle,
      state,
      envelope: null,
      outcome: null,
      authority: null,
      currentTurnToolTrace: [],
      approvalDecision: null,
      validatedApprovalActionDigest: null,
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_authority_missing',
    });
  });

  it('requires the typed selected action when trusted authority is present', async () => {
    const {
      state,
      bundle,
      envelope,
      selectedAction,
    } = await selectedActionBoundaryFixture();

    expect(validateSelectedActionGroundedResponse({
      raw: groundedResponse(bundle),
      publicationBundle: bundle,
      state,
      envelope,
      outcome: 'presentation_ready',
      authority: selectedAction.authority,
      currentTurnToolTrace: [],
      approvalDecision: null,
      validatedApprovalActionDigest: null,
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_reference_required',
    });
  });

  it('revalidates selected-action state after the publication declaration is issued and before commit', async () => {
    const state = publicationState();
    const currentUserTurn = state.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const authority = await issueModelPublicationAuthority({
      state,
      currentUserTurn,
    });
    const bundle = await buildModelPublicationBundle({
      state,
      authority,
    });
    const envelope = createTrustedCustomerActionEnvelope({
      source: 'kfc_genui_action',
      assistantTurnId: 'selected-action-publication-turn',
      attachmentId: 'selected-action-publication-attachment',
      actionDigest: 'c'.repeat(64),
      verifiedRevision: kfcGenUiVerifiedStateRevision(state),
      lifecycle: 'one_shot',
      command: { kind: 'edit_cart' },
    });
    const selectedAction = buildSelectedActionGraphAuthorities({
      envelope,
      outcome: 'presentation_ready',
      state,
      currentTurnToolTrace: [],
      approvalDecision: null,
      validatedApprovalActionDigest: null,
    });
    if (!selectedAction.ok) {
      throw new Error(selectedAction.errorCode);
    }
    const raw = groundedResponse(bundle, {
      selectedActionResponse: selectedAction.reference,
    });
    expect(validateSelectedActionGroundedResponse({
      raw,
      publicationBundle: bundle,
      state,
      envelope,
      outcome: 'presentation_ready',
      authority: selectedAction.authority,
      currentTurnToolTrace: [],
      approvalDecision: null,
      validatedApprovalActionDigest: null,
    })).toMatchObject({ ok: true });
    const issued = await issueResponsePublicationAttestation({
      raw: raw.publicationDeclaration,
      bundle,
      customerText,
      factualClaims: raw.factualClaims,
    });
    if (!issued.ok) throw new Error(issued.errorCode);
    const assertCurrent = await assertPublicationCommitAuthority({
      state,
      authority,
      currentTurnEvidence: [],
      accessContext: undefined,
      responseText: customerText,
      responsePublicationAttestation: issued.attestation,
    });

    if (!state.cart) throw new Error('cart missing');
    state.cart.totalVnd += 1;

    expect(() => assertCurrent()).toThrow(
      'agent_model_publication_authority_invalid',
    );
  });

});
