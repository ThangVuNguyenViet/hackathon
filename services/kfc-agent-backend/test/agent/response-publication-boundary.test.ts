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
import { createTrustedCustomerActionEnvelope } from '../../src/domain/customerCommand.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
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
import { assertPublicationCommitAuthority } from '../../src/agent/agentPublicationCommitAuthority.js';
import {
  modelPublicationContext,
  modelPublicationContextWithDiagnostics,
} from '../../src/agent/agentPublicationRuntime.js';
import {
  issueResponsePublicationAttestation,
  responsePublicationAttestationSchema,
  validateResponsePublicationDeclarationConsistency,
} from '../../src/agent/responsePrivacyAttestation.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

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
      items: [
        {
          itemCode: 'item-current',
          name: 'Current item',
          quantity: 1,
          unitPriceVnd: 50_000,
        },
      ],
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

async function boundedCatalogPublicationBundle(): Promise<ModelPublicationBundle> {
  const state = publicationState();
  const item = new OrderingDataService(createTestFixtures()).getMenuItem(
    '20751',
  );
  if (!item) throw new Error('menu fixture missing');
  const collectionKey = 'menu:filtered';
  state.activeCollectionKeys = { searchMenu: collectionKey };
  state.verifiedCollections = {
    searchMenu: {
      [collectionKey]: {
        key: collectionKey,
        revision: 'catalog-revision',
        providerRevision: 'catalog-provider-revision',
        result: {
          items: [item],
          total: 1,
          returned: 1,
          complete: true,
          scope: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
        },
      },
    },
  };
  return publicationBundle(state);
}

async function compositeCatalogPublicationBundle(): Promise<ModelPublicationBundle> {
  const state = publicationState();
  const fixtures = await loadGeneratedFixtures(process.cwd());
  const item = new OrderingDataService(fixtures, {
    currentDate: '2026-07-13',
  }).getMenuItem('20709');
  if (!item) throw new Error('composite menu fixture missing');
  const collectionKey = 'menu:20709';
  state.activeCollectionKeys = { searchMenu: collectionKey };
  state.verifiedCollections = {
    searchMenu: {
      [collectionKey]: {
        key: collectionKey,
        revision: 'composite-catalog-revision',
        providerRevision: 'composite-catalog-provider-revision',
        result: {
          items: [item],
          total: 1,
          returned: 1,
          complete: true,
          scope: { scope: 'filtered', query: '20709' },
        },
      },
    },
  };
  return publicationBundle(state);
}

async function freshFullMenuPublication() {
  const state = publicationState();
  const fixtures = await loadGeneratedFixtures(process.cwd());
  const items = new OrderingDataService(fixtures, {
    currentDate: '2026-07-13',
  }).searchMenu('');
  const exemplar = items[0];
  if (!exemplar) throw new Error('full-menu fixture missing');
  const collectionKey = 'menu:all:fresh';
  const collection = {
    key: collectionKey,
    revision: 'fresh-catalog-revision',
    providerRevision: 'fresh-provider-revision',
    result: {
      items,
      total: items.length,
      returned: items.length,
      complete: true,
      scope: { scope: 'all' as const },
    },
  };
  state.menuSearchResults = items;
  state.activeMenuCollection = collection;
  state.activeCollectionKeys = { searchMenu: collectionKey };
  state.verifiedCollections = {
    searchMenu: { [collectionKey]: collection },
  };
  return {
    state,
    exemplar,
    bundle: await publicationBundle(state),
  };
}

const claims: ResponseFactualClaims = {
  evidenceReferences: [
    {
      evidenceId: 'cart',
      claimKinds: ['product', 'price'],
    },
  ],
  disclosedLimitations: [],
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

async function runtime(state: AgentGraphState): Promise<{
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
  it('keeps a fresh full-menu model context under 16 KiB without catalog item payload', async () => {
    const { state, exemplar, bundle } = await freshFullMenuPublication();
    const serialized = modelPublicationContext(bundle, null);
    const context = JSON.parse(serialized) as {
      publication: {
        modelState: {
          activeCollections?: {
            searchMenu?: Record<string, unknown>;
          };
        };
        evidence: Array<{ value: unknown }>;
      };
    };

    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(
      context.publication.modelState.activeCollections?.searchMenu,
    ).not.toHaveProperty('items');
    expect(JSON.stringify(context.publication.evidence)).not.toContain(
      '"items"',
    );
    expect(serialized).not.toContain('"code"');
    expect(serialized).not.toContain('"description"');
    expect(serialized).not.toContain('"imageUrl"');
    expect(serialized).not.toContain(exemplar.code);
    expect(serialized).not.toContain(exemplar.description);
    expect(serialized).not.toContain(exemplar.imageUrl);
    const fullMenu = state.activeMenuCollection;
    if (!fullMenu) throw new Error('full-menu graph state missing');
    expect(fullMenu.result.items).toHaveLength(fullMenu.result.total);
  });

  it('materializes repeated publication values once in a prompt-only value table', () => {
    const sentinel = `unique-menu-payload-${'x'.repeat(512)}`;
    const items = [{ code: 'item-1', name: sentinel }];
    const collection = {
      items,
      total: 1,
      returned: 1,
      complete: true,
      scope: { scope: 'all' },
    };
    const bundle = {
      schemaVersion: 'kfc-model-publication-v1',
      modelState: {
        activeCollections: { searchMenu: collection },
        menuSearchResults: items,
      },
      evidence: [
        {
          evidenceId: 'active_collection:searchMenu',
          claimKinds: ['menu'],
          requiredLimitations: [],
          value: collection,
          officialSource: false,
          publicationAuthority: 'verified_state',
          privateData: false,
        },
        {
          evidenceId: 'menu_search_results',
          claimKinds: ['menu'],
          requiredLimitations: [],
          value: items,
          officialSource: false,
          publicationAuthority: 'verified_state',
          privateData: false,
        },
        {
          evidenceId: `current:searchMenu:${'a'.repeat(64)}`,
          claimKinds: ['menu'],
          requiredLimitations: [],
          value: collection,
          officialSource: false,
          publicationAuthority: 'current_turn_execution',
          privateData: false,
        },
      ],
      allowedEvidenceIds: [
        'active_collection:searchMenu',
        'menu_search_results',
        `current:searchMenu:${'a'.repeat(64)}`,
      ],
      projectionDigest: 'b'.repeat(64),
      lifecycle: {
        currentUserMessageDigest: 'c'.repeat(64),
      },
    } as unknown as ModelPublicationBundle;
    const before = structuredClone(bundle);

    const projection = modelPublicationContextWithDiagnostics(bundle, null);
    const serialized = projection.serialized;
    const context = JSON.parse(serialized) as {
      publication: {
        valueTable: Record<string, unknown>;
        modelState: unknown;
        evidence: Array<{ value: unknown }>;
      };
    };

    expect(Object.keys(context.publication.valueTable).length).toBeGreaterThan(
      0,
    );
    expect(projection.diagnostics).toMatchObject({
      uniqueValueCount: expect.any(Number),
      referenceCount: expect.any(Number),
      originalPublicationBytes: expect.any(Number),
      compactPublicationBytes: expect.any(Number),
      bytesSaved: expect.any(Number),
    });
    expect(projection.diagnostics.referenceCount).toBeGreaterThan(0);
    expect(projection.diagnostics.bytesSaved).toBeGreaterThan(0);
    expect(serialized.split(sentinel)).toHaveLength(2);
    expect(JSON.stringify(bundle)).toBe(JSON.stringify(before));
    expect(bundle.modelState).toEqual(before.modelState);
    expect(bundle.evidence).toEqual(before.evidence);
    expect(bundle.projectionDigest).toBe(before.projectionDigest);
  });

  it('publishes the exact private-evidence declaration contract to the model', async () => {
    const bundle = await privatePublicationBundle();
    const privateEvidenceIds = bundle.evidence
      .filter(({ privateData }) => privateData)
      .map(({ evidenceId }) => evidenceId);
    expect(privateEvidenceIds.length).toBeGreaterThan(0);

    const context = z
      .object({
        publication: z
          .object({
            evidence: z.array(
              z
                .object({
                  evidenceId: z.string(),
                  privateData: z.boolean(),
                })
                .passthrough(),
            ),
            privateEvidenceIds: z.array(z.string()),
          })
          .passthrough(),
        responseContract: z
          .object({
            requiredShape: z
              .object({
                publicationDeclaration: z.unknown(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(JSON.parse(modelPublicationContext(bundle, null)));

    expect(
      context.publication.evidence
        .filter(({ privateData }) => privateData)
        .map(({ evidenceId }) => evidenceId),
    ).toEqual(privateEvidenceIds);
    expect(context.publication.privateEvidenceIds).toEqual(
      [...new Set(privateEvidenceIds)].sort(),
    );
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

  it('publishes customerText as the direct assistant answer contract', async () => {
    const bundle = await privatePublicationBundle();
    const context = z
      .object({
        responseContract: z
          .object({
            requiredShape: z
              .object({
                customerText: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(JSON.parse(modelPublicationContext(bundle, null)));

    expect(context.responseContract.requiredShape.customerText).toBe(
      'Directly answer the latest customer request as the assistant using relevant verified publication evidence. Write only customer-useful prose in the customer language. Never expose schema field names, enum values, evidence identifiers, source labels, validation bookkeeping, tool terminology, or graph state terminology. Render uncertainty naturally without copying internal labels. If the customer asks for advice without an action, comply silently instead of repeating that no cart or order change occurred. Do not copy, concatenate, or merely restate customer messages or the conversation transcript.',
    );
  });

  it('publishes the factual evidence citation contract', async () => {
    const bundle = await privatePublicationBundle();
    const context = z
      .object({
        responseContract: z.object({
          requiredShape: z.object({
            factualClaims: z.object({
              evidenceReferences: z.string(),
            }),
          }),
        }),
      })
      .passthrough()
      .parse(JSON.parse(modelPublicationContext(bundle, null)));

    expect(
      context.responseContract.requiredShape.factualClaims.evidenceReferences,
    ).toBe(
      'For every factual claim in customerText, cite matching allowed current publication evidence. A factual answer about products, prices, composition, modifiers, availability, policies, orders, payments, membership, or tool outcomes requires at least one matching evidence reference. If required evidence is absent, call relevant read tools before returning this response; customer and prior assistant messages are not evidence.',
    );
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
    await expect(
      assertPublicationCommitAuthority({
        ...scopeRevoked,
        currentTurnEvidence: [],
        responseText: customerText,
      }),
    ).rejects.toThrow('agent_model_publication_authority_invalid');

    const evidenceRevoked = await setup();
    if (
      evidenceRevoked.accessContext.authenticationEvidence.state !== 'verified'
    ) {
      throw new Error('verified authentication evidence missing');
    }
    evidenceRevoked.accessContext.authenticationEvidence.evidenceRef =
      'revoked-authentication-evidence';
    await expect(
      assertPublicationCommitAuthority({
        ...evidenceRevoked,
        currentTurnEvidence: [],
        responseText: customerText,
      }),
    ).rejects.toThrow('agent_model_publication_authority_invalid');

    const projectionChanged = await setup();
    if (!projectionChanged.state.cart) throw new Error('cart missing');
    projectionChanged.state.cart.totalVnd += 1;
    await expect(
      assertPublicationCommitAuthority({
        ...projectionChanged,
        currentTurnEvidence: [],
        responseText: customerText,
      }),
    ).rejects.toThrow('agent_model_publication_authority_invalid');
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

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle),
        bundle,
      }),
    ).toEqual({
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

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          projectionDigest: 'a'.repeat(64),
        }),
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_model_publication_reference_invalid',
    });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle),
        bundle: { ...bundle },
      }),
    ).toEqual({
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

    expect(
      validateGroundedResponse({
        raw: missingSelectedAction,
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_grounded_response_invalid',
    });
  });

  it('validates factual references only against bundle evidence', async () => {
    const bundle = await publicationBundle();

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          factualClaims: {
            evidenceReferences: [
              {
                evidenceId: 'customer_context',
                claimKinds: ['product'],
              },
            ],
            disclosedLimitations: [],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_mismatch',
    });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          factualClaims: {
            evidenceReferences: [
              {
                evidenceId: 'cart',
                claimKinds: ['order_id'],
              },
            ],
            disclosedLimitations: [],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_mismatch',
    });
  });

  it('requires disclosure when cited evidence has bounded subject or aspect coverage', async () => {
    const bundle = await boundedCatalogPublicationBundle();
    const evidenceReference = {
      evidenceId: 'active_collection:searchMenu',
      claimKinds: ['modifier'],
    };

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    const disclosure = {
      limitationId: 'uncited_subjects_or_aspects_unknown',
      coverageStatus: 'unknown_or_unverified',
      evidenceSubject: 'Combo Hợp Gu 99K',
      customerCriterion: 'not spicy',
      unverifiedAspect: 'spice level',
      customerDisclosure:
        'Whether Combo Hợp Gu 99K is not spicy is unverified because its spice level is unknown.',
    };
    const genericDisclosure = {
      ...disclosure,
      evidenceSubject: 'uncited subjects or aspects',
      customerCriterion: 'unknown or unverified',
      unverifiedAspect: 'unknown or unverified',
      customerDisclosure:
        'Uncited subjects or aspects are unknown or unverified.',
    };
    const offQuestionDisclosure = {
      ...disclosure,
      customerCriterion: 'modifier options beyond defaults',
      unverifiedAspect: 'modifier options beyond defaults',
      customerDisclosure:
        'Combo Hợp Gu 99K modifier options beyond defaults are unverified.',
    };
    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: genericDisclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [genericDisclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: offQuestionDisclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [offQuestionDisclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'I want something not spicy.',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [disclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'I want something not spicy.',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: disclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [disclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'I want something not spicy.',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    const modifierDisclosure = {
      ...disclosure,
      evidenceSubject: 'Pepsi Không Calo',
      customerCriterion: 'caffeine-free',
      unverifiedAspect: 'caffeine content',
      customerDisclosure:
        'The available menu does not state the caffeine content of Pepsi Không Calo, so I cannot verify whether it is caffeine-free.',
    };
    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: modifierDisclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [modifierDisclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'I want a caffeine-free drink.',
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          factualClaims: {
            evidenceReferences: [
              {
                evidenceId: 'active_collection:searchMenu',
                claimKinds: ['price'],
              },
            ],
            disclosedLimitations: [],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle),
        bundle,
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects closed-world contract tokens in customer-facing responses', async () => {
    const bundle = await publicationBundle();
    const invalidCustomerTexts = [
      'Trạng thái hiện tại là unknown_or_unverified.',
      'The unverifiedAspect is spice level.',
      'I used evidenceSubject and customerCriterion to answer.',
      'The limitation is uncited_subjects_or_aspects_unknown.',
      'The subjectScope is included_modifier_option_name.',
    ];

    for (const invalidCustomerText of invalidCustomerTexts) {
      expect(
        validateGroundedResponse({
          raw: groundedResponse(bundle, {
            customerText: invalidCustomerText,
          }),
          bundle,
        }),
      ).toEqual({
        ok: false,
        errorCode: 'agent_response_customer_language_invalid',
      });
    }

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText:
            'Mình chưa có đủ thông tin để khẳng định phần này có cay hay không.',
        }),
        bundle,
      }),
    ).toMatchObject({ ok: true });

    const privateBundle = await privatePublicationBundle();
    const toolTrace: ToolTraceEntry[] = [
      {
        toolName: 'listPaymentMethods',
        arguments: {
          query: null,
          paymentSurface: 'web_app',
        },
        ok: true,
        resultSummary: 'payment methods',
        provenance: [],
      },
    ];
    for (const invalidCustomerText of [
      'Internal evidence address_draft was used.',
      'Authority kind publication_evidence was selected.',
      'The internal reference __kfcPublicationValue_v1 points to value-1.',
      'This applies to web_app.',
    ]) {
      expect(
        validateGroundedResponse({
          raw: groundedResponse(privateBundle, {
            customerText: invalidCustomerText,
          }),
          bundle: privateBundle,
          currentTurnToolTrace: toolTrace,
        }),
      ).toEqual({
        ok: false,
        errorCode: 'agent_response_customer_language_invalid',
      });
    }

    expect(
      validateGroundedResponse({
        raw: groundedResponse(privateBundle, {
          customerText:
            'Bạn vừa hỏi về web_app; mình cần làm rõ ý bạn trước khi tư vấn.',
        }),
        bundle: privateBundle,
        currentUserMessage: 'web_app là gì?',
        currentTurnToolTrace: toolTrace,
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects an optional criterion-matching modifier as the unresolved composite subject', async () => {
    const bundle = await compositeCatalogPublicationBundle();
    const evidenceReference = {
      evidenceId: 'active_collection:searchMenu',
      claimKinds: ['modifier'],
    };
    const invalidDisclosure = {
      limitationId: 'uncited_subjects_or_aspects_unknown',
      coverageStatus: 'unknown_or_unverified',
      evidenceSubject: 'Gà Giòn Không Cay',
      customerCriterion: 'không cay',
      unverifiedAspect: 'modifier option availability',
      customerDisclosure:
        'Mình chưa có thông tin rõ Gà Giòn Không Cay có cay hay không.',
    };

    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: invalidDisclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [invalidDisclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'Mình muốn ăn không cay thì nên chọn combo nào?',
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
    });

    const validDisclosure = {
      ...invalidDisclosure,
      evidenceSubject: '1 Miếng Gà Lắc Tiêu Chanh',
      unverifiedAspect: 'modifier option spice-level coverage',
      customerDisclosure:
        'Mình chưa có thông tin rõ 1 Miếng Gà Lắc Tiêu Chanh có cay hay không.',
    };
    expect(
      validateGroundedResponse({
        raw: groundedResponse(bundle, {
          customerText: validDisclosure.customerDisclosure,
          factualClaims: {
            evidenceReferences: [evidenceReference],
            disclosedLimitations: [validDisclosure],
            hasUnsupportedFactualClaim: false,
          },
        }),
        bundle,
        currentUserMessage: 'Mình muốn ăn không cay thì nên chọn combo nào?',
      }),
    ).toMatchObject({ ok: true });
  });

  it('binds the author model publication declaration to trusted response digests', async () => {
    const bundle = await publicationBundle();

    await expect(
      issueResponsePublicationAttestation({
        raw: groundedResponse(bundle).publicationDeclaration,
        bundle,
        customerText,
        factualClaims: claims,
      }),
    ).resolves.toEqual({
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
  ])('fails closed for author-declared $name', async ({ declaration }) => {
    const bundle = await publicationBundle();

    await expect(
      issueResponsePublicationAttestation({
        raw: declaration,
        bundle,
        customerText,
        factualClaims: claims,
      }),
    ).resolves.toEqual({
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
      disclosureAuthorities: [
        {
          kind: 'current_user_message' as const,
          messageDigest: bundle.lifecycle.currentUserMessageDigest,
        },
      ],
      disclosesInternalMetadata: false,
    };

    await expect(
      issueResponsePublicationAttestation({
        raw: declaration,
        bundle,
        customerText,
        factualClaims: claims,
      }),
    ).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
    await expect(
      issueResponsePublicationAttestation({
        raw: {
          ...declaration,
          disclosureAuthorities: [
            {
              kind: 'current_user_message',
              messageDigest: 'f'.repeat(64),
            },
          ],
        },
        bundle,
        customerText,
        factualClaims: claims,
      }),
    ).resolves.toEqual({
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
        disclosureAuthorities: [
          {
            kind: 'current_user_message' as const,
            messageDigest: '0'.repeat(64),
          },
        ],
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
    const boundDeclaration =
      declaration.privateDataDisclosure === 'authorized' &&
      declaration.disclosureAuthorities[0]?.kind === 'current_user_message'
        ? {
            ...declaration,
            disclosureAuthorities: [
              {
                kind: 'current_user_message' as const,
                messageDigest: bundle.lifecycle.currentUserMessageDigest,
              },
            ],
          }
        : declaration;
    const privateClaims: ResponseFactualClaims = {
      evidenceReferences: [
        {
          evidenceId: 'address_draft',
          claimKinds: ['address'],
        },
      ],
      disclosedLimitations: [],
      hasUnsupportedFactualClaim: false,
    };

    expect(
      validateResponsePublicationDeclarationConsistency({
        raw: boundDeclaration,
        bundle,
        factualClaims: privateClaims,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      correctable: true,
    });
    await expect(
      issueResponsePublicationAttestation({
        raw: boundDeclaration,
        bundle,
        customerText,
        factualClaims: privateClaims,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('classifies an issued public evidence authority as correctable over-declaration', async () => {
    const bundle = await publicationBundle();
    const publicEvidence = bundle.evidence.find(
      ({ privateData }) => !privateData,
    );
    if (!publicEvidence) throw new Error('public publication evidence missing');
    const publicClaims: ResponseFactualClaims = {
      evidenceReferences: [
        {
          evidenceId: publicEvidence.evidenceId,
          claimKinds: [...publicEvidence.claimKinds],
        },
      ],
      disclosedLimitations: [],
      hasUnsupportedFactualClaim: false,
    };
    const declaration = {
      semanticRelevance: 'aligned' as const,
      privateDataDisclosure: 'authorized' as const,
      disclosureAuthorities: [
        {
          kind: 'publication_evidence' as const,
          evidenceId: publicEvidence.evidenceId,
        },
      ],
      disclosesInternalMetadata: false,
    };

    expect(
      validateResponsePublicationDeclarationConsistency({
        raw: declaration,
        bundle,
        factualClaims: publicClaims,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      correctable: true,
    });
    await expect(
      issueResponsePublicationAttestation({
        raw: declaration,
        bundle,
        customerText,
        factualClaims: publicClaims,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('classifies duplicate issued private evidence authorities as correctable while final attestation stays strict', async () => {
    const bundle = await privatePublicationBundle();
    const privateClaims: ResponseFactualClaims = {
      evidenceReferences: [
        {
          evidenceId: 'address_draft',
          claimKinds: ['address'],
        },
      ],
      disclosedLimitations: [],
      hasUnsupportedFactualClaim: false,
    };
    const duplicateAuthority = {
      kind: 'publication_evidence' as const,
      evidenceId: 'address_draft',
    };
    const declaration = {
      semanticRelevance: 'aligned' as const,
      privateDataDisclosure: 'authorized' as const,
      disclosureAuthorities: [duplicateAuthority, duplicateAuthority],
      disclosesInternalMetadata: false,
    };

    expect(
      validateResponsePublicationDeclarationConsistency({
        raw: declaration,
        bundle,
        factualClaims: privateClaims,
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      correctable: true,
    });
    await expect(
      issueResponsePublicationAttestation({
        raw: declaration,
        bundle,
        customerText,
        factualClaims: privateClaims,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('keeps duplicate fabricated evidence authorities non-correctable', async () => {
    const bundle = await privatePublicationBundle();
    const fabricatedAuthority = {
      kind: 'publication_evidence' as const,
      evidenceId: 'fabricated-private-evidence',
    };

    expect(
      validateResponsePublicationDeclarationConsistency({
        raw: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'authorized',
          disclosureAuthorities: [fabricatedAuthority, fabricatedAuthority],
          disclosesInternalMetadata: false,
        },
        bundle,
        factualClaims: {
          evidenceReferences: [],
        },
      }),
    ).toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      correctable: false,
    });
  });

  it('accepts only the exact cited private publication evidence authority', async () => {
    const bundle = await privatePublicationBundle();
    await expect(
      issueResponsePublicationAttestation({
        raw: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'authorized',
          disclosureAuthorities: [
            {
              kind: 'publication_evidence',
              evidenceId: 'address_draft',
            },
          ],
          disclosesInternalMetadata: false,
        },
        bundle,
        customerText,
        factualClaims: {
          evidenceReferences: [
            {
              evidenceId: 'address_draft',
              claimKinds: ['address'],
            },
          ],
          disclosedLimitations: [],
          hasUnsupportedFactualClaim: false,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
  });

  it('keeps the selected-action boundary behind the same publication reference', async () => {
    const state = publicationState();
    const bundle = await publicationBundle(state);

    expect(
      validateSelectedActionGroundedResponse({
        raw: groundedResponse(bundle),
        publicationBundle: bundle,
        state,
        envelope: null,
        outcome: null,
        authority: null,
        currentTurnToolTrace: [],
        approvalDecision: null,
        validatedApprovalActionDigest: null,
      }),
    ).toEqual({
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
    const { state, bundle, selectedAction } =
      await selectedActionBoundaryFixture();

    expect(
      validateSelectedActionGroundedResponse({
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
      }),
    ).toEqual({
      ok: false,
      errorCode: 'selected_action_response_authority_missing',
    });
  });

  it('requires the typed selected action when trusted authority is present', async () => {
    const { state, bundle, envelope, selectedAction } =
      await selectedActionBoundaryFixture();

    expect(
      validateSelectedActionGroundedResponse({
        raw: groundedResponse(bundle),
        publicationBundle: bundle,
        state,
        envelope,
        outcome: 'presentation_ready',
        authority: selectedAction.authority,
        currentTurnToolTrace: [],
        approvalDecision: null,
        validatedApprovalActionDigest: null,
      }),
    ).toEqual({
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
    expect(
      validateSelectedActionGroundedResponse({
        raw,
        publicationBundle: bundle,
        state,
        envelope,
        outcome: 'presentation_ready',
        authority: selectedAction.authority,
        currentTurnToolTrace: [],
        approvalDecision: null,
        validatedApprovalActionDigest: null,
      }),
    ).toMatchObject({ ok: true });
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
