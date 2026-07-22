import type { AgentRun, PendingCustomerTurn } from '../domain/types.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import {
  issueVerifiedMessengerGuestCheckoutAuthority,
  type GuestCheckoutAuthority,
  type VerifiedMessengerGuestCheckoutIngress,
} from '../security/guestCheckoutAuthority.js';

const maximumInitialMessengerGuestIngressAgeMs = 15 * 60_000;

function freshMessengerGuestIngress(
  ingress: VerifiedMessengerGuestCheckoutIngress,
  now: number,
): boolean {
  const receivedAt = Date.parse(ingress.receivedAt);
  return (
    Number.isFinite(receivedAt) &&
    receivedAt <= now + 60_000 &&
    receivedAt >= now - maximumInitialMessengerGuestIngressAgeMs
  );
}

export async function messengerGuestAuthorityForClaimedRun(input: {
  run: AgentRun;
  firstLinkedTurn: PendingCustomerTurn;
  commitFence: Extract<RunCommitFence, { kind: 'agent_run' }>;
  verifiedIngress: readonly VerifiedMessengerGuestCheckoutIngress[] | undefined;
  now?: number;
}): Promise<GuestCheckoutAuthority | undefined> {
  if (input.run.channel !== 'messenger') return undefined;
  const now = input.now ?? Date.now();
  const ingress = input.verifiedIngress?.find(
    (candidate) =>
      candidate.sessionId === input.run.sessionId &&
      candidate.customerId === input.run.externalUserId &&
      candidate.surfaceSubjectRef === input.run.externalUserId &&
      candidate.externalThreadRef ===
        input.run.sessionId.slice('messenger:'.length) &&
      candidate.externalMessageId === input.firstLinkedTurn.externalMessageId &&
      candidate.receivedAt === input.firstLinkedTurn.receivedAt &&
      input.firstLinkedTurn.externalUserId === input.run.externalUserId &&
      freshMessengerGuestIngress(candidate, now),
  );
  return ingress
    ? issueVerifiedMessengerGuestCheckoutAuthority({
        ingress,
        runFence: input.commitFence,
      })
    : undefined;
}
