import { describe, expect, it } from 'vitest';
import {
  validateSelectedActionResponseAuthority,
  type CurrentSelectedActionAuthority,
  type SelectedActionResponseAuthority,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';

const actionDigest = 'a'.repeat(64);
const selectedRevision = 'b'.repeat(64);
const effectRevision = 'c'.repeat(64);

function authority(
  overrides: Partial<SelectedActionResponseAuthority> = {},
): SelectedActionResponseAuthority {
  return {
    schemaVersion: 'kfc-selected-action-response-authority-v1',
    actionDigest,
    selection: {
      entityIds: ['item/opaque-7Q', 'modifier/opaque-J4'],
      verifiedRevision: selectedRevision,
    },
    effect: {
      effectId: 'effect/opaque-M2',
      outcome: 'tool_succeeded',
      verifiedRevision: effectRevision,
      kind: 'mutation',
      verification: {
        status: 'verified',
        verificationId: 'verification/opaque-N6',
      },
    },
    ...overrides,
  };
}

function reference(
  overrides: Partial<SelectedActionResponseReference> = {},
): SelectedActionResponseReference {
  return {
    schemaVersion: 'kfc-selected-action-response-reference-v1',
    actionDigest,
    selection: {
      entityIds: ['modifier/opaque-J4', 'item/opaque-7Q'],
      verifiedRevision: selectedRevision,
    },
    effect: {
      effectId: 'effect/opaque-M2',
      outcome: 'tool_succeeded',
      verifiedRevision: effectRevision,
    },
    assertion: 'mutation_completed',
    ...overrides,
  };
}

function currentAuthority(
  overrides: Partial<CurrentSelectedActionAuthority> = {},
): CurrentSelectedActionAuthority {
  return {
    schemaVersion: 'kfc-current-selected-action-authority-v1',
    actionDigest,
    selection: {
      entityIds: ['item/opaque-7Q', 'modifier/opaque-J4'],
      verifiedRevision: selectedRevision,
    },
    effect: {
      effectId: 'effect/opaque-M2',
      outcome: 'tool_succeeded',
      verifiedRevision: effectRevision,
      kind: 'mutation',
      verification: {
        status: 'verified',
        verificationId: 'verification/opaque-N6',
      },
    },
    ...overrides,
  };
}

describe('selected action response authority', () => {
  it('accepts an exact verified action, effect, entity set, and revisions', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: true,
      reference: reference(),
    });
  });

  it('accepts an exact verified presentation acknowledgement', () => {
    const presentationEffect = {
      effectId: 'effect/opaque-presentation-R3',
      outcome: 'presentation_ready' as const,
      verifiedRevision: effectRevision,
    };
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        effect: presentationEffect,
        assertion: 'outcome_acknowledged',
      }),
      authority: authority({
        effect: {
          ...presentationEffect,
          kind: 'presentation',
          verification: {
            status: 'verified',
            verificationId: 'verification/opaque-presentation-C1',
          },
        },
      }),
      currentAuthority: currentAuthority({
        effect: {
          ...presentationEffect,
          kind: 'presentation',
          verification: {
            status: 'verified',
            verificationId: 'verification/opaque-presentation-C1',
          },
        },
      }),
    })).toEqual({
      ok: true,
      reference: reference({
        effect: presentationEffect,
        assertion: 'outcome_acknowledged',
      }),
    });
  });

  it('rejects a response bound to another selected cart item', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        selection: {
          entityIds: ['modifier/opaque-J4', 'item/opaque-X9'],
          verifiedRevision: selectedRevision,
        },
      }),
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_entity_mismatch',
    });
  });

  it('rejects a response bound to another structured action', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({ actionDigest: 'd'.repeat(64) }),
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_action_mismatch',
    });
  });

  it.each([
    {
      name: 'action digest',
      current: currentAuthority({ actionDigest: 'd'.repeat(64) }),
    },
    {
      name: 'effect ID',
      current: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          effectId: 'effect/opaque-new-P8',
        },
      }),
    },
    {
      name: 'schema-valid outcome and kind',
      current: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          outcome: 'presentation_ready',
          kind: 'presentation',
        },
      }),
    },
    {
      name: 'effect revision',
      current: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          verifiedRevision: 'e'.repeat(64),
        },
      }),
    },
  ])('rejects an authority with a stale current $name', ({ current }) => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: authority(),
      currentAuthority: current,
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_stale_outcome',
    });
  });

  it.each([
    {
      name: 'selected entity',
      selection: {
        entityIds: ['item/opaque-other-L8', 'modifier/opaque-J4'],
        verifiedRevision: selectedRevision,
      },
    },
    {
      name: 'selection revision',
      selection: {
        entityIds: ['item/opaque-7Q', 'modifier/opaque-J4'],
        verifiedRevision: 'd'.repeat(64),
      },
    },
    {
      name: 'missing selected entity',
      selection: {
        entityIds: ['item/opaque-7Q'],
        verifiedRevision: selectedRevision,
      },
    },
    {
      name: 'extra selected entity',
      selection: {
        entityIds: [
          'item/opaque-7Q',
          'modifier/opaque-J4',
          'entity/opaque-extra-Q2',
        ],
        verifiedRevision: selectedRevision,
      },
    },
  ])(
    'rejects an authority whose current $name has changed',
    ({ selection }) => {
      expect(validateSelectedActionResponseAuthority({
        reference: reference(),
        authority: authority(),
        currentAuthority: currentAuthority({ selection }),
      })).toEqual({
        ok: false,
        errorCode: 'selected_action_response_stale_outcome',
      });
    },
  );

  it.each([
    {
      name: 'selected-state',
      selection: {
        entityIds: ['item/opaque-7Q', 'modifier/opaque-J4'],
        verifiedRevision: 'e'.repeat(64),
      },
      effect: reference().effect,
    },
    {
      name: 'verified-effect',
      selection: reference().selection,
      effect: {
        ...reference().effect,
        verifiedRevision: 'f'.repeat(64),
      },
    },
  ])('rejects a mismatched $name revision', ({ selection, effect }) => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({ selection, effect }),
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_revision_mismatch',
    });
  });

  it.each([
    {
      name: 'effect ID',
      effect: {
        ...reference().effect,
        effectId: 'effect/opaque-other-V5',
      },
    },
    {
      name: 'outcome',
      effect: {
        ...reference().effect,
        outcome: 'presentation_ready' as const,
      },
    },
  ])('rejects a claimed $name mismatch', ({ effect }) => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({ effect }),
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_effect_mismatch',
    });
  });

  it('rejects verified authority records with different verification IDs', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({ assertion: 'outcome_acknowledged' }),
      authority: authority(),
      currentAuthority: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          verification: {
            status: 'verified',
            verificationId: 'verification/opaque-other-H9',
          },
        },
      }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_effect_unverified',
    });
  });

  it('rejects a mutation claim when the trusted effect was not verified', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: authority({
        effect: {
          ...authority().effect,
          verification: { status: 'unverified' },
        },
      }),
      currentAuthority: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          verification: { status: 'unverified' },
        },
      }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_mutation_unverified',
    });
  });

  it('rejects an acknowledgement when its effect was not verified', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({ assertion: 'outcome_acknowledged' }),
      authority: authority({
        effect: {
          ...authority().effect,
          verification: { status: 'unverified' },
        },
      }),
      currentAuthority: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          verification: { status: 'unverified' },
        },
      }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_effect_unverified',
    });
  });

  it('rejects a mutation claim for a verified non-mutation effect', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: authority({
        effect: {
          ...authority().effect,
          kind: 'read',
        },
      }),
      currentAuthority: currentAuthority({
        effect: {
          ...currentAuthority().effect,
          kind: 'read',
        },
      }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_mutation_unverified',
    });
  });

  it.each([
    {
      name: 'read tool success',
      effect: {
        ...authority().effect,
        kind: 'read' as const,
      },
    },
    {
      name: 'customer rejection',
      effect: {
        ...authority().effect,
        outcome: 'customer_rejected' as const,
        kind: 'none' as const,
      },
    },
  ])('accepts a verified $name acknowledgement', ({ effect }) => {
    const responseEffect = {
      effectId: effect.effectId,
      outcome: effect.outcome,
      verifiedRevision: effect.verifiedRevision,
    };
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        effect: responseEffect,
        assertion: 'outcome_acknowledged',
      }),
      authority: authority({ effect }),
      currentAuthority: currentAuthority({ effect }),
    })).toEqual({
      ok: true,
      reference: reference({
        effect: responseEffect,
        assertion: 'outcome_acknowledged',
      }),
    });
  });

  it.each([
    {
      name: 'presentation',
      effect: {
        ...authority().effect,
        outcome: 'presentation_ready' as const,
        kind: 'presentation' as const,
      },
    },
    {
      name: 'customer rejection',
      effect: {
        ...authority().effect,
        outcome: 'customer_rejected' as const,
        kind: 'none' as const,
      },
    },
  ])('rejects mutation completion for a verified $name', ({ effect }) => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        effect: {
          effectId: effect.effectId,
          outcome: effect.outcome,
          verifiedRevision: effect.verifiedRevision,
        },
        assertion: 'mutation_completed',
      }),
      authority: authority({ effect }),
      currentAuthority: currentAuthority({ effect }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_mutation_unverified',
    });
  });

  it.each([
    {
      name: 'unverified',
      effect: {
        ...currentAuthority().effect,
        verification: { status: 'unverified' as const },
      },
    },
    {
      name: 'non-mutation',
      effect: {
        ...currentAuthority().effect,
        kind: 'read' as const,
      },
    },
  ])(
    'does not let a stale authority self-assert a $name mutation',
    ({ effect }) => {
      expect(validateSelectedActionResponseAuthority({
        reference: reference(),
        authority: authority(),
        currentAuthority: currentAuthority({ effect }),
      })).toEqual({
        ok: false,
        errorCode: 'selected_action_response_mutation_unverified',
      });
    },
  );

  it.each([
    {
      name: 'outcome and kind disagreement',
      effect: {
        ...authority().effect,
        outcome: 'presentation_ready',
        kind: 'mutation',
      },
    },
    {
      name: 'missing verification ID',
      effect: {
        ...authority().effect,
        verification: { status: 'verified' },
      },
    },
    {
      name: 'extra verification field',
      effect: {
        ...authority().effect,
        verification: {
          status: 'verified',
          verificationId: 'verification/opaque-N6',
          assertedBy: 'untrusted',
        },
      },
    },
  ])('rejects trusted authority with $name', ({ effect }) => {
    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: {
        ...authority(),
        effect,
      },
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_authority_invalid',
    });
  });

  it('accepts exact arbitrary opaque Unicode and case-sensitive IDs', () => {
    const selection = {
      entityIds: ['实体/Đỏ-ß-İ-Ж-🍗', 'Entity/CaseSensitive-X'],
      verifiedRevision: selectedRevision,
    };
    const effect = {
      effectId: 'اثر/Δ-É-Case',
      outcome: 'tool_succeeded' as const,
      verifiedRevision: effectRevision,
      kind: 'read' as const,
      verification: {
        status: 'verified' as const,
        verificationId: '证据/Σ-Upper',
      },
    };
    const responseEffect = {
      effectId: effect.effectId,
      outcome: effect.outcome,
      verifiedRevision: effect.verifiedRevision,
    };
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        selection: {
          ...selection,
          entityIds: [...selection.entityIds].reverse(),
        },
        effect: responseEffect,
        assertion: 'outcome_acknowledged',
      }),
      authority: authority({ selection, effect }),
      currentAuthority: currentAuthority({ selection, effect }),
    })).toMatchObject({ ok: true });
  });

  it.each([
    {
      name: 'case alias',
      trustedId: 'Entity/CaseSensitive-X',
      claimedId: 'Entity/CaseSensitive-x',
    },
    {
      name: 'Unicode confusable',
      trustedId: 'item/Α',
      claimedId: 'item/A',
    },
    {
      name: 'Unicode normalization alias',
      trustedId: 'item/café',
      claimedId: 'item/cafe\u0301',
    },
  ])('rejects an exact $name substitution', ({ trustedId, claimedId }) => {
    const selection = {
      entityIds: [trustedId],
      verifiedRevision: selectedRevision,
    };
    expect(validateSelectedActionResponseAuthority({
      reference: reference({
        selection: {
          entityIds: [claimedId],
          verifiedRevision: selectedRevision,
        },
      }),
      authority: authority({ selection }),
      currentAuthority: currentAuthority({ selection }),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_entity_mismatch',
    });
  });

  it('rejects malformed or duplicate opaque identity input', () => {
    expect(validateSelectedActionResponseAuthority({
      reference: {
        ...reference(),
        selection: {
          entityIds: ['item/opaque-7Q', 'item/opaque-7Q'],
          verifiedRevision: selectedRevision,
        },
      },
      authority: authority(),
      currentAuthority: currentAuthority(),
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_reference_invalid',
    });

    expect(validateSelectedActionResponseAuthority({
      reference: reference(),
      authority: authority(),
      currentAuthority: {
        ...currentAuthority(),
        effect: {
          ...currentAuthority().effect,
          effectId: ' effect/opaque-M2',
        },
      },
    })).toEqual({
      ok: false,
      errorCode: 'selected_action_response_current_authority_invalid',
    });
  });
});
