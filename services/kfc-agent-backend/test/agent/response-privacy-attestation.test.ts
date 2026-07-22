import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildCurrentTurnResponseEvidence,
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
  type ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import {
  validateResponsePublicationAttestation,
} from '../../src/agent/responsePrivacyAttestation.js';
import type { CustomerAccessContext } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { executePublicationTool } from './model-publication-test-runtime.js';

let safeBundle: ModelPublicationBundle;
let privateBundle: ModelPublicationBundle;
let publicationState: AgentGraphState;
let publicationAccess: CustomerAccessContext;
const safeResponseText = 'How can I help?';
const privateResponseText = 'I will use Current user address.';

async function attestation(
  overrides: Record<string, unknown> = {},
  bundle = safeBundle,
  customerText = safeResponseText,
) {
  return {
    schemaVersion: 'kfc-response-publication-attestation-v1',
    projectionDigest: bundle.projectionDigest,
    responseDigest: await stateRevision(customerText),
    semanticRelevance: 'aligned',
    privateDataDisclosure: 'none',
    disclosureAuthorities: [],
    disclosesInternalMetadata: false,
    ...overrides,
  };
}

function validate(
  raw: unknown,
  bundle: ModelPublicationBundle = safeBundle,
  customerText = safeResponseText,
) {
  return validateResponsePublicationAttestation({
    raw,
    bundle,
    customerText,
  });
}

beforeAll(async () => {
  const currentUserTurn = {
    id: 'privacy-turn',
    sessionId: 'privacy-session',
    channel: 'kfc' as const,
    role: 'user' as const,
    text: 'My address is Current user address',
    externalMessageId: 'privacy-message',
    externalUserId: 'privacy-user',
    deliveryStatus: 'received' as const,
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
  const state: AgentGraphState = {
    sessionId: currentUserTurn.sessionId,
    customerId: 'privacy-customer',
    channel: currentUserTurn.channel,
    latestUserMessage: currentUserTurn.text,
    recentTurns: [currentUserTurn],
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
  const accessContext: CustomerAccessContext = {
    tenantScope: 'kfc-vn',
    customerSurface: 'kfc-app-chat',
    sessionRef: state.sessionId,
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: state.customerId,
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'test',
      issuer: 'test',
      audience: 'test',
      authenticatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      evidenceRef: 'privacy-auth',
    },
    authorizedScopes: ['customer:read'],
  };
  publicationState = state;
  publicationAccess = accessContext;
  const authority = await issueModelPublicationAuthority({
    state,
    currentUserTurn,
    accessContext,
  });
  safeBundle = await buildModelPublicationBundle({ state, authority });
  const execution = await executePublicationTool({
    authority,
    state,
    accessContext,
    call: {
      id: 'privacy-saved-address-call',
      toolName: 'getSavedAddresses',
      arguments: {},
    },
    clientOptions: {
      savedAddressesProvider: () => ({
        ok: true,
        value: [{
          label: 'Home',
          line1: 'Current user address',
          district: 'District 1',
          city: 'Ho Chi Minh City',
        }],
        message: 'saved_addresses_observed',
      }),
    },
  });
  const currentEvidence = await buildCurrentTurnResponseEvidence({
    authority,
    execution,
  });
  if (!currentEvidence) throw new Error('current evidence missing');
  privateBundle = await buildModelPublicationBundle({
    state,
    authority,
    currentTurnEvidence: [currentEvidence],
  });
});

describe('response publication attestation', () => {
  it('accepts an aligned response with no private disclosure', async () => {
    const raw = await attestation();
    await expect(validate(raw)).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
      attestation: {
        semanticRelevance: 'aligned',
        privateDataDisclosure: 'none',
        disclosesInternalMetadata: false,
      },
    });
  });

  it('rejects an exact issued private bundle after authentication expiry', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-07-20T00:00:00.000Z');
      const state = structuredClone(publicationState);
      const accessContext = structuredClone(publicationAccess);
      if (accessContext.authenticationEvidence.state !== 'verified') {
        throw new Error('verified authentication evidence missing');
      }
      accessContext.authenticationEvidence.expiresAt =
        '2026-07-20T00:01:00.000Z';
      const currentUserTurn = state.recentTurns?.at(-1);
      if (!currentUserTurn) throw new Error('current user turn missing');
      const authority = await issueModelPublicationAuthority({
        state,
        currentUserTurn,
        accessContext,
      });
      const expiringBundle = await buildModelPublicationBundle({
        state,
        authority,
      });
      const raw = await attestation(
        {},
        expiringBundle,
        safeResponseText,
      );

      await expect(validate(raw, expiringBundle)).resolves.toMatchObject({
        ok: true,
      });
      vi.setSystemTime('2026-07-20T00:02:00.000Z');
      await expect(validate(raw, expiringBundle)).resolves.toEqual({
        ok: false,
        errorCode: 'agent_response_publication_rejected',
        responsePublicationSafe: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts private disclosure authorized by exact current-turn evidence', async () => {
    const evidenceId = privateBundle.evidence.find(
      (entry) => entry.privateData,
    )?.evidenceId;
    if (!evidenceId) throw new Error('private evidence missing');
    const raw = await attestation({
      privateDataDisclosure: 'authorized',
      disclosureAuthorities: [{
        kind: 'publication_evidence',
        evidenceId,
      }],
    }, privateBundle, privateResponseText);
    await expect(
      validate(raw, privateBundle, privateResponseText),
    ).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
  });

  it('accepts private disclosure explicitly supplied by the current user', async () => {
    const raw = await attestation({
      privateDataDisclosure: 'authorized',
      disclosureAuthorities: [{
        kind: 'current_user_message',
        messageDigest: safeBundle.lifecycle.currentUserMessageDigest,
      }],
    }, safeBundle, privateResponseText);
    await expect(
      validate(raw, safeBundle, privateResponseText),
    ).resolves.toMatchObject({
      ok: true,
      responsePublicationSafe: true,
    });
  });

  it.each([
    {
      name: 'missing attestation',
      raw: async () => undefined,
    },
    {
      name: 'wrong schema',
      raw: async () => attestation({ schemaVersion: 'legacy' }),
    },
    {
      name: 'projection replay',
      raw: async () => attestation({ projectionDigest: 'b'.repeat(64) }),
    },
    {
      name: 'semantic mismatch',
      raw: async () => attestation({ semanticRelevance: 'misaligned' }),
    },
    {
      name: 'unauthorized disclosure',
      raw: async () => attestation({
        privateDataDisclosure: 'unauthorized',
      }),
    },
    {
      name: 'internal metadata disclosure',
      raw: async () => attestation({ disclosesInternalMetadata: true }),
    },
    {
      name: 'forged current evidence',
      raw: async () => attestation({
        privateDataDisclosure: 'authorized',
        disclosureAuthorities: [{
          kind: 'publication_evidence',
          evidenceId: 'current:getSavedAddresses:forged',
        }],
      }),
    },
    {
      name: 'duplicate authority',
      raw: async () => attestation({
        privateDataDisclosure: 'authorized',
        disclosureAuthorities: [
          {
            kind: 'current_user_message',
            messageDigest: safeBundle.lifecycle.currentUserMessageDigest,
          },
          {
            kind: 'current_user_message',
            messageDigest: safeBundle.lifecycle.currentUserMessageDigest,
          },
        ],
      }),
    },
    {
      name: 'none with an authority',
      raw: async () => attestation({
        disclosureAuthorities: [{
          kind: 'current_user_message',
          messageDigest: safeBundle.lifecycle.currentUserMessageDigest,
        }],
      }),
    },
    {
      name: 'authorized without an authority',
      raw: async () => attestation({
        privateDataDisclosure: 'authorized',
      }),
    },
    {
      name: 'unknown output field',
      raw: async () => attestation({ explanation: 'not allowed' }),
    },
  ])('fails closed for $name', async ({ raw }) => {
    await expect(validate(await raw())).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('rejects a structurally copied bundle even when its digest matches', async () => {
    const copied = {
      ...safeBundle,
    } as ModelPublicationBundle;

    await expect(validateResponsePublicationAttestation({
      raw: await attestation(),
      bundle: copied,
      customerText: safeResponseText,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('rejects an attestation replayed onto another response', async () => {
    const raw = await attestation({}, safeBundle, safeResponseText);

    await expect(validate(
      raw,
      safeBundle,
      'A different response from the same publication bundle.',
    )).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });

  it('rejects a current-message authority bound to another message', async () => {
    const raw = await attestation({
      privateDataDisclosure: 'authorized',
      disclosureAuthorities: [{
        kind: 'current_user_message',
        messageDigest: 'b'.repeat(64),
      }],
    }, safeBundle, privateResponseText);

    await expect(
      validate(raw, safeBundle, privateResponseText),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'agent_response_publication_rejected',
      responsePublicationSafe: false,
    });
  });
});
