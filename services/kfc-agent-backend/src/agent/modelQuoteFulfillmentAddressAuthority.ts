import type {
  Address,
  ConversationTurn,
  FulfillmentAddressInput,
} from '../domain/types.js';
import { stateRevision } from '../graph/turnSupport.js';
import {
  agentFulfillmentAddressSchema,
} from '../ordering/toolCatalog.js';
import {
  isIssuedModelPublicationBundle,
  publicationBundleMatchesUserTurnWindow,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';

export const AGENT_ADDRESS_AUTHORITY_MISMATCH =
  'agent_address_authority_mismatch' as const;

const publishedAddressFields = [
  'label',
  'line1',
  'district',
  'city',
] as const satisfies readonly (keyof FulfillmentAddressInput)[];

export interface AuthorizedQuoteFulfillmentAddressInput
  extends FulfillmentAddressInput {}

export type ModelQuoteFulfillmentAddressAuthorityResult =
  | {
      ok: true;
      address: AuthorizedQuoteFulfillmentAddressInput;
    }
  | {
      ok: false;
      errorCode: typeof AGENT_ADDRESS_AUTHORITY_MISMATCH;
    };

function mismatch(): ModelQuoteFulfillmentAddressAuthorityResult {
  return {
    ok: false,
    errorCode: AGENT_ADDRESS_AUTHORITY_MISMATCH,
  };
}

function currentTurnBinding(turn: ConversationTurn) {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    channel: turn.channel,
    role: turn.role,
    text: turn.text,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    createdAt: turn.createdAt,
  };
}

async function publicationIsBoundToTurn(
  bundle: ModelPublicationBundle,
  currentUserTurn: ConversationTurn,
): Promise<boolean> {
  if (
    currentUserTurn.role !== 'user' ||
    !isIssuedModelPublicationBundle(bundle)
  ) {
    return false;
  }
  const [messageDigest, turnRevision] = await Promise.all([
    stateRevision(currentUserTurn.text),
    stateRevision(currentTurnBinding(currentUserTurn)),
  ]);
  return (
    bundle.lifecycle.currentUserMessageDigest === messageDigest &&
    bundle.lifecycle.currentTurnRevision === turnRevision
  );
}

function exactUserTurnContent(
  userTurns: readonly ConversationTurn[],
  value: string,
): boolean {
  return latestExactUserTurnIndex(userTurns, value) !== undefined;
}

function latestExactUserTurnIndex(
  userTurns: readonly ConversationTurn[],
  value: string,
): number | undefined {
  for (let index = userTurns.length - 1; index >= 0; index -= 1) {
    if (userTurns[index]?.text.includes(value)) return index;
  }
  return undefined;
}

function administrativeCorrectionKeepsLineCoherent(input: {
  proposed: FulfillmentAddressInput;
  publishedDraft: Partial<Address> | undefined;
  publishedAddress: Address | undefined;
  userTurns: readonly ConversationTurn[];
}): boolean {
  const baselineDistrict =
    input.publishedDraft?.district ??
    input.publishedAddress?.district;
  const baselineCity =
    input.publishedDraft?.city ??
    input.publishedAddress?.city;
  const correctedAdministrativeValues = [
    ...((baselineDistrict === undefined ||
      input.proposed.district !== baselineDistrict) &&
      input.proposed.district !== null
      ? [input.proposed.district]
      : []),
    ...((baselineCity === undefined ||
      input.proposed.city !== baselineCity) &&
      input.proposed.city !== null
      ? [input.proposed.city]
      : []),
  ];
  if (correctedAdministrativeValues.length === 0) return true;

  // A line carried only from an older draft/address cannot be combined with a
  // newer district or city correction. Split-address turns remain valid when
  // the line is supplied in the same or a later model-visible user turn.
  const lineSourceIndex = latestExactUserTurnIndex(
    input.userTurns,
    input.proposed.line1,
  );
  return (
    lineSourceIndex !== undefined &&
    correctedAdministrativeValues.every((value) => {
      const administrativeSourceIndex = latestExactUserTurnIndex(
        input.userTurns,
        value,
      );
      return administrativeSourceIndex === undefined ||
        lineSourceIndex >= administrativeSourceIndex;
    })
  );
}

function sameTurn(
  left: ConversationTurn,
  right: ConversationTurn,
): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.channel === right.channel &&
    left.role === right.role &&
    left.text === right.text &&
    left.externalMessageId === right.externalMessageId &&
    left.externalUserId === right.externalUserId &&
    left.createdAt === right.createdAt
  );
}

function authorizedAddressInput(
  proposed: FulfillmentAddressInput,
): AuthorizedQuoteFulfillmentAddressInput {
  return { ...proposed };
}

function issuedUserTurns(input: {
  recentTurns: readonly ConversationTurn[];
  currentUserTurn: ConversationTurn;
}): ConversationTurn[] | undefined {
  const { currentUserTurn } = input;
  const turns = input.recentTurns.filter((turn) => turn.role === 'user');
  const ids = new Set<string>();
  for (const turn of turns) {
    if (
      ids.has(turn.id) ||
      turn.sessionId !== currentUserTurn.sessionId ||
      turn.channel !== currentUserTurn.channel ||
      (turn.externalUserId ?? null) !==
        (currentUserTurn.externalUserId ?? null)
    ) {
      return undefined;
    }
    ids.add(turn.id);
  }
  const last = turns.at(-1);
  return last && sameTurn(last, currentUserTurn)
    ? turns
    : undefined;
}

function suppliedFieldIsAuthorized(input: {
  field: (typeof publishedAddressFields)[number];
  proposed: FulfillmentAddressInput;
  publishedDraft: Partial<Address> | undefined;
  publishedAddress: Address | undefined;
  userTurns: readonly ConversationTurn[];
}): boolean {
  const value = input.proposed[input.field];
  if (value === null) return true;
  const draftValue = input.publishedDraft?.[input.field];
  const addressValue = input.publishedAddress?.[input.field];
  return (
    value === draftValue ||
    value === addressValue ||
    exactUserTurnContent(input.userTurns, value)
  );
}

/**
 * Authorizes a model-authored fulfillment address against only the model's
 * issued publication and its exact model-visible user-turn window, ending at
 * the current turn bound to that publication.
 *
 * Every non-null model-supplied field must be an exact value from the issued
 * publication or a user turn that was visible to this model invocation.
 * Missing administrative fields remain null for the fulfillment provider to
 * resolve; this server boundary never guesses or fills them.
 */
export async function validateModelQuoteFulfillmentAddressAuthority(input: {
  publicationBundle: ModelPublicationBundle;
  currentUserTurn: ConversationTurn;
  recentTurns?: readonly ConversationTurn[];
  proposedAddress: unknown;
}): Promise<ModelQuoteFulfillmentAddressAuthorityResult> {
  const proposed =
    agentFulfillmentAddressSchema.safeParse(input.proposedAddress);
  const userTurns = issuedUserTurns({
    recentTurns: input.recentTurns ?? [input.currentUserTurn],
    currentUserTurn: input.currentUserTurn,
  });
  if (
    !proposed.success ||
    !userTurns ||
    !await publicationBundleMatchesUserTurnWindow(
      input.publicationBundle,
      input.recentTurns ?? [input.currentUserTurn],
    ) ||
    !await publicationIsBoundToTurn(
      input.publicationBundle,
      input.currentUserTurn,
    )
  ) {
    return mismatch();
  }

  const publishedDraft = input.publicationBundle.modelState.addressDraft;
  const publishedAddress = input.publicationBundle.modelState.address;
  return (
    publishedAddressFields.every((field) =>
      suppliedFieldIsAuthorized({
        field,
        proposed: proposed.data,
        publishedDraft,
        publishedAddress,
        userTurns,
      })) &&
    administrativeCorrectionKeepsLineCoherent({
      proposed: proposed.data,
      publishedDraft,
      publishedAddress,
      userTurns,
    })
  )
    ? { ok: true, address: authorizedAddressInput(proposed.data) }
    : mismatch();
}
