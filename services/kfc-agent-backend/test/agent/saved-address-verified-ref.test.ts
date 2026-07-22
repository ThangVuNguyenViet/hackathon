import { describe, expect, it } from 'vitest';
import {
  claimPendingSavedAddressQuote,
  claimSavedAddressQuote,
} from '../../src/agent/savedAddressVerifiedRef.js';
import { projectModelPublicationState } from '../../src/agent/modelPublicationStateProjection.js';
import {
  createTrustedCustomerActionEnvelope,
  type TrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import type { Address, Cart, Channel } from '../../src/domain/types.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { AuthenticatedCommerceApprovalPrincipal } from '../../src/ordering/types.js';
import {
  agentToolArgumentSchemas,
  parseAgentToolArguments,
} from '../../src/ordering/toolCatalog.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

const address: Address = {
  label: 'Private saved label Ω',
  line1: 'BIG C ĐỒNG NAI',
  district: 'Private provider district Δ',
  city: 'Đồng Nai',
};

interface SavedAddressRef {
  id: string;
  kind: 'saved_address';
}

function cart(): Cart {
  return {
    id: 'saved-ref-cart',
    items: [
      {
        itemCode: '20751',
        name: 'Verified item',
        quantity: 1,
        unitPriceVnd: 99_000,
      },
    ],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99_000,
    voucherCode: null,
  };
}

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'kfc:saved-ref-session',
    customerId: 'saved-ref-customer',
    channel: 'kfc',
    latestUserMessage: '',
    cart: cart(),
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function principal(
  authoritativeState: AgentGraphState,
  overrides: Partial<AuthenticatedCommerceApprovalPrincipal> = {},
): AuthenticatedCommerceApprovalPrincipal {
  return {
    principalKind: 'authenticated_customer',
    sessionId: authoritativeState.sessionId,
    customerId: authoritativeState.customerId,
    channel: authoritativeState.channel,
    authenticatedSubject: authoritativeState.customerId,
    authenticationEvidenceRef: `controlled-test:${authoritativeState.customerId}`,
    ...overrides,
  };
}

function savedAddressRunId(authoritativeState: AgentGraphState): string {
  return `saved-address-ref-run:${authoritativeState.sessionId}`;
}

async function issueSavedAddressRef(input: {
  store: MemoryStore;
  state: AgentGraphState;
  principal?: AuthenticatedCommerceApprovalPrincipal;
  createdAt?: string;
  expiresAt?: string;
}): Promise<SavedAddressRef> {
  const issued = await input.store.issueVerifiedRef({
    kind: 'saved_address',
    principal: input.principal ?? principal(input.state),
    verifiedRevision: kfcGenUiVerifiedStateRevision(input.state),
    payload: {
      schemaVersion: 'kfc-saved-address-ref-payload-v1',
      address: {
        label: address.label,
        line1: address.line1,
        district: address.district,
        city: address.city,
      },
    },
    lifecycle: 'one_shot',
    createdAt: input.createdAt ?? '2020-01-01T00:00:00.000Z',
    expiresAt: input.expiresAt ?? '2099-01-01T00:00:00.000Z',
  });
  if (issued.status !== 'created') throw new Error('test_ref_issue_failed');
  if (issued.record.ref.kind !== 'saved_address') {
    throw new Error('test_saved_ref_kind_invalid');
  }
  const runId = savedAddressRunId(input.state);
  await input.store.createCustomerRun({
    id: runId,
    schemaVersion: 1,
    sessionId: input.state.sessionId,
    customerId: input.state.customerId,
    clientMessageId: `${runId}:message`,
    requestFingerprint: `${runId}:fingerprint`,
    generation: 1,
    status: 'running',
    phase: 'read_only_tool',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  input.state.pendingSavedAddressRef = issued.record.ref;
  return {
    id: issued.record.ref.id,
    kind: issued.record.ref.kind,
  };
}

function envelope(input: {
  state: AgentGraphState;
  ref: SavedAddressRef;
  actionDigest?: string;
  verifiedRevision?: string;
}): TrustedCustomerActionEnvelope {
  return createTrustedCustomerActionEnvelope({
    source: 'kfc_genui_action',
    assistantTurnId: 'saved-address-assistant-turn',
    attachmentId: 'saved-address-attachment',
    actionDigest: input.actionDigest ?? 'a'.repeat(64),
    verifiedRevision:
      input.verifiedRevision ?? kfcGenUiVerifiedStateRevision(input.state),
    lifecycle: 'one_shot',
    command: {
      kind: 'accept_fulfillment',
      savedAddressRef: input.ref,
    },
  });
}

async function turnInput(input: {
  state: AgentGraphState;
  store: MemoryStore;
  sessionId?: string;
  customerId?: string;
  channel?: Channel;
  authenticatedSubject?: string;
  authenticationEvidenceRef?: string;
}): Promise<
  Pick<
    AgentTurnInput,
    | 'accessContext'
    | 'channel'
    | 'customerId'
    | 'runGuard'
    | 'sessionId'
    | 'store'
  >
> {
  const sessionId = input.sessionId ?? input.state.sessionId;
  const customerId = input.customerId ?? input.state.customerId;
  const channel = input.channel ?? input.state.channel;
  const accessContext = controlledCustomerAccess({
    sessionId,
    customerId,
    channel,
  });
  if (input.authenticatedSubject !== undefined) {
    accessContext.kfcSubjectRef = input.authenticatedSubject;
  }
  if (
    input.authenticationEvidenceRef !== undefined &&
    accessContext.authenticationEvidence.state === 'verified'
  ) {
    accessContext.authenticationEvidence.evidenceRef =
      input.authenticationEvidenceRef;
  }
  const persistedRun = await input.store.getCustomerRun(
    savedAddressRunId(input.state),
  );
  if (!persistedRun) throw new Error('test_customer_run_missing');
  return {
    sessionId,
    customerId,
    channel,
    accessContext,
    runGuard: {
      isCurrent: async () => true,
      commitFence: {
        kind: 'customer_run',
        runId: savedAddressRunId(input.state),
        sessionAuthorityGeneration: persistedRun.sessionAuthorityGeneration,
      },
    },
    store: input.store,
  };
}

describe('saved-address verified-ref boundary', () => {
  it('accepts exactly one strict model-authored fulfillment source', () => {
    const ref = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'saved_address',
    } as const;
    const rawAddress = {
      label: null,
      line1: '12 Nguyễn Văn Linh',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };

    expect(
      agentToolArgumentSchemas.quoteFulfillment.safeParse({
        address: rawAddress,
        savedAddressRef: null,
        method: 'delivery',
      }).success,
    ).toBe(true);
    expect(
      agentToolArgumentSchemas.quoteFulfillment.safeParse({
        address: null,
        savedAddressRef: ref,
        method: 'delivery',
      }).success,
    ).toBe(true);
    expect(
      parseAgentToolArguments('quoteFulfillment', {
        address: rawAddress,
        method: 'delivery',
      }),
    ).toMatchObject({
      success: true,
      data: { address: rawAddress, savedAddressRef: null, method: 'delivery' },
    });
    expect(
      parseAgentToolArguments('quoteFulfillment', {
        savedAddressRef: ref,
        method: 'delivery',
      }),
    ).toMatchObject({
      success: true,
      data: { address: null, savedAddressRef: ref, method: 'delivery' },
    });
    for (const invalid of [
      {
        address: rawAddress,
        savedAddressRef: ref,
        method: 'delivery',
      },
      {
        address: null,
        savedAddressRef: null,
        method: 'delivery',
      },
      {
        address: null,
        savedAddressRef: ref,
        method: 'pickup',
      },
      {
        savedAddressRef: {
          ...ref,
          kind: 'payment_method',
        },
        method: 'delivery',
      },
      {
        savedAddressRef: {
          ...ref,
          providerAddress: rawAddress,
        },
        method: 'delivery',
      },
      {
        savedAddressRef: ref,
        method: 'delivery',
        itemCodes: ['forged'],
      },
    ]) {
      expect(
        agentToolArgumentSchemas.quoteFulfillment.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it('publishes only the opaque pending ref and only with customer-read authority', async () => {
    const authoritativeState = state({
      customerContext: {
        savedAddresses: [address],
        favorites: [],
        recentOrders: [],
      },
    });
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const publicationInput = {
      state: authoritativeState,
      currentUserMessageDigest: 'a'.repeat(64),
      authorityDigest: 'b'.repeat(64),
      currentTurnRevision: 'c'.repeat(64),
    };

    const authorized = projectModelPublicationState({
      ...publicationInput,
      authorizedScopes: ['customer:read'],
    });
    const unauthorized = projectModelPublicationState({
      ...publicationInput,
      authorizedScopes: [],
    });

    expect(authorized.modelState.pendingSavedAddressRef).toEqual(ref);
    expect(unauthorized.modelState.pendingSavedAddressRef).toBeUndefined();
    expect(JSON.stringify(authorized)).not.toContain(address.line1);
    expect(JSON.stringify(unauthorized)).not.toContain(address.line1);
  });

  it('claims the exact authenticated ref and creates only the verified delivery quote', async () => {
    const authoritativeState = state();
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });

    const claimed = await claimSavedAddressQuote({
      envelope: envelope({ state: authoritativeState, ref }),
      turnInput: await turnInput({
        state: authoritativeState,
        store,
      }),
      state: authoritativeState,
    });

    expect(claimed).toMatchObject({
      ok: true,
      state: {
        pendingSavedAddressRef: undefined,
        fulfillment: undefined,
        orderPreview: undefined,
      },
      call: {
        toolName: 'quoteFulfillment',
        arguments: {
          address,
          method: 'delivery',
        },
      },
    });
  });

  it.each([
    {
      name: 'session',
      input: { sessionId: 'kfc:other-session' },
    },
    {
      name: 'customer',
      input: { customerId: 'other-customer' },
    },
    {
      name: 'authenticated subject',
      input: { authenticatedSubject: 'other-authenticated-subject' },
    },
    {
      name: 'channel',
      input: { channel: 'zalo' as const },
    },
    {
      name: 'authentication evidence',
      input: { authenticationEvidenceRef: 'controlled-test:other-login' },
    },
  ])(
    'collapses a wrong $name principal to an unavailable ref',
    async ({ input }) => {
      const authoritativeState = state();
      const store = new MemoryStore();
      const ref = await issueSavedAddressRef({
        store,
        state: authoritativeState,
      });

      await expect(
        claimSavedAddressQuote({
          envelope: envelope({ state: authoritativeState, ref }),
          turnInput: await turnInput({
            state: authoritativeState,
            store,
            ...input,
          }),
          state: authoritativeState,
        }),
      ).resolves.toEqual({
        ok: false,
        errorCode: 'structured_action_saved_address_ref_unavailable',
      });
    },
  );

  it('rejects stale and forged authority without consuming the valid ref', async () => {
    const authoritativeState = state();
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const currentTurnInput = await turnInput({
      state: authoritativeState,
      store,
    });

    await expect(
      claimSavedAddressQuote({
        envelope: envelope({
          state: authoritativeState,
          ref,
          verifiedRevision: 'b'.repeat(64),
        }),
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_verified_state_stale',
    });
    await expect(
      claimSavedAddressQuote({
        envelope: envelope({
          state: authoritativeState,
          ref: {
            id: '00000000-0000-4000-8000-000000000001',
            kind: 'saved_address',
          },
        }),
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });
    await expect(
      claimSavedAddressQuote({
        envelope: envelope({ state: authoritativeState, ref }),
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('replays only the identical action digest and rejects a distinct use', async () => {
    const authoritativeState = state();
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const currentTurnInput = await turnInput({
      state: authoritativeState,
      store,
    });
    const exactEnvelope = envelope({
      state: authoritativeState,
      ref,
      actionDigest: 'c'.repeat(64),
    });

    await expect(
      claimSavedAddressQuote({
        envelope: exactEnvelope,
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      claimSavedAddressQuote({
        envelope: exactEnvelope,
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      claimSavedAddressQuote({
        envelope: envelope({
          state: authoritativeState,
          ref,
          actionDigest: 'd'.repeat(64),
        }),
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });
  });

  it('does not consume the ref while a customer address draft conflicts', async () => {
    const authoritativeState = state({
      addressDraft: {
        line1: 'Customer-entered partial street',
      },
    });
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const actionEnvelope = envelope({
      state: authoritativeState,
      ref,
    });
    const currentTurnInput = await turnInput({
      state: authoritativeState,
      store,
    });
    const currentFence = currentTurnInput.runGuard?.commitFence;
    if (currentFence?.kind !== 'customer_run') {
      throw new Error('test_customer_run_fence_missing');
    }

    await expect(
      claimSavedAddressQuote({
        envelope: actionEnvelope,
        turnInput: currentTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_conflicts_with_draft',
    });
    await expect(
      store.claimVerifiedRef({
        ref,
        principal: principal(authoritativeState),
        expectedVerifiedRevision:
          kfcGenUiVerifiedStateRevision(authoritativeState),
        now: new Date().toISOString(),
        useId: 'test:prove-draft-rejection-did-not-consume',
        runFence: {
          sessionId: authoritativeState.sessionId,
          fence: currentFence,
          notAfter: '2099-01-01T00:00:00.000Z',
        },
      }),
    ).resolves.toMatchObject({ status: 'claimed' });
  });

  it('does not consume a one-shot ref without a durable run fence', async () => {
    const authoritativeState = state();
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const guardedTurnInput = await turnInput({
      state: authoritativeState,
      store,
    });
    const { runGuard: _runGuard, ...unguardedTurnInput } = guardedTurnInput;

    await expect(
      claimPendingSavedAddressQuote({
        ref,
        method: 'delivery',
        useId: 'model-tool:unguarded',
        callId: 'unguarded',
        turnInput: unguardedTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });
    await expect(
      claimPendingSavedAddressQuote({
        ref,
        method: 'delivery',
        useId: 'model-tool:guarded',
        callId: 'guarded',
        turnInput: guardedTurnInput,
        state: authoritativeState,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('fails closed on expired and commerce-revision-stale refs', async () => {
    const expiredState = state();
    const expiredStore = new MemoryStore();
    const expiredRef = await issueSavedAddressRef({
      store: expiredStore,
      state: expiredState,
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-02T00:00:00.000Z',
    });
    await expect(
      claimPendingSavedAddressQuote({
        ref: expiredRef,
        method: 'delivery',
        useId: 'model-tool:expired',
        callId: 'expired',
        turnInput: await turnInput({
          state: expiredState,
          store: expiredStore,
        }),
        state: expiredState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });

    const staleState = state();
    const staleStore = new MemoryStore();
    const staleRef = await issueSavedAddressRef({
      store: staleStore,
      state: staleState,
    });
    staleState.cart = {
      ...cart(),
      totalVnd: 100_000,
    };
    await expect(
      claimPendingSavedAddressQuote({
        ref: staleRef,
        method: 'delivery',
        useId: 'model-tool:stale',
        callId: 'stale',
        turnInput: await turnInput({
          state: staleState,
          store: staleStore,
        }),
        state: staleState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });
  });

  it('atomically permits one distinct model use while replaying only the same use id', async () => {
    const authoritativeState = state();
    const store = new MemoryStore();
    const ref = await issueSavedAddressRef({
      store,
      state: authoritativeState,
    });
    const input = {
      ref,
      method: 'delivery' as const,
      callId: 'concurrent-saved-address-call',
      turnInput: await turnInput({
        state: authoritativeState,
        store,
      }),
      state: authoritativeState,
    };

    const concurrent = await Promise.all([
      claimPendingSavedAddressQuote({
        ...input,
        useId: 'model-tool:turn-a:duplicate-provider-call-id',
      }),
      claimPendingSavedAddressQuote({
        ...input,
        useId: 'model-tool:turn-b:duplicate-provider-call-id',
      }),
    ]);
    const winner = concurrent.find((result) => result.ok);
    const loser = concurrent.find((result) => !result.ok);

    expect(winner).toMatchObject({ ok: true });
    expect(loser).toEqual({
      ok: false,
      errorCode: 'structured_action_saved_address_ref_unavailable',
    });
    const winningUseId = concurrent[0]?.ok
      ? 'model-tool:turn-a:duplicate-provider-call-id'
      : 'model-tool:turn-b:duplicate-provider-call-id';
    await expect(
      claimPendingSavedAddressQuote({
        ...input,
        useId: winningUseId,
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
