import { describe, expect, it } from 'vitest';
import {
  AGENT_ADDRESS_AUTHORITY_MISMATCH,
  validateModelQuoteFulfillmentAddressAuthority,
} from '../../src/agent/modelQuoteFulfillmentAddressAuthority.js';
import {
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
  type ModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import type {
  Address,
  ConversationTurn,
  CustomerAccessContext,
} from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';

const previousAddress: Address = {
  label: 'Previous address',
  line1: '123 Previous Street',
  district: 'District 5',
  city: 'Ho Chi Minh City',
};

function userTurn(input: {
  sessionId: string;
  text: string;
  suffix?: string;
}): ConversationTurn {
  const suffix = input.suffix ?? 'turn';
  return {
    id: `${input.sessionId}-${suffix}`,
    sessionId: input.sessionId,
    channel: 'kfc',
    role: 'user',
    text: input.text,
    externalMessageId: `${input.sessionId}-${suffix}-message`,
    externalUserId: 'address-authority-customer',
    deliveryStatus: 'received',
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

async function issuedBundle(input: {
  sessionId: string;
  text: string;
  address?: Address;
  addressDraft?: Partial<Address>;
  publishPrivateAddress?: boolean;
  priorUserTexts?: readonly string[];
}): Promise<{
  bundle: ModelPublicationBundle;
  turn: ConversationTurn;
}> {
  const turn = userTurn({
    sessionId: input.sessionId,
    text: input.text,
    suffix: 'current',
  });
  const priorTurns = (input.priorUserTexts ?? []).map((text, index) =>
    userTurn({
      sessionId: input.sessionId,
      text,
      suffix: `prior-${index + 1}`,
    }));
  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: 'address-authority-customer',
    channel: 'kfc',
    latestUserMessage: input.text,
    recentTurns: [...priorTurns, turn],
    ...(input.address
      ? {
          cart: {
            id: `${input.sessionId}-cart`,
            items: [{
              itemCode: '20751',
              name: 'Published cart item',
              quantity: 1,
              unitPriceVnd: 99_000,
            }],
            subtotalVnd: 99_000,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 99_000,
            voucherCode: null,
          },
        }
      : {}),
    address: input.address,
    addressDraft: input.addressDraft,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
  let accessContext: CustomerAccessContext | undefined;
  if (input.publishPrivateAddress) {
    accessContext = controlledCustomerAccess({
      sessionId: input.sessionId,
      customerId: state.customerId,
      channel: state.channel,
    });
  }
  const authority = await issueModelPublicationAuthority({
    state,
    currentUserTurn: turn,
    accessContext,
  });
  return {
    bundle: await buildModelPublicationBundle({
      state,
      authority,
    }),
    turn,
  };
}

function proposal(input: Partial<{
  label: string | null;
  line1: string;
  district: string;
  city: string;
}> = {}) {
  return {
    label: null,
    line1: '60 Pham Van Nghi',
    district: 'District 7',
    city: 'Ho Chi Minh City',
    ...input,
  };
}

describe('model quote fulfillment address authority', () => {
  it('accepts a complete current-turn address without filling its null label', async () => {
    const proposed = proposal();
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-current-turn',
      text: [
        proposed.line1,
        proposed.district,
        proposed.city,
      ].join(', '),
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: true,
      address: proposed,
    });
  });

  it('requires every fresh required value to occur exactly in the bound turn', async () => {
    const proposed = proposal();
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-current-turn-exact',
      text: [
        proposed.line1.toLowerCase(),
        proposed.district,
        proposed.city,
      ].join(', '),
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('rejects a fresh model-authored label absent from the bound turn', async () => {
    const proposed = proposal({ label: 'Invented delivery label' });
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-current-turn-label',
      text: [
        proposed.line1,
        proposed.district,
        proposed.city,
      ].join(', '),
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('accepts an exact published complete address without repeating it', async () => {
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-published-complete',
      text: 'Continue with that delivery address',
      address: previousAddress,
      publishPrivateAddress: true,
    });
    expect(bundle.modelState.address).toEqual(previousAddress);

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: previousAddress,
    })).resolves.toEqual({
      ok: true,
      address: previousAddress,
    });
  });

  it('does not authorize an unpublished durable address', async () => {
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-hidden-complete',
      text: 'Continue with delivery',
      address: previousAddress,
    });
    expect(bundle.modelState.address).toBeUndefined();

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: previousAddress,
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('uses a published draft as the sole baseline and rejects a hidden old street', async () => {
    const addressDraft = {
      district: 'District 3',
      city: previousAddress.city,
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-old-street',
      text: 'Deliver to District 3',
      address: previousAddress,
      addressDraft,
      publishPrivateAddress: true,
    });
    expect(bundle.modelState.addressDraft).toEqual(addressDraft);
    expect(bundle.modelState.address).toBeUndefined();

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: {
        ...previousAddress,
        label: null,
        district: addressDraft.district,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('completes only missing draft fields from exact current-turn content', async () => {
    const proposed = proposal();
    const addressDraft = {
      district: proposed.district,
      city: proposed.city,
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-complete',
      text: `The street is ${proposed.line1}`,
      address: previousAddress,
      addressDraft,
      publishPrivateAddress: true,
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: true,
      address: proposed,
    });
  });

  it('authorizes split S01 detail from exact model-visible user turns while leaving city unresolved', async () => {
    const district = 'Quận 7';
    const line1 =
      'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng';
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-s01-split-turns',
      priorUserTexts: [
        `Cho mình giao về ${district}.`,
      ],
      text: `${line1}. Phí ship bao nhiêu?`,
    });
    const recentTurns = [
      userTurn({
        sessionId: turn.sessionId,
        text: `Cho mình giao về ${district}.`,
        suffix: 'prior-1',
      }),
      turn,
    ];

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      recentTurns,
      proposedAddress: {
        label: null,
        line1,
        district,
        city: null,
      },
    })).resolves.toEqual({
      ok: true,
      address: {
        label: null,
        line1,
        district,
        city: null,
      },
    });
  });

  it('rejects a forged administrative field absent from every issued source', async () => {
    const district = 'Quận 7';
    const line1 =
      'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng';
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-s01-forged-city',
      priorUserTexts: [`Giao về ${district}.`],
      text: line1,
    });
    const recentTurns = [
      userTurn({
        sessionId: turn.sessionId,
        text: `Giao về ${district}.`,
        suffix: 'prior-1',
      }),
      turn,
    ];

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      recentTurns,
      proposedAddress: {
        label: null,
        line1,
        district,
        city: 'Hồ Chí Minh',
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('accepts an exact current-turn correction to a published draft field', async () => {
    const proposed = proposal();
    const addressDraft = {
      line1: '10 Existing Draft Street',
      district: proposed.district,
      city: proposed.city,
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-mismatch',
      text: proposed.line1,
      addressDraft,
      publishPrivateAddress: true,
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: true,
      address: proposed,
    });
  });

  it('rejects an old draft line combined with a corrected administrative field', async () => {
    const addressDraft = {
      line1: '10 Existing Draft Street',
      district: 'District 5',
      city: 'Ho Chi Minh City',
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-admin-correction',
      text: 'District 3',
      addressDraft,
      publishPrivateAddress: true,
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: {
        label: null,
        line1: addressDraft.line1,
        district: 'District 3',
        city: addressDraft.city,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('accepts a split correction when the line follows the administrative field', async () => {
    const line1 = '20 Customer Supplied Street';
    const addressDraft = {
      line1: '10 Existing Draft Street',
      district: 'District 5',
      city: 'Ho Chi Minh City',
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-split-admin-correction',
      priorUserTexts: ['District 3'],
      text: `The street is ${line1}`,
      addressDraft,
      publishPrivateAddress: true,
    });
    const recentTurns = [
      userTurn({
        sessionId: turn.sessionId,
        text: 'District 3',
        suffix: 'prior-1',
      }),
      turn,
    ];

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      recentTurns,
      proposedAddress: {
        label: null,
        line1,
        district: 'District 3',
        city: addressDraft.city,
      },
    })).resolves.toEqual({
      ok: true,
      address: {
        label: null,
        line1,
        district: 'District 3',
        city: addressDraft.city,
      },
    });
  });

  it('rejects an older user-supplied line after a newer administrative correction', async () => {
    const oldLine = '10 Old Street';
    const newLine = '20 New Street';
    const addressDraft = {
      line1: oldLine,
      district: 'District 5',
      city: 'Ho Chi Minh City',
    };
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-draft-newer-admin-correction',
      priorUserTexts: [oldLine],
      text: `Actually ${newLine}, District 3`,
      addressDraft,
      publishPrivateAddress: true,
    });
    const recentTurns = [
      userTurn({
        sessionId: turn.sessionId,
        text: oldLine,
        suffix: 'prior-1',
      }),
      turn,
    ];

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      recentTurns,
      proposedAddress: {
        label: null,
        line1: oldLine,
        district: 'District 3',
        city: addressDraft.city,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it.each([
    {
      name: 'district',
      currentText: 'Actually District 3',
      district: 'District 3',
      city: null,
    },
    {
      name: 'city',
      currentText: 'Actually Da Nang',
      district: null,
      city: 'Da Nang',
    },
  ])(
    'rejects an old line combined with a newer $name when no baseline exists',
    async ({ currentText, district, city }) => {
      const oldLine = '10 Old Street';
      const sessionId = `address-no-baseline-newer-${district ?? city}`;
      const { bundle, turn } = await issuedBundle({
        sessionId,
        priorUserTexts: [oldLine],
        text: currentText,
      });
      const recentTurns = [
        userTurn({
          sessionId,
          text: oldLine,
          suffix: 'prior-1',
        }),
        turn,
      ];

      await expect(validateModelQuoteFulfillmentAddressAuthority({
        publicationBundle: bundle,
        currentUserTurn: turn,
        recentTurns,
        proposedAddress: {
          label: null,
          line1: oldLine,
          district,
          city,
        },
      })).resolves.toEqual({
        ok: false,
        errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
      });
    },
  );

  it('rejects a line-only published draft combined with newer administrative fields', async () => {
    const oldLine = '10 Existing Draft Street';
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-line-only-draft-newer-admin',
      text: 'Actually District 3, Da Nang',
      addressDraft: { line1: oldLine },
      publishPrivateAddress: true,
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: {
        label: null,
        line1: oldLine,
        district: 'District 3',
        city: 'Da Nang',
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('rejects a prior turn that was not in the issued model-visible window', async () => {
    const sessionId = 'address-injected-prior-turn';
    const line1 = '10 Injected Street';
    const district = 'District 3';
    const { bundle, turn } = await issuedBundle({
      sessionId,
      text: 'Continue with the supplied address',
    });
    const injectedTurn = userTurn({
      sessionId,
      text: `${line1}, ${district}`,
      suffix: 'injected-prior',
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      recentTurns: [injectedTurn, turn],
      proposedAddress: {
        label: null,
        line1,
        district,
        city: null,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('requires an issued bundle bound to the exact current user turn', async () => {
    const proposed = proposal();
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-bound-turn',
      text: [
        proposed.line1,
        proposed.district,
        proposed.city,
      ].join(', '),
    });
    const copiedBundle = structuredClone(bundle);
    const otherTurn = {
      ...turn,
      id: `${turn.id}-other`,
    };

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: copiedBundle,
      currentUserTurn: turn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: otherTurn,
      proposedAddress: proposed,
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });

  it('rejects structurally incomplete or extra-field proposals', async () => {
    const proposed = proposal();
    const { bundle, turn } = await issuedBundle({
      sessionId: 'address-invalid-shape',
      text: [
        proposed.line1,
        proposed.district,
        proposed.city,
      ].join(', '),
    });

    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: {
        ...proposed,
        untrusted: true,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
    await expect(validateModelQuoteFulfillmentAddressAuthority({
      publicationBundle: bundle,
      currentUserTurn: turn,
      proposedAddress: {
        label: null,
        line1: proposed.line1,
        district: proposed.district,
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
    });
  });
});
